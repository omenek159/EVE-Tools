<?php
/*
 * EVE Tools: SDE update job. Run by cron, never from the web (see cron/.htaccess and the check below).
 *
 *   php cron/sde.php            check for a new SDE build; download and extract it only when it changed
 *   php cron/sde.php --force    extract again even if the build hasn't changed
 *
 * CCP publishes the Static Data Export (SDE) some time after downtime when game data changed. This job
 * reads the tiny "latest" file (build number), and when the build is newer than the one already extracted
 * it downloads the JSONL zip (~100 MB), reads only the files it needs line by line, and writes:
 *
 *   cache/sde/reprocessing.json   what the Reprocessing module needs (see extractReprocessing below)
 *   cache/sde/state.json          {"build","released","checkedAt","extractedAt","error"}
 *
 * A new file replaces the old one only after it passes checks (validateReprocessing); the previous copy
 * is kept as *.prev.json. The download and unpacked files are deleted afterwards.
 * Pages read the result through sde.php (cache/ itself isn't reachable from the web).
 *
 * Suggested cron: every hour (a check is one small request; a run that finds nothing new takes < 1 s).
 * Needs PHP 7.4+ CLI with curl and zip, and ~700 MB of free disk space while extracting.
 */

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

const ROOT       = __DIR__ . '/..';
const SDE_DIR    = ROOT . '/cache/sde';
const LATEST_URL = 'https://developers.eveonline.com/static-data/tranquility/latest.jsonl';
const ZIP_URL    = 'https://developers.eveonline.com/static-data/tranquility/eve-online-static-data-%d-jsonl.zip';
const USER_AGENT = 'EVE-Tools by omenek';

// Dogma attribute IDs (names as in the SDE's dogmaAttributes)
const A_REPRO_SKILL  = 790;   // reprocessingSkillType: the processing skill that applies to an ore
const A_YIELD_MUT    = 379;   // refiningYieldMutator: % per skill level, or % of an implant
const A_STR_BONUS    = 2722;  // strRefiningYieldBonus: structure's own yield bonus %
const A_RIG_YIELD    = 717;   // refiningYieldMultiplier: base yield of a reprocessing facility or rig (0.5, 0.51, 0.53)
const A_SEC_HIGH     = 2355;  // hiSecModifier
const A_SEC_LOW      = 2356;  // lowSecModifier
const A_SEC_NULL     = 2357;  // nullSecModifier
const A_IMPLANTNESS  = 331;   // implant slot: only real implants have it (not boosters)
const T_REPRO_FACILITY = 35899;   // Standup Reprocessing Facility I: its 0.5 is the base yield without a rig
const CAT_SKILL = 16, CAT_IMPLANT = 20, CAT_STRUCTURE = 65, CAT_STRUCTURE_MODULE = 66;

$force = in_array('--force', $argv, true);

function say(string $msg): void { echo gmdate('Y-m-d H:i:s'), ' ', $msg, PHP_EOL; }
function readJson(string $file): ?array {
    if (!is_file($file)) return null;
    $j = json_decode((string)file_get_contents($file), true);
    return is_array($j) ? $j : null;
}
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
// GET into a string, or into a file when $toFile is given. Throws on any failure.
function http(string $url, int $timeout, ?string $toFile = null): string {
    $ch = curl_init($url);
    $fh = null;
    $opt = [
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_USERAGENT      => USER_AGENT,
        CURLOPT_FAILONERROR    => true,
    ];
    if ($toFile) { $fh = fopen($toFile, 'wb'); $opt[CURLOPT_FILE] = $fh; } else { $opt[CURLOPT_RETURNTRANSFER] = true; }
    curl_setopt_array($ch, $opt);
    $body = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);
    if ($fh) fclose($fh);
    if ($body === false) throw new RuntimeException("download failed: $url ($err)");
    return $toFile ? '' : $body;
}
// Calls $fn(array $row) for each line of a JSONL file. $want(int $key) can skip a line before it's decoded.
function eachRow(string $file, callable $fn, ?callable $want = null): void {
    $fh = fopen($file, 'rb');
    if (!$fh) throw new RuntimeException("can't read $file");
    while (($line = fgets($fh)) !== false) {
        if ($want && preg_match('/^\{"_key":\s*(\d+)/', $line, $m) && !$want((int)$m[1])) continue;
        $row = json_decode($line, true);
        if (is_array($row)) $fn($row);
    }
    fclose($fh);
}
function en($name): string { return is_array($name) ? (string)($name['en'] ?? reset($name)) : (string)$name; }

