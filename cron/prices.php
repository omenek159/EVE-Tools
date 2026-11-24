<?php
/*
 * EVE Tools: price update job. Run by cron, never from the web (see cron/.htaccess and lib.php).
 *
 *   php prices.php <site folder>            fetch prices for every market when Fuzzwork has published new data
 *   php prices.php <site folder> --force    fetch every market now
 *
 * Suggested cron: every 2 minutes. Each run asks Fuzzwork for its current orderset number (a few bytes);
 * Fuzzwork publishes a new orderset about every 30 minutes. Only when the number went up are the prices of
 * every market in data/markets.json fetched and saved, in the format the web endpoint prices.php serves:
 *
 *   <site>/cache/prices_<market>.json   {"fetchedAt","checkedAt","orderset","types","data":{typeID:{buy,sell}}}
 *   <site>/cache/prices_state.json      {"orderset","checkedAt","seenAt","runAt","error"}
 *   <site>/cache/adjusted_prices.json   {"fetchedAt","data":{typeID: adjusted price}} from ESI, at most hourly
 *                                       (CCP's reference price, used e.g. for reprocessing tax; changes about daily)
 *
 * Items priced: every ore, compressed ore and gas in data/ores.json, plus every mineral the SDE job
 * found in cache/sde/reprocessing.json (when it has run).
 * "fetchedAt" is when these prices were first seen: a fetch that returns the same prices keeps the old time.
 * Right after a new orderset appears, Fuzzwork sometimes still serves the old prices; a market whose prices
 * came back unchanged is fetched again on the next runs, until they change or the orderset is RECHECK_SAME old.
 * Prints nothing when there was nothing to do, unless --verbose. Exits 1 when something failed.
 */

require __DIR__ . '/lib.php';

const FUZZWORK      = 'https://market.fuzzwork.co.uk/aggregates/';
const ORDERSET      = 'https://market.fuzzwork.co.uk/api/orderset';
const ESI_PRICES    = 'https://esi.evetech.net/markets/prices';
const ESI_COMPAT    = 'X-Compatibility-Date: 2025-08-26';
const RECHECK_SAME  = 300;     // seconds after a new orderset during which unchanged prices are fetched again
const FALLBACK_TTL  = 1800;    // orderset number unavailable: fetch again when prices are this old
const ADJUSTED_TTL  = 3600;    // ESI adjusted prices: fetch again after this long (ESI caches them for an hour)
const ADJUSTED_RETRY = 900;    // ... or after this long when the last try failed

$site  = siteFolder('prices');
$force = flag('force');
$cache = "$site/cache";
$lock  = lockOrExit($cache, 'prices');

// Keep only the four numbers the pages use; Fuzzwork sends sixteen per item.
function trimPrices(array $data): array {
    $out = [];
    foreach ($data as $id => $d) {
        $out[(int)$id] = [
            'buy'  => ['max' => $d['buy']['max'] ?? null,  'percentile' => $d['buy']['percentile'] ?? null],
            'sell' => ['min' => $d['sell']['min'] ?? null, 'percentile' => $d['sell']['percentile'] ?? null],
        ];
    }
    ksort($out);
    return $out;
}
// Every item a page may ask a price for.
function priceTypes(string $site): array {
    $ores = readJson("$site/data/ores.json");
    if (!$ores || empty($ores['fam'])) throw new RuntimeException("can't read $site/data/ores.json");
    $ids = [];
    foreach ($ores['fam'] as $fam) foreach ($fam as $it) { $ids[(int)$it[1]] = true; if (!empty($it[3])) $ids[(int)$it[3]] = true; }
    $repro = readJson("$site/cache/sde/reprocessing.json");
    foreach (array_keys($repro['materials'] ?? []) as $id) $ids[(int)$id] = true;
    $ids = array_keys($ids);
    sort($ids);
    return $ids;
}

$markets = readJson("$site/data/markets.json");
$stateFile = "$cache/prices_state.json";
$state = readJson($stateFile) ?? ['orderset' => 0, 'checkedAt' => 0, 'seenAt' => 0];
$errors = [];

