<?php
/*
 * EVE Tools: helpers shared by the cron jobs (cron/sde.php, cron/prices.php). Command line only.
 *
 * Every job is started as   php <cron folder>/<job>.php <site folder> [--force] [--verbose]
 * where <site folder> is the instance's web root (the folder with index.html and sde.php).
 * Without it, the folder above the job is used (cron/ uploaded inside the site).
 * Jobs print nothing when there was nothing to do (so the host's cron mail stays quiet), unless --verbose.
 */

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

const USER_AGENT = 'EVE-Tools by omenek';

$FLAGS = array_values(array_filter(array_slice($argv, 1), function ($a) { return strpos($a, '--') === 0; }));
$ARGS  = array_values(array_filter(array_slice($argv, 1), function ($a) { return strpos($a, '--') !== 0; }));
function flag(string $name): bool { global $FLAGS; return in_array("--$name", $FLAGS, true); }

// The instance's web root, from the first argument. Exits when it isn't one.
function siteFolder(string $job): string {
    global $ARGS;
    $site = realpath($ARGS[0] ?? __DIR__ . '/..');
    if (!$site || !is_file("$site/sde.php")) {
        echo 'ERROR: ', $ARGS[0] ?? dirname(__DIR__), " is not the site folder (no sde.php there).\n",
             "Usage: php $job.php <site folder> [--force] [--verbose]\n";
        exit(1);
    }
    return $site;
}

function say(string $msg): void { echo gmdate('Y-m-d H:i:s'), ' ', $msg, PHP_EOL; }
function sayV(string $msg): void { if (flag('verbose')) say($msg); }

function readJson(string $file): ?array {
    if (!is_file($file)) return null;
    $j = json_decode((string)file_get_contents($file), true);
    return is_array($j) ? $j : null;
}
// Readers (sde.php, prices.php) never see a half-written file: write a temporary file, then rename it.
function writeJsonAtomic(string $file, array $data): void {
    $tmp = $file . '.' . getmypid() . '.tmp';
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false || file_put_contents($tmp, $json) === false || !rename($tmp, $file)) {
        @unlink($tmp);
        throw new RuntimeException("can't write $file");
    }
}
function rmTree(string $dir): void {
    if (!is_dir($dir)) return;
    foreach (scandir($dir) as $f) {
        if ($f === '.' || $f === '..') continue;
        $p = "$dir/$f";
        is_dir($p) ? rmTree($p) : unlink($p);
    }
    rmdir($dir);
}
// One run of a job at a time; a run that finds another still working exits quietly.
function lockOrExit(string $dir, string $name) {
    if (!is_dir($dir) && !mkdir($dir, 0775, true)) { say("ERROR: can't create $dir"); exit(1); }
    $lock = fopen("$dir/$name.lock", 'c');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) { sayV('another run is still working, skipping'); exit(0); }
    return $lock;
}

// GET into a string, or into a file when $toFile is given. Throws on any failure (including HTTP 4xx/5xx).
function http(string $url, int $timeout, ?string $toFile = null, array $headers = []): string {
    $ch = curl_init($url);
    $fh = null;
    $opt = [
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_USERAGENT      => USER_AGENT,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_ENCODING       => '',
        CURLOPT_FAILONERROR    => true,
    ];
    if ($toFile) { $fh = fopen($toFile, 'wb'); $opt[CURLOPT_FILE] = $fh; } else { $opt[CURLOPT_RETURNTRANSFER] = true; }
    curl_setopt_array($ch, $opt);
    $body = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);
    if ($fh) fclose($fh);
    if ($body === false) throw new RuntimeException("request failed: $url ($err)");
    return $toFile ? '' : $body;
}
function httpJson(string $url, int $timeout, array $headers = []): array {
    $j = json_decode(http($url, $timeout, null, array_merge(['Accept: application/json'], $headers)), true);
    if (!is_array($j)) throw new RuntimeException("not JSON: $url");
    return $j;
}