/*
 * cache/sde/reprocessing.json:
 *   items      {typeID: {name, group, class, portion, volume, skill, materials {typeID: qty per batch}}}
 *              every published type with a reprocessing skill: ores (raw and compressed), moon ore, ice, ...
 *              class = which M-set rig applies: "ore" | "moon" | "ice"
 *   compressed {rawTypeID: compressedTypeID}
 *   materials  {typeID: {name, volume}}       what the items reprocess into
 *   baseYield  % yield of a structure's reprocessing service without a rig
 *   skills     {typeID: {name, bonus}}        % per level (Reprocessing 3, Reprocessing Efficiency 2, ore skills 2)
 *   implants   {typeID: {name, bonus}}        %
 *   structures {typeID: {name, bonus}}        structures with their own yield bonus % (Athanor 2, Tatara 5.5, ...)
 *   rigs       {typeID: {name, class, yield, security {high, low, null}}}
 *              class "ore" | "moon" | "ice" for M-set rigs, "all" for L/XL-set rigs; yield in % (51, 53);
 *              security = multiplier by system security, applied together with the rig
 */
function extractReprocessing(string $dir, array $sde): array {
    $groups = [];                                         // groupID => [categoryID, name]
    eachRow("$dir/groups.jsonl", function ($r) use (&$groups) {
        $groups[$r['_key']] = [(int)$r['categoryID'], en($r['name'] ?? '')];
    });

    $wanted = [A_REPRO_SKILL, A_YIELD_MUT, A_STR_BONUS, A_RIG_YIELD, A_SEC_HIGH, A_SEC_LOW, A_SEC_NULL, A_IMPLANTNESS];
    $attrs = [];                                          // typeID => [attributeID => value], only types with one of $wanted
    eachRow("$dir/typeDogma.jsonl", function ($r) use (&$attrs, $wanted) {
        $a = [];
        foreach ($r['dogmaAttributes'] ?? [] as $x) if (in_array($x['attributeID'], $wanted, true)) $a[$x['attributeID']] = $x['value'];
        if ($a) $attrs[$r['_key']] = $a;
    });

    $types = [];                                          // typeID => row, only for types with interesting attributes
    eachRow("$dir/types.jsonl", function ($r) use (&$types) { $types[$r['_key']] = $r; },
        function ($id) use ($attrs) { return isset($attrs[$id]); });

    $out = ['sde' => $sde, 'generatedAt' => time(), 'items' => [], 'compressed' => [], 'materials' => [],
            'baseYield' => null, 'skills' => [], 'implants' => [], 'structures' => [], 'rigs' => []];

    foreach ($attrs as $id => $a) {
        $t = $types[$id] ?? null;
        if (!$t || empty($t['published'])) continue;
        [$cat, $group] = $groups[$t['groupID']] ?? [0, ''];
        $name = en($t['name'] ?? '');

        if (isset($a[A_REPRO_SKILL])) {
            $class = stripos($group, 'Ice') !== false ? 'ice' : (stripos($group, 'Moon Asteroids') !== false ? 'moon' : 'ore');
            $out['items'][$id] = ['name' => $name, 'group' => $group, 'class' => $class,
                'portion' => (int)($t['portionSize'] ?? 1), 'volume' => (float)($t['volume'] ?? 0),
                'skill' => (int)$a[A_REPRO_SKILL], 'materials' => []];
        }
        if (isset($a[A_YIELD_MUT]) && $cat === CAT_SKILL)
            $out['skills'][$id] = ['name' => $name, 'bonus' => (float)$a[A_YIELD_MUT]];
        if (isset($a[A_YIELD_MUT]) && $cat === CAT_IMPLANT && isset($a[A_IMPLANTNESS]))
            $out['implants'][$id] = ['name' => $name, 'bonus' => (float)$a[A_YIELD_MUT]];
        if (isset($a[A_STR_BONUS]) && $cat === CAT_STRUCTURE)
            $out['structures'][$id] = ['name' => $name, 'bonus' => (float)$a[A_STR_BONUS]];
        if ($id === T_REPRO_FACILITY && isset($a[A_RIG_YIELD]))
            $out['baseYield'] = round($a[A_RIG_YIELD] * 100, 4);
        if (isset($a[A_RIG_YIELD]) && $cat === CAT_STRUCTURE_MODULE && stripos($group, 'Structure Resource Rig') === 0) {
            $class = stripos($group, 'Asteroid Ore') !== false ? 'ore' : (stripos($group, 'Moon Ore') !== false ? 'moon'
                   : (stripos($group, 'Ice') !== false ? 'ice' : 'all'));
            $out['rigs'][$id] = ['name' => $name, 'class' => $class, 'yield' => round($a[A_RIG_YIELD] * 100, 4),
                'security' => ['high' => (float)($a[A_SEC_HIGH] ?? 1), 'low' => (float)($a[A_SEC_LOW] ?? 1), 'null' => (float)($a[A_SEC_NULL] ?? 1)]];
        }
    }

    // Materials per batch, for the items only.
    $matIds = [];
    eachRow("$dir/typeMaterials.jsonl", function ($r) use (&$out, &$matIds) {
        foreach ($r['materials'] ?? [] as $m) {
            $out['items'][$r['_key']]['materials'][$m['materialTypeID']] = (int)$m['quantity'];
            $matIds[$m['materialTypeID']] = true;
        }
    }, function ($id) use ($out) { return isset($out['items'][$id]); });

    eachRow("$dir/types.jsonl", function ($r) use (&$out) {
        $out['materials'][$r['_key']] = ['name' => en($r['name'] ?? ''), 'volume' => (float)($r['volume'] ?? 0)];
    }, function ($id) use ($matIds) { return isset($matIds[$id]); });

    eachRow("$dir/compressibleTypes.jsonl", function ($r) use (&$out) {
        $out['compressed'][$r['_key']] = (int)$r['compressedTypeID'];
    }, function ($id) use ($out) { return isset($out['items'][$id]); });

    foreach ($out['items'] as $id => $it) if (!$it['materials']) unset($out['items'][$id]);   // nothing to get out of it
    foreach (['items', 'materials', 'skills', 'implants', 'structures', 'rigs', 'compressed'] as $k) ksort($out[$k]);
    return $out;
}

