<?php
/*
 * EVE Tools: price and version endpoint (used by the Ore prices module and the app's update check).
 *
 * GET prices.php?market=station:60003760&types=1230,62516,...[&since=<unix seconds>]
 * GET prices.php?version=1                     -> {"version":"4.1"} only
 *
 * Serves the prices saved by the cron job cron/prices.php (Fuzzwork market aggregates, fetched for every
 * market in data/markets.json when Fuzzwork publishes new data, about every 30 minutes). This endpoint never
 * contacts Fuzzwork itself: if the job stops, the saved prices are served as they are, and "jobAt" says
 * when the job last ran, so the page can say the prices may be out of date.
 *
 * "fetchedAt" is when these prices were first seen (a fetch that returned the same prices keeps the old time).
 * "since": the fetchedAt of the prices the page already has. When the saved prices are not newer, "data" is
 * left out and the reply is only a few bytes (the page's automatic check).
 * Items the job doesn't price are simply missing from "data".
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

// ---- version only ----
if (isset($_GET['version'])) { echo json_encode(['version' => pageVersion()]); exit; }

// ---- validate input ----
$market = $_GET['market'] ?? 'station:60003760';
$markets = readJson(MARKETS_FILE) ?? [];
if (!isset($markets[$market])) fail(400, 'Unknown market.');

$typesRaw = $_GET['types'] ?? '';
if (!preg_match('/^\d{1,9}(,\d{1,9}){0,499}$/', $typesRaw)) fail(400, 'Bad item list.');
$types = array_map('intval', explode(',', $typesRaw));
$since = isset($_GET['since']) ? (int)$_GET['since'] : 0;

// ---- saved prices ----
$c = readJson(CACHE_DIR . '/prices_' . str_replace(':', '_', $market) . '.json');
if (!$c || !isset($c['fetchedAt'], $c['data'])) {
    fail(503, 'The server has no prices yet: its price job (cron/prices.php) hasn\'t run.');
}
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
