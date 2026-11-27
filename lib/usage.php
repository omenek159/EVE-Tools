<?php
/*
 * EVE Tools: visitor statistics (used by prices.php, which logs, and stats.php, which shows them).
 *
 * Every open page sends a heartbeat (POST prices.php, beat=1; see js/app.js) when it loads, when its tool tab
 * changes, every 2 minutes while it is visible, and once when it is hidden or closed (empty tool). Each one is
 * appended as a line of JSON to
 *
 *   cache/usage/<YYYY-MM-DD>.jsonl   (UTC day)
 *   {"t":unix,"pv":page load id,"ip","tool","m":market,"n":1 first beat of the page load,"r":1 browser seen before,
 *    "dev":"desktop|mobile|tablet","br","os","cc","country","region","city"}
 *
 * The page load id is a random id the page makes when it loads (kept in memory only: no cookie, no storage).
 * The location comes from cache/geoip/dbip-city-lite.mmdb (cron/geoip.php; lib/geoip.php) at the moment of the
 * request. Raw files (they hold IP addresses) are deleted after RAW_DAYS days. Before that, each finished day is
 * folded into cache/usage/summary.json, which holds counts only and is kept for good:
 *
 *   {"days": {"YYYY-MM-DD": daySummary()}, "months": {"YYYY-MM": {"visitors": n}}}
 *
 * Distinct visitors per month need the visitor ids of every day of the month ("ids", a short hash of IP + browser);
 * once a month is over they are replaced by the month's count. Housekeeping (folding days, deleting old raw
 * files) runs on the first heartbeat of each UTC day and whenever stats.php is opened.
 *
 * Time on a tool: each beat counts the time to the next beat of the same page load (at most GAP_MAX), for the
 * tool it named; a hidden page sends an empty tool, so time in the background is not counted.
 */

if (get_included_files()[0] === __FILE__) { http_response_code(404); exit; }

require_once __DIR__ . '/geoip.php';

const USAGE_RAW_DAYS = 30;               // raw heartbeats (with IP addresses) are kept this many days
const USAGE_GAP_MAX  = 150;              // seconds a beat can count for (the page beats every 120 s)
const USAGE_DAY_MAX  = 50 * 1024 * 1024; // stop logging a day whose file grew past this (a flood, not visitors)
const USAGE_LEN      = [[60, '< 1 min'], [300, '1–5 min'], [900, '5–15 min'], [3600, '15–60 min'], [PHP_INT_MAX, '> 1 h']];
const USAGE_BOTS     = '/bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|phantom|puppeteer|playwright|python|curl|wget/i';

function usageDir(string $site): string { return "$site/cache/usage"; }
function usageGeoFile(string $site): string { return "$site/cache/geoip/dbip-city-lite.mmdb"; }

// cache/ is hidden by the site's .htaccess; this second one keeps the IP logs private even without mod_alias.
function usageEnsureDir(string $dir): bool {
    if (!is_dir($dir) && !@mkdir($dir, 0775, true)) return false;
    if (!is_file("$dir/.htaccess"))
        @file_put_contents("$dir/.htaccess", "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Deny from all\n</IfModule>\n");
    return true;
}

/** Device type, browser and system from a User-Agent string. */
function usageAgent(string $ua): array {
    $dev = preg_match('/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i', $ua) ? 'tablet'
         : (preg_match('/Mobi|iPhone|iPod|Android|Windows Phone/i', $ua) ? 'mobile' : 'desktop');
    $br = 'Other';
    foreach (['Edg' => 'Edge', 'OPR' => 'Opera', 'Opera' => 'Opera', 'Vivaldi' => 'Vivaldi', 'YaBrowser' => 'Yandex',
              'SamsungBrowser' => 'Samsung', 'Firefox' => 'Firefox', 'FxiOS' => 'Firefox', 'CriOS' => 'Chrome',
              'Chrome' => 'Chrome', 'Safari' => 'Safari'] as $k => $v)
        if (strpos($ua, $k) !== false) { $br = $v; break; }
    $os = 'Other';
    foreach (['Windows' => 'Windows', 'iPhone' => 'iOS', 'iPad' => 'iOS', 'Android' => 'Android', 'CrOS' => 'ChromeOS',
              'Mac OS X' => 'macOS', 'Macintosh' => 'macOS', 'Linux' => 'Linux'] as $k => $v)
        if (strpos($ua, $k) !== false) { $os = $v; break; }
    return ['dev' => $dev, 'br' => $br, 'os' => $os];
}

/**
 * Log one heartbeat from $_POST. Returns true when it started a new day file (time for housekeeping).
 * Ignores bots and malformed requests.
 */
