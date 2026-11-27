<?php
/*
 * EVE Tools: GeoIP database job. Run by cron, never from the web (see cron/.htaccess and lib.php).
 *
 *   php geoip.php <site folder>            install this month's DB-IP "IP to City Lite" database when it's new
 *   php geoip.php <site folder> --force    download and install it again
 *
 * DB-IP publishes the free City Lite database monthly (CC BY 4.0, https://db-ip.com; the credit is on stats.php)
 * at download.db-ip.com/free/dbip-city-lite-YYYY-MM.mmdb.gz (~130 MB compressed). This job downloads the newest
 * month it doesn't have yet (early in a month, when this month's isn't out yet, it falls back to last month's),
 * unpacks it and writes
 *
 *   <site>/cache/geoip/dbip-city-lite.mmdb   read by lib/geoip.php for the visitor statistics (lib/usage.php)
 *   <site>/cache/geoip/state.json            {"month","installedAt","checkedAt","error"}
 *
 * A new file replaces the old one only after it opens and gives known answers (8.8.8.8 is in the US); the
 * previous copy is kept as dbip-city-lite.prev.mmdb. Needs about 500 MB free while unpacking.
 *
 * Suggested cron: once a day. A run that finds the current month installed makes no request and takes < 1 s;
 * otherwise it checks at most every RETRY hours. Prints nothing when there was nothing to do, unless --verbose.
 */

require __DIR__ . '/lib.php';

const DBIP_URL = 'https://download.db-ip.com/free/dbip-city-lite-%s.mmdb.gz';
const RETRY    = 6 * 3600;     // seconds between checks for a month that isn't published yet

$site  = siteFolder('geoip');
$force = flag('force');
$dir   = "$site/cache/geoip";
$lock  = lockOrExit($dir, 'geoip');
require "$site/lib/geoip.php";

$dbFile    = "$dir/dbip-city-lite.mmdb";
$stateFile = "$dir/state.json";
$state     = readJson($stateFile) ?? [];
$thisMonth = gmdate('Y-m');

if (!$force && is_file($dbFile) && ($state['month'] ?? '') === $thisMonth) { sayV("GeoIP: $thisMonth is installed"); exit(0); }
if (!$force && is_file($dbFile) && time() - ($state['checkedAt'] ?? 0) < RETRY) { sayV('GeoIP: checked recently, skipping'); exit(0); }

// Unpack, check and install one month's file. Returns false when DB-IP hasn't published it (HTTP 404).
function install(string $month, string $dir, string $dbFile): bool {
    $gz = "$dir/download.mmdb.gz";
    $new = "$dir/new.mmdb";
    try {
        sayV("GeoIP: downloading $month");
        try { http(sprintf(DBIP_URL, $month), 900, $gz); }
        catch (RuntimeException $e) { if (strpos($e->getMessage(), '404') !== false) { sayV("GeoIP: $month isn't published"); return false; } throw $e; }
        $in = gzopen($gz, 'rb');
        $out = fopen($new, 'wb');
        if (!$in || !$out) throw new RuntimeException("can't unpack $gz");
        while (!gzeof($in)) {
            $chunk = gzread($in, 1 << 20);
            if ($chunk === false || fwrite($out, $chunk) === false) throw new RuntimeException("can't unpack $gz (disk full?)");
        }
        gzclose($in); fclose($out);
        $db = new MmdbReader($new);
        $type = (string)($db->meta['database_type'] ?? '');
        $us = $db->lookup('8.8.8.8');
        if (stripos($type, 'city') === false) throw new RuntimeException("unexpected database type \"$type\"");
        if (($us['country']['iso_code'] ?? '') !== 'US' || !$db->lookup('1.1.1.1')) throw new RuntimeException('the new database gives wrong answers');
        unset($db);
        if (is_file($dbFile)) rename($dbFile, "$dir/dbip-city-lite.prev.mmdb");
        if (!rename($new, $dbFile)) throw new RuntimeException("can't write $dbFile");
        return true;
    } finally {
        @unlink($gz);
        @unlink($new);
    }
}

$state['checkedAt'] = time();
$code = 0;
try {
    $done = false;
    foreach ([$thisMonth, gmdate('Y-m', strtotime(gmdate('Y-m-01') . ' -1 month'))] as $month) {
        if (!$force && is_file($dbFile) && $month <= ($state['month'] ?? '')) break;      // nothing newer than what we have
        if (install($month, $dir, $dbFile)) {
            $state['month'] = $month;
            $state['installedAt'] = time();
            say("GeoIP: installed DB-IP City Lite $month");
            $done = true;
            break;
        }
    }
    if (!$done && !is_file($dbFile)) throw new RuntimeException('no DB-IP City Lite file found for this or last month');
    unset($state['error']);
} catch (Throwable $e) {
    $state['error'] = $e->getMessage();
    say('ERROR: GeoIP: ' . $e->getMessage());
    $code = 1;
}
writeJsonAtomic($stateFile, $state);
flock($lock, LOCK_UN);
exit($code);