try {
    if (!$markets) throw new RuntimeException("can't read $site/data/markets.json");
    $types = priceTypes($site);
    $typeKey = implode(',', $types);

    // The current orderset number (0 when Fuzzwork doesn't say).
    $os = 0;
    try { $os = (int)(httpJson(ORDERSET, 10)['orderset'] ?? 0); }
    catch (Throwable $e) { $errors[] = 'orderset: ' . $e->getMessage(); }
    if ($os && $os !== (int)$state['orderset']) { $state['orderset'] = $os; $state['seenAt'] = time(); }
    $state['checkedAt'] = time();

    foreach (array_keys($markets) as $market) {
        $file = "$cache/prices_" . str_replace(':', '_', $market) . '.json';
        $c = readJson($file);
        $due = $force || !$c || ($c['types'] ?? '') !== $typeKey
            || ($os ? ($c['orderset'] ?? 0) < $os : time() - ($c['checkedAt'] ?? 0) >= FALLBACK_TTL);
        if (!$due) continue;

        [$kind, $id] = explode(':', $market);
        try {
            $data = httpJson(FUZZWORK . '?' . $kind . '=' . $id . '&types=' . $typeKey, 30);
            if (!$data) throw new RuntimeException('no prices in the reply');
        } catch (Throwable $e) { $errors[] = "$market: " . $e->getMessage(); continue; }

        $data = trimPrices($data);
        $same = $c && ($c['types'] ?? '') === $typeKey && ($c['data'] ?? null) == $data;
        // Unchanged prices soon after a new orderset are probably the old batch still being served: leave the
        // saved orderset as it was, so the next run fetches again.
        $for = $same && $os && time() - $state['seenAt'] < RECHECK_SAME ? ($c['orderset'] ?? 0) : $os;
        writeJsonAtomic($file, [
            'fetchedAt' => $same ? $c['fetchedAt'] : time(),
            'checkedAt' => time(),
            'orderset'  => $for,
            'types'     => $typeKey,
            'data'      => $data,
        ]);
        if ($same) sayV("$market: prices unchanged (orderset $os)");
        else say("$market: new prices, orderset $os");
    }

    // CCP's adjusted prices (ESI), at most hourly.
    $adjFile = "$cache/adjusted_prices.json";
    $adj = readJson($adjFile);
    $adjAge = time() - max($adj['fetchedAt'] ?? 0, $state['adjustedTriedAt'] ?? 0);
    if ($force || !$adj || $adjAge >= (($state['adjustedFailed'] ?? false) ? ADJUSTED_RETRY : ADJUSTED_TTL)) {
        $state['adjustedTriedAt'] = time();
        try {
            $rows = httpJson(ESI_PRICES, 60, [ESI_COMPAT]);
            $out = [];
            foreach ($rows as $r) if (isset($r['type_id'], $r['adjusted_price'])) $out[(int)$r['type_id']] = (float)$r['adjusted_price'];
            if (count($out) < 1000 || empty($out[34])) throw new RuntimeException('the reply has too few prices');
            ksort($out);
            $changed = !$adj || ($adj['data'] ?? null) != $out;
            writeJsonAtomic($adjFile, ['fetchedAt' => $changed ? time() : $adj['fetchedAt'], 'checkedAt' => time(), 'data' => $out]);
            if ($changed) say('adjusted prices: ' . count($out) . ' items');
            $state['adjustedFailed'] = false;
        } catch (Throwable $e) {
            $errors[] = 'adjusted prices: ' . $e->getMessage();
            $state['adjustedFailed'] = true;
        }
    }
} catch (Throwable $e) {
    $errors[] = $e->getMessage();
}

$state['runAt'] = time();
if ($errors) { $state['error'] = implode('; ', $errors); foreach ($errors as $e) say("ERROR: $e"); }
else unset($state['error']);
writeJsonAtomic($stateFile, $state);
flock($lock, LOCK_UN);
exit($errors ? 1 : 0);
