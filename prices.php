<?php
/*
 * EVE Tools: price and version endpoint (used by the Ore prices module and the app's update check).
 *
 * GET prices.php?market=station:60003760&types=1230,62516,...[&since=<unix seconds>]
 * GET prices.php?version=1                     -> {"version":"3.1"} only
 *
 * Returns the Fuzzwork prices for the market. Each market's result is saved in ./cache/
 * with the time it was fetched; a copy younger than CACHE_TTL is returned without asking
 * Fuzzwork again, so Fuzzwork sees at most one request per market per CACHE_TTL however many
 * people have the page open.
 *
 * "since": the fetchedAt of the prices the page already has. When the saved prices are not
 * newer, "data" is left out and the reply is only a few bytes (the page's automatic check).
 *
 * Every reply also carries "version": the APP_VERSION line read from js/version.js next to this
 * script, so open pages can offer a reload when a newer version has been uploaded.
 *
 * Response: {"version":"3.1","market":"...","fetchedAt":<unix>,"cached":true|false,"ttl":600,"data":{...}}
 * Errors:   {"error":"message","version":"3.1"} with a 4xx/5xx status
 *
 * Needs PHP 7.4+ and either the curl extension or allow_url_fopen.
 */

const CACHE_TTL   = 600;                       // seconds (10 minutes) between Fuzzwork fetches per market
const CACHE_DIR   = __DIR__ . '/cache';
const VERSION_FILE = __DIR__ . '/js/version.js';   // where the current APP_VERSION is read from
const FUZZWORK    = 'https://market.fuzzwork.co.uk/aggregates/';
const USER_AGENT  = 'EVETools/1.0 (self-hosted)';
const MARKETS = [                              // only these markets can be requested
    'station:60003760',                        // Jita IV-4
    'region:10000002',                         // The Forge
    'station:60008494',                        // Amarr VIII
    'station:60011866',                        // Dodixie IX
    'station:60004588',                        // Rens VI
    'station:60005686',                        // Hek VIII
];

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
// Keep only the four numbers the page uses; Fuzzwork sends sixteen per item.
function trimPrices(array $data): array {
    $out = [];
    foreach ($data as $id => $d) {
        $out[$id] = [
            'buy'  => ['max' => $d['buy']['max'] ?? null,  'percentile' => $d['buy']['percentile'] ?? null],
            'sell' => ['min' => $d['sell']['min'] ?? null, 'percentile' => $d['sell']['percentile'] ?? null],
        ];
    }
    return $out;
}

// ---- version only: no Fuzzwork, no cache ----
if (isset($_GET['version'])) { echo json_encode(['version' => pageVersion()]); exit; }

// ---- validate input ----
$market = $_GET['market'] ?? 'station:60003760';
if (!in_array($market, MARKETS, true)) fail(400, 'Unknown market.');

$typesRaw = $_GET['types'] ?? '';
if (!preg_match('/^\d{1,9}(,\d{1,9}){0,499}$/', $typesRaw)) fail(400, 'Bad item list.');
$types = array_values(array_unique(array_map('intval', explode(',', $typesRaw))));
sort($types);
$since = isset($_GET['since']) ? (int)$_GET['since'] : 0;

// ---- cache ----
if (!is_dir(CACHE_DIR) && !@mkdir(CACHE_DIR, 0775, true)) {
    fail(500, 'The server can\'t create its cache folder. Make the folder next to prices.php writable.');
}
$file = CACHE_DIR . '/prices_' . str_replace(':', '_', $market) . '.json';

// Any saved copy is read; whether it covers the requested items is checked separately, so pages asking for
// different item lists (e.g. older and newer versions) share one copy instead of replacing each other's.
function readCache(string $file): ?array {
    if (!is_file($file)) return null;
    $c = json_decode((string)@file_get_contents($file), true);
    if (!is_array($c) || !isset($c['fetchedAt'], $c['data'], $c['types'])) return null;
    return $c;
}
function covers(?array $c, array $types): bool {
    if (!$c) return false;
    return !array_diff($types, array_map('intval', explode(',', $c['types'])));
}
function send(array $c, string $market, bool $cached, int $since, array $types): void {
    $out = [
        'version'   => pageVersion(),
        'market'    => $market,
        'fetchedAt' => $c['fetchedAt'],
        'cached'    => $cached,
        'ttl'       => CACHE_TTL,
    ];
    if ($c['fetchedAt'] > $since)                                          // only when newer than what the page has
        $out['data'] = trimPrices(array_intersect_key($c['data'], array_flip($types)));   // only the items asked for
    echo json_encode($out);
    exit;
}

$c = readCache($file);
if (covers($c, $types) && time() - $c['fetchedAt'] < CACHE_TTL) send($c, $market, true, $since, $types);

// Lock so several people checking at once cause only one Fuzzwork request.
$lock = fopen($file . '.lock', 'c');
if ($lock) flock($lock, LOCK_EX);
$c = readCache($file);                                // someone may have refreshed while we waited
if (covers($c, $types) && time() - $c['fetchedAt'] < CACHE_TTL) send($c, $market, true, $since, $types);

// Fetch the requested items plus any the saved copy already had, so it keeps serving every page version.
$fetchTypes = $c ? array_values(array_unique(array_merge($types, array_map('intval', explode(',', $c['types']))))) : $types;
sort($fetchTypes);
$fetchKey = implode(',', $fetchTypes);

// ---- fetch from Fuzzwork ----
[$kind, $id] = explode(':', $market);
$url = FUZZWORK . '?' . $kind . '=' . $id . '&types=' . $fetchKey;

$body = false; $status = 0;
if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_USERAGENT      => USER_AGENT,
        CURLOPT_HTTPHEADER     => ['Accept: application/json'],
        CURLOPT_ENCODING       => '',
    ]);
    $body = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
} elseif (ini_get('allow_url_fopen')) {
    $ctx = stream_context_create(['http' => [
        'timeout' => 15, 'user_agent' => USER_AGENT, 'header' => "Accept: application/json\r\n", 'ignore_errors' => true,
    ]]);
    $body = @file_get_contents($url, false, $ctx);
    if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) $status = (int)$m[1];
} else {
    fail(500, 'The server can\'t make outgoing requests (needs the PHP curl extension or allow_url_fopen).');
}

$data = ($body !== false && $status === 200) ? json_decode($body, true) : null;
if (!is_array($data) || !$data) {
    // Fuzzwork is down or slow: fall back to the last saved copy, however old.
    if (covers($c, $types)) send($c, $market, true, $since, $types);
    fail(502, 'Fuzzwork didn\'t return prices' . ($status ? " (HTTP $status)" : '') . '.');
}

$c = ['fetchedAt' => time(), 'types' => $fetchKey, 'data' => trimPrices($data)];
$tmp = $file . '.' . getmypid() . '.tmp';
if (@file_put_contents($tmp, json_encode($c)) !== false) @rename($tmp, $file);
if ($lock) { flock($lock, LOCK_UN); fclose($lock); }

send($c, $market, false, $since, $types);