function usageLog(string $site): bool {
    $pv   = (string)($_POST['pv'] ?? '');
    $tool = (string)($_POST['tool'] ?? '');
    $m    = (string)($_POST['m'] ?? '');
    $ua   = (string)($_SERVER['HTTP_USER_AGENT'] ?? '');
    $ip   = (string)($_SERVER['REMOTE_ADDR'] ?? '');
    if (!preg_match('/^[A-Za-z0-9]{8,24}$/', $pv) || !preg_match('/^[a-z0-9-]{0,32}$/', $tool)
        || !preg_match('/^([a-z]{1,12}:\d{1,12})?$/', $m) || $ip === '' || $ua === '' || preg_match(USAGE_BOTS, $ua)) return false;

    $dir = usageDir($site);
    if (!usageEnsureDir($dir)) return false;
    $file = "$dir/" . gmdate('Y-m-d') . '.jsonl';
    $new = !is_file($file);
    if (!$new && filesize($file) > USAGE_DAY_MAX) return false;

    $line = ['t' => time(), 'pv' => $pv, 'ip' => $ip, 'tool' => $tool, 'm' => $m];
    if (!empty($_POST['n'])) $line['n'] = 1;
    if (!empty($_POST['r'])) $line['r'] = 1;
    $line += usageAgent($ua) + geoLocate(usageGeoFile($site), $ip);
    $fh = @fopen($file, 'a');
    if (!$fh) return false;
    flock($fh, LOCK_EX);
    fwrite($fh, json_encode($line, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n");
    flock($fh, LOCK_UN);
    fclose($fh);
    return $new;
}

/** The heartbeats of one UTC day (oldest first). */
function usageReadDay(string $site, string $day): array {
    $file = usageDir($site) . "/$day.jsonl";
    $out = [];
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $day) || !is_file($file)) return $out;
    $fh = fopen($file, 'rb');
    while (($l = fgets($fh)) !== false) { $j = json_decode($l, true); if (is_array($j) && isset($j['t'], $j['pv'])) $out[] = $j; }
    fclose($fh);
    return $out;
}

/** Days that still have raw heartbeats, newest first. */
function usageRawDays(string $site): array {
    $days = [];
    foreach (glob(usageDir($site) . '/*.jsonl') ?: [] as $f)
        if (preg_match('/(\d{4}-\d{2}-\d{2})\.jsonl$/', $f, $m)) $days[] = $m[1];
    rsort($days);
    return $days;
}

/**
 * Heartbeats grouped into visits (one per page load), newest first. Each visit:
 * pv, start, end, sec (time on tools), tools {tool: sec}, toolOrder [tools in the order opened], hours {hour: 1},
 * markets {market: 1}, ip, vid (visitor id), new (first visit in this browser), dev, br, os, cc, country, region, city.
 */
function usageVisits(array $beats): array {
    $by = [];
    foreach ($beats as $b) $by[$b['pv']][] = $b;
    $visits = [];
    foreach ($by as $pv => $list) {
        usort($list, function ($a, $b) { return $a['t'] <=> $b['t']; });
        $f = $list[0];
        $v = ['pv' => $pv, 'start' => $f['t'], 'end' => end($list)['t'], 'sec' => 0, 'tools' => [], 'toolOrder' => [],
              'hours' => [], 'markets' => [], 'ip' => $f['ip'] ?? '',
              'vid' => substr(md5(($f['ip'] ?? '') . '|' . ($f['br'] ?? '') . '|' . ($f['os'] ?? '') . '|' . ($f['dev'] ?? '')), 0, 12),
              'first' => !empty($f['n']), 'new' => !empty($f['n']) && empty($f['r'])];
        foreach (['dev', 'br', 'os', 'cc', 'country', 'region', 'city'] as $k) $v[$k] = (string)($f[$k] ?? '');
        foreach ($list as $i => $b) {
            $tool = (string)($b['tool'] ?? '');
            if ($tool === '') continue;
            if (!isset($v['tools'][$tool])) { $v['tools'][$tool] = 0; $v['toolOrder'][] = $tool; }
            $v['hours'][(int)gmdate('G', $b['t'])] = 1;
            if (!empty($b['m']) && $tool !== 'incursions') $v['markets'][$b['m']] = 1;
            if (isset($list[$i + 1])) {
                $gap = min(USAGE_GAP_MAX, max(0, $list[$i + 1]['t'] - $b['t']));
                $v['tools'][$tool] += $gap;
                $v['sec'] += $gap;
            }
        }
        $visits[] = $v;
    }
    usort($visits, function ($a, $b) { return $b['start'] <=> $a['start']; });
    return $visits;
}

