<?php
/*
 * EVE Tools: serves game data extracted from CCP's SDE by cron/sde.php (cache/ isn't reachable from the web).
 *
 * GET sde.php?set=reprocessing     -> cache/sde/reprocessing.json (format described in cron/sde.php)
 *
 * The data changes only when CCP publishes a new SDE build, so replies carry an ETag (the build number and
 * extraction time) and the browser revalidates with a cheap 304.
 * Errors: {"error":"message"} with 404 (unknown set) or 503 (not extracted yet: the cron job hasn't run).
 */

const SETS = ['reprocessing'];
const SDE_DIR = __DIR__ . '/cache/sde';

header('Content-Type: application/json; charset=utf-8');

$set = $_GET['set'] ?? '';
if (!in_array($set, SETS, true)) {
    http_response_code(404);
    echo json_encode(['error' => 'Unknown data set.']);
    exit;
}
$file = SDE_DIR . "/$set.json";
if (!is_file($file)) {
    http_response_code(503);
    header('Cache-Control: no-store');
    echo json_encode(['error' => 'The game data hasn\'t been extracted on the server yet (cron/sde.php).']);
    exit;
}

$etag = '"' . $set . '-' . filemtime($file) . '-' . filesize($file) . '"';
header('Cache-Control: no-cache');
header('ETag: ' . $etag);
if (trim($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) { http_response_code(304); exit; }
readfile($file);
