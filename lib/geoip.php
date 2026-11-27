<?php
/*
 * EVE Tools: GeoIP lookup in a MaxMind DB (.mmdb) file, used for the visitor statistics (lib/usage.php) and by
 * cron/geoip.php to check a new download. No extension or Composer package needed.
 *
 * The database is DB-IP's "IP to City Lite" (CC BY 4.0, https://db-ip.com; the credit is shown on stats.php),
 * downloaded monthly by cron/geoip.php to cache/geoip/dbip-city-lite.mmdb.
 *
 *   $db = new MmdbReader($file);
 *   $db->lookup('8.8.8.8')     -> the record (array), or null when the address isn't in the database
 *   geoLocate($file, $ip)      -> ['cc' => 'US', 'country' => 'United States', 'region' => 'California', 'city' => 'Mountain View']
 *
 * File format: MaxMind DB File Format Specification 2.0 (https://maxmind.github.io/MaxMind-DB/):
 * a binary search tree over the address bits, then a data section, then metadata after "\xAB\xCD\xEFMaxMind.com".
 */

if (get_included_files()[0] === __FILE__) { http_response_code(404); exit; }

class MmdbReader {
    public array $meta;
    private $fh;
    private int $nodeCount, $recordSize, $nodeBytes, $treeSize, $dataStart;
    private ?int $ipv4Start = null;
    private string $buf = '';
    private int $bufAt = -1;

    public function __construct(string $file) {
        $fh = @fopen($file, 'rb');
        if (!$fh) throw new RuntimeException("can't open $file");
        $this->fh = $fh;
        $size = filesize($file);
        $tail = min(128 * 1024, $size);
        fseek($fh, $size - $tail);
        $end = (string)fread($fh, $tail);
        $pos = strrpos($end, "\xAB\xCD\xEFMaxMind.com");
        if ($pos === false) throw new RuntimeException("$file is not a MaxMind DB file");
        $this->dataStart = 0;
        [$meta] = $this->decode($size - $tail + $pos + 14);
        if (!is_array($meta) || !isset($meta['node_count'], $meta['record_size'], $meta['ip_version']))
            throw new RuntimeException("$file has no valid metadata");
        $this->meta = $meta;
        $this->nodeCount  = (int)$meta['node_count'];
        $this->recordSize = (int)$meta['record_size'];
        if (!in_array($this->recordSize, [24, 28, 32], true)) throw new RuntimeException("unsupported record size {$this->recordSize}");
        $this->nodeBytes = $this->recordSize / 4;
        $this->treeSize  = $this->nodeCount * $this->nodeBytes;
        $this->dataStart = $this->treeSize + 16;
    }

    /** The record for an IPv4/IPv6 address, or null. */
    public function lookup(string $ip) {
        $packed = @inet_pton($ip);
        if ($packed === false) return null;
        $bits = strlen($packed) * 8;
        if ($bits === 128 && (int)$this->meta['ip_version'] === 4) return null;
        $node = ($bits === 32 && (int)$this->meta['ip_version'] === 6) ? $this->ipv4Start() : 0;
        for ($i = 0; $i < $bits && $node < $this->nodeCount; $i++)
            $node = $this->record($node, (ord($packed[$i >> 3]) >> (7 - ($i & 7))) & 1);
        if ($node <= $this->nodeCount) return null;          // == node count: not found; < node count: ran out of bits
        return $this->decode($node - $this->nodeCount + $this->treeSize)[0];
    }

    // IPv4 addresses live under ::/96 in an IPv6 tree.
    private function ipv4Start(): int {
        if ($this->ipv4Start === null) {
            $node = 0;
            for ($i = 0; $i < 96 && $node < $this->nodeCount; $i++) $node = $this->record($node, 0);
            $this->ipv4Start = $node;
        }
        return $this->ipv4Start;
    }

    private function record(int $node, int $right): int {
        $b = $this->read($node * $this->nodeBytes, $this->nodeBytes);
        switch ($this->recordSize) {
            case 24:
                $r = substr($b, $right * 3, 3);
                return (ord($r[0]) << 16) | (ord($r[1]) << 8) | ord($r[2]);
            case 28:
                $mid = ord($b[3]);
                return $right
                    ? (($mid & 0x0F) << 24) | (ord($b[4]) << 16) | (ord($b[5]) << 8) | ord($b[6])
                    : (($mid & 0xF0) << 20) | (ord($b[0]) << 16) | (ord($b[1]) << 8) | ord($b[2]);
            default:
                return unpack('N', substr($b, $right * 4, 4))[1];
        }
    }