/** Counts for one day's visits (what summary.json keeps). */
function usageDaySummary(array $visits): array {
    $s = ['visitors' => 0, 'visits' => count($visits), 'newVisits' => 0, 'sec' => 0, 'hours' => array_fill(0, 24, 0),
          'tools' => [], 'markets' => [], 'countries' => [], 'cities' => [], 'dev' => [], 'br' => [], 'os' => [],
          'len' => array_fill(0, count(USAGE_LEN), 0), 'ids' => []];
    $seen = [];
    $inc = function (array &$a, string $k, int $by = 1) { $a[$k] = ($a[$k] ?? 0) + $by; };
    foreach ($visits as $v) {
        $s['sec'] += $v['sec'];
        if ($v['new']) $s['newVisits']++;
        foreach ($v['hours'] as $h => $_) $s['hours'][$h]++;
        foreach ($v['tools'] as $t => $sec) {
            $s['tools'][$t]['visits'] = ($s['tools'][$t]['visits'] ?? 0) + 1;
            $s['tools'][$t]['sec'] = ($s['tools'][$t]['sec'] ?? 0) + $sec;
        }
        foreach ($v['markets'] as $mk => $_) $inc($s['markets'], $mk);
        foreach (USAGE_LEN as $i => [$max]) if ($v['sec'] < $max) { $s['len'][$i]++; break; }
        if (isset($seen[$v['vid']])) continue;                        // the rest is per visitor
        $seen[$v['vid']] = true;
        $s['ids'][] = $v['vid'];
        $inc($s['countries'], $v['cc'] !== '' ? $v['cc'] . '|' . $v['country'] : '');
        if ($v['city'] !== '') $inc($s['cities'], $v['city'] . '|' . $v['region'] . '|' . $v['cc']);
        $inc($s['dev'], $v['dev']); $inc($s['br'], $v['br']); $inc($s['os'], $v['os']);
    }
    $s['visitors'] = count($seen);
    foreach (['markets', 'countries', 'cities', 'dev', 'br', 'os'] as $k) arsort($s[$k]);
    return $s;
}

function usageReadSummary(string $site): array {
    $j = json_decode((string)@file_get_contents(usageDir($site) . '/summary.json'), true);
    return ['days' => $j['days'] ?? [], 'months' => $j['months'] ?? []];
}

/**
 * Fold finished days into summary.json, replace finished months' visitor ids by their count, and delete raw
 * files older than USAGE_RAW_DAYS (only once their day is in the summary). Safe to run any time, by anyone.
 */
function usageHousekeep(string $site): void {
    $dir = usageDir($site);
    if (!is_dir($dir)) return;
    $lock = @fopen("$dir/summary.lock", 'c');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) return;          // another request is already doing it
    $sum = usageReadSummary($site);
    $today = gmdate('Y-m-d');
    $changed = false;
    foreach (usageRawDays($site) as $day) {
        if ($day >= $today || isset($sum['days'][$day])) continue;
        $sum['days'][$day] = usageDaySummary(usageVisits(usageReadDay($site, $day)));
        $changed = true;
    }
    ksort($sum['days']);
    $thisMonth = gmdate('Y-m');
    $byMonth = [];
    foreach ($sum['days'] as $day => $d) if (isset($d['ids'])) $byMonth[substr($day, 0, 7)][] = $day;
    foreach ($byMonth as $month => $days) {
        if ($month >= $thisMonth) continue;
        $raw = array_filter(usageRawDays($site), function ($d) use ($month, $sum) { return strpos($d, $month) === 0 && !isset($sum['days'][$d]); });
        if ($raw) continue;                                             // wait until every day of it is folded
        $ids = [];
        foreach ($days as $day) { foreach ($sum['days'][$day]['ids'] as $id) $ids[$id] = true; unset($sum['days'][$day]['ids']); }
        $sum['months'][$month] = ['visitors' => count($ids) + ($sum['months'][$month]['visitors'] ?? 0)];
        $changed = true;
    }
    ksort($sum['months']);
    if ($changed) {
        $tmp = "$dir/summary.json." . getmypid() . '.tmp';
        if (@file_put_contents($tmp, json_encode($sum, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)) !== false) @rename($tmp, "$dir/summary.json");
        else @unlink($tmp);
    }
    $sum = usageReadSummary($site);
    $oldest = gmdate('Y-m-d', time() - USAGE_RAW_DAYS * 86400);
    foreach (usageRawDays($site) as $day)
        if ($day < $oldest && isset($sum['days'][$day])) @unlink("$dir/$day.jsonl");
    flock($lock, LOCK_UN);
    fclose($lock);
}
