<?php
/*
 * EVE Tools: price and version endpoint (used by the Mining calculator and the app's update check).
 *
 * GET prices.php?market=station:60003760&types=1230,62516,...[&since=<unix seconds>]
 * GET prices.php?version=1                     -> {"version":"4.1"} only
 * POST prices.php beat=1&pv=..&tool=..&m=..     -> 204; a visitor statistics heartbeat from js/app.js (lib/usage.php)
 * GET prices.php?adjusted=1&types=34,35,...    -> {"version","fetchedAt","data":{typeID: adjusted price}}
 *     CCP's adjusted prices (ESI), saved by the same job at most hourly; used for reprocessing tax.
 *
 * Serves the prices saved by the cron job cron/prices.php (Fuzzwork market aggregates, fetched for every
 * market in data/markets.json when Fuzzwork publishes new data, about every 30 minutes). If the job stops, the
 * saved prices are served as they are, and "jobAt" says when the job last ran, so the page can say the prices
 * may be out of date.
 *
 * Items asked for that the saved copy has never had (e.g. a module pasted into Reprocessing) are fetched from
 * Fuzzwork here, once, for this market only: only reprocessable items and materials from the SDE extract
 * (plus the hybrid drones in data/rdf.json),
 * at most NEW_MAX per request, one fetch per market at a time. They are added to the saved copy and to
 * cache/price_requests.json ({typeID: last asked}), so from then on the price job refreshes them with
 * everything else (every market), until nobody has asked for them for 30 days. If Fuzzwork doesn't answer,
 * the reply simply lacks them.
 *
 * "fetchedAt" is when these prices were first seen (a fetch that returned the same prices keeps the old time).
 * "since": the fetchedAt of the prices the page already has. When the saved prices are not newer, "data" is
 * left out and the reply is only a few bytes (the page's automatic check).
 * Items without a price (unknown, or no answer from Fuzzwork) are simply missing from "data".
 *
 * Every reply also carries "version": the APP_VERSION line read from js/version.js next to this
 * script, so open pages can offer a reload when a newer version has been uploaded.
 *
 * Response: {"version":"4.1","market":"...","fetchedAt":<unix>,"jobAt":<unix|null>,"cached":true,"data":{...}}
 * Errors:   {"error":"message","version":"4.1"} with a 4xx/5xx status
 */

const CACHE_DIR    = __DIR__ . '/cache';
const VERSION_FILE = __DIR__ . '/js/version.js';   // where the current APP_VERSION is read from
const MARKETS_FILE = __DIR__ . '/data/markets.json';
const REQUESTS_FILE = CACHE_DIR . '/price_requests.json';
const SDE_FILE     = CACHE_DIR . '/sde/reprocessing.json';
const FUZZWORK     = 'https://market.fuzzwork.co.uk/aggregates/';
const USER_AGENT   = 'EVE-Tools by omenek';
const NEW_MAX      = 200;      // items fetched on demand per request
const TOUCH_AFTER  = 86400;    // refresh an item's "last asked" at most this often

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function pageVersion(): ?string {                 // "MAJOR.MINOR", as written in js/version.js
    $js = @file_get_contents(VERSION_FILE, false, null, 0, 4096);
    if ($js === false || !preg_match('/APP_VERSION\s*=\s*["\']?(\d+(?:\.\d+)?)/', $js, $m)) return null;
    return $m[1];
}
function fail(int $code, string $msg): void {
    http_response_code($code);
    echo json_encode(['error' => $msg, 'version' => pageVersion()]);
    exit;
}
function readJson(string $file): ?array {
    if (!is_file($file)) return null;
    $c = json_decode((string)@file_get_contents($file), true);
    return is_array($c) ? $c : null;
}

// Keep only the four numbers the pages use; Fuzzwork sends sixteen per item (same as cron/prices.php).
function trimPrices(array $data): array {
    $out = [];
    foreach ($data as $id => $d) {
        $out[(int)$id] = [
            'buy'  => ['max' => $d['buy']['max'] ?? null,  'percentile' => $d['buy']['percentile'] ?? null],
            'sell' => ['min' => $d['sell']['min'] ?? null, 'percentile' => $d['sell']['percentile'] ?? null],
        ];
    }
    return $out;
}
function fuzzwork(string $market, array $ids): ?array {   // prices of $ids on $market, or null
    [$kind, $id] = explode(':', $market);
    $url = FUZZWORK . '?' . $kind . '=' . $id . '&types=' . implode(',', $ids);
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10, CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_USERAGENT => USER_AGENT, CURLOPT_ENCODING => '', CURLOPT_FAILONERROR => true]);
        $body = curl_exec($ch);
        curl_close($ch);
    } else {
        $body = @file_get_contents($url, false, stream_context_create(['http' => ['timeout' => 10, 'user_agent' => USER_AGENT]]));
    }
    $j = $body === false ? null : json_decode($body, true);
    return is_array($j) && $j ? trimPrices($j) : null;
}
function writeJson(string $file, array $c): void {
    $tmp = $file . '.' . getmypid() . '.tmp';
    if (@file_put_contents($tmp, json_encode($c)) !== false) @rename($tmp, $file);
}
// Note that these items were asked for (now), in cache/price_requests.json.
function touchRequests(array $ids): void {
    if (!$ids) return;
    $fh = @fopen(REQUESTS_FILE, 'c+');
    if (!$fh) return;
    flock($fh, LOCK_EX);
    $all = json_decode((string)stream_get_contents($fh), true);
    $all = is_array($all) ? $all : [];
    foreach ($ids as $id) $all[$id] = time();
    ftruncate($fh, 0); rewind($fh); fwrite($fh, json_encode($all));
    flock($fh, LOCK_UN); fclose($fh);
}