// Known values (confirmed in game); a file that disagrees is not published.
function validateReprocessing(array $r): void {
    $check = function (bool $ok, string $what) { if (!$ok) throw new RuntimeException("check failed: $what"); };
    $check(count($r['items']) > 300, 'fewer than 300 reprocessable items');
    $v = $r['items'][62518] ?? null;                                    // Compressed Veldspar III-Grade
    $check($v && $v['portion'] === 100 && ($v['materials'][34] ?? 0) === 440 && $v['skill'] === 60377, 'Compressed Veldspar III-Grade');
    $check(($r['materials'][34]['name'] ?? '') === 'Tritanium', 'Tritanium');
    $check(($r['compressed'][1230] ?? 0) === 62516, 'Veldspar compresses into Compressed Veldspar');
    $check($r['baseYield'] == 50, 'base yield 50 %');
    $check(($r['skills'][3385]['bonus'] ?? 0) == 3 && ($r['skills'][3389]['bonus'] ?? 0) == 2, 'Reprocessing / Reprocessing Efficiency');
    $check(($r['structures'][35835]['bonus'] ?? 0) == 2, 'Athanor bonus');
    $rig = $r['rigs'][46634] ?? null;                                   // Standup M-Set Asteroid Ore Grading Processor II
    $check($rig && $rig['class'] === 'ore' && $rig['yield'] == 53 && $rig['security']['high'] == 1, 'M-Set Asteroid Ore Grading Processor II');
}

// ---------------------------------------------------------------------------------------------------------

if (!is_dir(SDE_DIR) && !mkdir(SDE_DIR, 0775, true)) { say('ERROR: can\'t create ' . SDE_DIR); exit(1); }
$lock = fopen(SDE_DIR . '/run.lock', 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) { say('another run is still working, skipping'); exit(0); }

$stateFile = SDE_DIR . '/state.json';
$state = readJson($stateFile) ?? ['build' => 0];
$tmp = SDE_DIR . '/tmp';
$exit = 0;
try {
    $latest = json_decode(trim(http(LATEST_URL, 30)), true);
    $build = (int)($latest['buildNumber'] ?? 0);
    if (!$build) throw new RuntimeException('no build number in ' . LATEST_URL);
    $state['checkedAt'] = time();

    if (!$force && $build === (int)$state['build'] && is_file(SDE_DIR . '/reprocessing.json')) {
        say("SDE build $build: up to date");
        unset($state['error']);
    } else {
        say("SDE build $build (have " . ($state['build'] ?: 'none') . '): downloading');
        rmTree($tmp);
        mkdir($tmp, 0775, true);
        http(sprintf(ZIP_URL, $build), 900, "$tmp/sde.zip");

        $zip = new ZipArchive();
        if ($zip->open("$tmp/sde.zip") !== true) throw new RuntimeException('the download is not a readable zip');
        $files = ['_sde.jsonl', 'groups.jsonl', 'types.jsonl', 'typeDogma.jsonl', 'typeMaterials.jsonl', 'compressibleTypes.jsonl'];
        if (!$zip->extractTo($tmp, $files)) throw new RuntimeException('can\'t unpack ' . implode(', ', $files));
        $zip->close();
        unlink("$tmp/sde.zip");

        $meta = json_decode(trim((string)file_get_contents("$tmp/_sde.jsonl")), true) ?: [];
        $sde = ['build' => (int)($meta['buildNumber'] ?? $build), 'released' => (string)($meta['releaseDate'] ?? '')];

        say('extracting reprocessing data');
        $repro = extractReprocessing($tmp, $sde);
        validateReprocessing($repro);
        $file = SDE_DIR . '/reprocessing.json';
        if (is_file($file)) copy($file, SDE_DIR . '/reprocessing.prev.json');
        writeJsonAtomic($file, $repro);
        say(sprintf('reprocessing.json: %d items, %d materials, %d rigs', count($repro['items']), count($repro['materials']), count($repro['rigs'])));

        $state = ['build' => $sde['build'], 'released' => $sde['released'], 'checkedAt' => time(), 'extractedAt' => time()];
    }
} catch (Throwable $e) {
    say('ERROR: ' . $e->getMessage() . ' (the previous data stays in use)');
    $state['error'] = $e->getMessage();
    $state['checkedAt'] = time();
    $exit = 1;
}
rmTree($tmp);
writeJsonAtomic($stateFile, $state);
flock($lock, LOCK_UN);
exit($exit);