    private function read(int $off, int $len): string {
        if ($len === 0) return '';
        if ($this->bufAt < 0 || $off < $this->bufAt || $off + $len > $this->bufAt + strlen($this->buf)) {
            fseek($this->fh, $off);
            $this->buf = (string)fread($this->fh, max($len, 4096));
            $this->bufAt = $off;
            if (strlen($this->buf) < $len) throw new RuntimeException('unexpected end of the database file');
        }
        return substr($this->buf, $off - $this->bufAt, $len);
    }

    private function uint(string $b): int {
        $v = 0;
        for ($i = 0, $n = strlen($b); $i < $n; $i++) $v = ($v << 8) | ord($b[$i]);
        return $v;
    }

    /** [value, offset after it] for the data field at file offset $off. */
    private function decode(int $off): array {
        $ctrl = ord($this->read($off++, 1));
        $type = $ctrl >> 5;
        if ($type === 1) {                                      // pointer into the data section
            $ss = ($ctrl >> 3) & 3;
            $v  = $ctrl & 7;
            $b  = $this->read($off, $ss + 1);
            $off += $ss + 1;
            switch ($ss) {
                case 0:  $p = ($v << 8) | ord($b[0]); break;
                case 1:  $p = (($v << 16) | $this->uint($b)) + 2048; break;
                case 2:  $p = (($v << 24) | $this->uint($b)) + 526336; break;
                default: $p = $this->uint($b);
            }
            return [$this->decode($this->dataStart + $p)[0], $off];
        }
        if ($type === 0) $type = 7 + ord($this->read($off++, 1));     // extended type
        $size = $ctrl & 31;
        if ($size === 29)      { $size = 29 + ord($this->read($off, 1)); $off += 1; }
        elseif ($size === 30)  { $size = 285 + $this->uint($this->read($off, 2)); $off += 2; }
        elseif ($size === 31)  { $size = 65821 + $this->uint($this->read($off, 3)); $off += 3; }

        switch ($type) {
            case 2:  return [$this->read($off, $size), $off + $size];                       // UTF-8 string
            case 3:  return [unpack('E', $this->read($off, 8))[1], $off + 8];               // double
            case 4:  return [$this->read($off, $size), $off + $size];                       // bytes
            case 5: case 6: case 9: case 10:                                                // unsigned integers
                $b = $this->read($off, $size);
                return [$size > 7 ? bin2hex($b) : $this->uint($b), $off + $size];
            case 7:                                                                         // map
                $m = [];
                for ($i = 0; $i < $size; $i++) { [$k, $off] = $this->decode($off); [$v, $off] = $this->decode($off); $m[$k] = $v; }
                return [$m, $off];
            case 8:                                                                         // int32
                $v = $this->uint($this->read($off, $size));
                if ($size === 4 && $v >= 0x80000000) $v -= 0x100000000;
                return [$v, $off + $size];
            case 11:                                                                        // array
                $a = [];
                for ($i = 0; $i < $size; $i++) { [$v, $off] = $this->decode($off); $a[] = $v; }
                return [$a, $off];
            case 14: return [$size !== 0, $off];                                            // boolean
            case 15: return [unpack('G', $this->read($off, 4))[1], $off + 4];               // float
            default: throw new RuntimeException("unsupported data type $type");
        }
    }
}

/** Country code, country, region and city of an IP address (empty strings when unknown or no database). */
function geoLocate(string $file, string $ip): array {
    static $db = null, $dbFile = null;
    $out = ['cc' => '', 'country' => '', 'region' => '', 'city' => ''];
    try {
        if ($dbFile !== $file) { $db = is_file($file) ? new MmdbReader($file) : null; $dbFile = $file; }
        $r = $db ? $db->lookup($ip) : null;
    } catch (Throwable $e) { return $out; }
    if (!is_array($r)) return $out;
    $en = function ($x) { return is_array($x) && isset($x['names']) ? (string)($x['names']['en'] ?? reset($x['names'])) : ''; };
    $out['cc']      = (string)($r['country']['iso_code'] ?? '');
    $out['country'] = $en($r['country'] ?? null);
    $out['region']  = $en($r['subdivisions'][0] ?? null);
    $out['city']    = $en($r['city'] ?? null);
    return $out;
}