// ---- visitor statistics heartbeat (POST beat=1; see lib/usage.php): answered at once, logged, no reply body ----
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && isset($_POST['beat'])) {
    http_response_code(204);
    require __DIR__ . '/lib/usage.php';
    $newDay = usageLog(__DIR__);
    if ($newDay) {                                  // first beat of a UTC day: fold yesterday, drop old raw logs
        ignore_user_abort(true);
        if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
        usageHousekeep(__DIR__);
    }
    exit;
}

// ---- version only ----
if (isset($_GET['version'])) { echo json_encode(['version' => pageVersion()]); exit; }

// ---- validate input ----
$typesRaw = $_GET['types'] ?? '';
if (!preg_match('/^\d{1,9}(,\d{1,9}){0,1499}$/', $typesRaw)) fail(400, 'Bad item list.');
$types = array_map('intval', explode(',', $typesRaw));
$since = isset($_GET['since']) ? (int)$_GET['since'] : 0;

// ---- adjusted prices ----
if (isset($_GET['adjusted'])) {
    $a = readJson(CACHE_DIR . '/adjusted_prices.json');
    if (!$a || !isset($a['fetchedAt'], $a['data'])) fail(503, 'The server has no adjusted prices yet: its price job (cron/prices.php) hasn\'t run.');
    $out = ['version' => pageVersion(), 'fetchedAt' => $a['fetchedAt']];
    if ($a['fetchedAt'] > $since) $out['data'] = array_intersect_key($a['data'], array_flip($types));
    echo json_encode($out);
    exit;
}

// ---- market prices ----
$market = $_GET['market'] ?? 'station:60003760';
$markets = readJson(MARKETS_FILE) ?? [];
if (!isset($markets[$market])) fail(400, 'Unknown market.');

$file = CACHE_DIR . '/prices_' . str_replace(':', '_', $market) . '.json';
$c = readJson($file);
if (!$c || !isset($c['fetchedAt'], $c['data'])) {
    fail(503, 'The server has no prices yet: its price job (cron/prices.php) hasn\'t run.');
}

// ---- items the saved copy has never had: fetch them once (see the top of this file) ----
$have = array_flip(array_map('intval', explode(',', $c['types'] ?? '')));
$missing = array_values(array_filter($types, function ($id) use ($have) { return !isset($have[$id]); }));
$asked = readJson(REQUESTS_FILE) ?? [];
$touch = array_values(array_filter($types, function ($id) use ($asked) { return isset($asked[$id]) && time() - $asked[$id] > TOUCH_AFTER; }));
if ($missing) {
    $sde = readJson(SDE_FILE) ?? [];
    $known = ($sde['items'] ?? []) + ($sde['materials'] ?? []);
    foreach ((readJson(__DIR__ . '/data/rdf.json') ?? [])['drones'] ?? [] as $d) $known[(int)$d[0]] = true;   // RDF hybrid drones
    $missing = array_slice(array_values(array_filter($missing, function ($id) use ($known) { return isset($known[$id]); })), 0, NEW_MAX);
}
if ($missing) {
    $lock = fopen($file . '.lock', 'c');
    if ($lock) flock($lock, LOCK_EX);
    $c = readJson($file) ?? $c;                                   // someone may have added them while we waited
    $have = array_flip(array_map('intval', explode(',', $c['types'] ?? '')));
    $missing = array_values(array_filter($missing, function ($id) use ($have) { return !isset($have[$id]); }));
    if ($missing && ($new = fuzzwork($market, $missing)) !== null) {
        $c['data'] = $c['data'] + $new;
        $all = array_keys($have + array_flip($missing));
        sort($all);
        $c['types'] = implode(',', $all);
        writeJson($file, $c);
        $touch = array_merge($touch, $missing);
    }
    if ($lock) { flock($lock, LOCK_UN); fclose($lock); }
}
touchRequests($touch);
$state = readJson(CACHE_DIR . '/prices_state.json');

$out = [
    'version'   => pageVersion(),
    'market'    => $market,
    'fetchedAt' => $c['fetchedAt'],
    'jobAt'     => $state['runAt'] ?? null,
    'cached'    => true,
];
if ($c['fetchedAt'] > $since)                                          // only when newer than what the page has
    $out['data'] = array_intersect_key($c['data'], array_flip($types));   // only the items asked for
echo json_encode($out);
