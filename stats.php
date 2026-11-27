<?php
/*
 * EVE Tools: visitor statistics page (private, password protected). Not part of the app's menu.
 *
 * Shows what lib/usage.php logs and summarises: visitors and visits per day and month, peak hours, tools,
 * markets, countries and cities (DB-IP City Lite, cron/geoip.php), devices, and the list of visits with IP
 * addresses for the days whose raw log is still kept (30 days). Times are UTC (EVE time).
 *
 * The password is set on the server with   php <cron folder>/stats-password.php <site folder>
 * (hash in cache/stats_auth.json). Signing in sets a cookie for this page only, signed with that hash, valid
 * SESSION_DAYS; a new password signs everyone out. More than MAX_FAILS wrong passwords from one IP in an hour
 * block that IP for the rest of the hour.
 */

require __DIR__ . '/lib/usage.php';

const AUTH_FILE    = __DIR__ . '/cache/stats_auth.json';
const FAILS_FILE   = __DIR__ . '/cache/stats_fails.json';
const COOKIE       = 'eveToolsStats';
const SESSION_DAYS = 30;
const MAX_FAILS    = 10;
const VISITS_MAX   = 500;     // rows in the visit list

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');

function h($s): string { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
function nf($n): string { return number_format((float)$n); }
function pct($a, $b): string { return $b ? round(100 * $a / $b) . '%' : '–'; }
function dur(int $s): string {
    if ($s < 60) return $s . ' s';
    if ($s < 3600) return round($s / 60) . ' min';
    return intdiv($s, 3600) . ' h ' . sprintf('%02d', intdiv($s % 3600, 60)) . ' min';
}
function heat($v, $max): string { return $max > 0 ? sprintf('--h:%.3f', 0.54 * $v / $max) : '--h:0'; }
function flag(string $cc): string {
    if (!preg_match('/^[A-Z]{2}$/', $cc)) return '';
    return sprintf('&#x%X;&#x%X;', 0x1F1E6 + ord($cc[0]) - 65, 0x1F1E6 + ord($cc[1]) - 65);
}

// ---------------------------------------------------------------- sign-in
$auth = json_decode((string)@file_get_contents(AUTH_FILE), true);
$secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
$path = rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/stats.php'), '/') . '/stats.php';
$self = basename(__FILE__);
function cookieFor(string $hash, int $exp): string { return $exp . '.' . hash_hmac('sha256', "stats|$exp", $hash); }
function setSession(string $value, int $exp, string $path, bool $secure): void {
    setcookie(COOKIE, $value, ['expires' => $exp, 'path' => $path, 'secure' => $secure, 'httponly' => true, 'samesite' => 'Strict']);
}
function signedIn(?array $auth): bool {
    if (!$auth || empty($auth['hash']) || !preg_match('/^(\d+)\.[0-9a-f]{64}$/', $_COOKIE[COOKIE] ?? '', $m)) return false;
    return (int)$m[1] > time() && hash_equals(cookieFor($auth['hash'], (int)$m[1]), $_COOKIE[COOKIE]);
}
function fails(): array {
    $f = json_decode((string)@file_get_contents(FAILS_FILE), true);
    $f = is_array($f) ? $f : [];
    return array_filter($f, function ($x) { return time() - ($x[1] ?? 0) < 3600; });
}

$loginError = '';
$action = $_POST['action'] ?? '';
if ($action === 'logout') {
    setSession('', 1, $path, $secure);
    header("Location: $self", true, 303); exit;
}
if ($action === 'login' && $auth) {
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    $f = fails();
    if (($f[$ip][0] ?? 0) >= MAX_FAILS) $loginError = 'Too many wrong passwords. Try again in an hour.';
    elseif (password_verify((string)($_POST['password'] ?? ''), $auth['hash'])) {
        $exp = time() + SESSION_DAYS * 86400;
        setSession(cookieFor($auth['hash'], $exp), $exp, $path, $secure);
        unset($f[$ip]); @file_put_contents(FAILS_FILE, json_encode($f));
        header("Location: $self", true, 303); exit;
    } else {
        $f[$ip] = [($f[$ip][0] ?? 0) + 1, $f[$ip][1] ?? time()];
        @file_put_contents(FAILS_FILE, json_encode($f));
        sleep(1);
        $loginError = 'Wrong password.';
    }
}

function page(string $title, string $body): void { ?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<title><?= h($title) ?></title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap">
<link rel="stylesheet" href="css/app.css">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<script>
  try { const t = (JSON.parse(localStorage.getItem("eveTools.app.v1") || "{}")).theme; if (t && t !== "auto") document.documentElement.dataset.theme = t; } catch (e) {}
</script>
</head>
<body class="stats">
<header class="appbar">
  <div class="inner">
    <a class="logo" href="./">
      <div class="logo-text"><div class="logo-name">EVE <span>Tools</span></div><small class="logo-by">visitor statistics</small></div>
    </a>
    <div class="spacer"></div>
    <?php if (signedIn($GLOBALS['auth'])): ?>
    <form method="post"><input type="hidden" name="action" value="logout"><button class="icon-btn" type="submit">Sign out</button></form>
    <?php endif ?>
  </div>
</header>
<main class="inner wrap"><?= $body ?></main>
</body>
</html>
<?php exit; }

if (!$auth || empty($auth['hash'])) {
    page('Statistics', '<div class="panel stats-login"><h1>Statistics</h1><p>No password has been set yet. On the server, run</p>'
        . '<pre class="stats-cmd">php &lt;cron folder&gt;/stats-password.php &lt;site folder&gt;</pre>'
        . '<p class="sub">e.g. <code>/usr/local/bin/php /home/vh22350/eve_cron/stats-password.php /home/vh22350/eve_html</code></p></div>');
}
if (!signedIn($auth)) {
    page('Statistics', '<form class="panel stats-login" method="post"><h1>Statistics</h1>'
        . '<input type="hidden" name="action" value="login">'
        . '<label class="fld">Password<input type="password" name="password" autocomplete="current-password" autofocus required></label>'
        . ($loginError ? '<p class="msg err" role="alert">' . h($loginError) . '</p>' : '')
        . '<button class="btn-primary" type="submit">Sign in</button></form>');
}

// ---------------------------------------------------------------- data
usageHousekeep(__DIR__);
$sum   = usageReadSummary(__DIR__);
$now   = time();
$today = gmdate('Y-m-d', $now);
$todayVisits = usageVisits(usageReadDay(__DIR__, $today));
$days  = $sum['days'];
$days[$today] = usageDaySummary($todayVisits);
$rawDays = usageRawDays(__DIR__);

$RANGES = [7 => 'Last 7 days', 30 => 'Last 30 days', 90 => 'Last 90 days', 365 => 'Last 365 days'];
$range = (int)($_GET['range'] ?? 30);
if (!isset($RANGES[$range])) $range = 30;
$from = gmdate('Y-m-d', $now - ($range - 1) * 86400);
$inRange = array_filter($days, function ($d) use ($from) { return $d >= $from; }, ARRAY_FILTER_USE_KEY);
krsort($inRange);

// tool labels from the app's module registry, market names from data/markets.json
$labels = [];
if (preg_match_all('/\{\s*id:\s*"([a-z0-9-]+)",\s*label:\s*"([^"]+)"/', (string)@file_get_contents(__DIR__ . '/js/app.js'), $mm, PREG_SET_ORDER))
    foreach ($mm as $x) $labels[$x[1]] = $x[2];
$marketNames = json_decode((string)@file_get_contents(__DIR__ . '/data/markets.json'), true) ?: [];

// totals over the range
$T = ['visits' => 0, 'newVisits' => 0, 'sec' => 0, 'visitorDays' => 0, 'tools' => [], 'markets' => [], 'countries' => [],
      'cities' => [], 'dev' => [], 'br' => [], 'os' => [], 'len' => array_fill(0, count(USAGE_LEN), 0), 'grid' => []];
$add = function (array &$a, array $b) { foreach ($b as $k => $v) $a[$k] = ($a[$k] ?? 0) + $v; };
$wdCount = array_fill(0, 7, 0);
foreach ($inRange as $day => $d) {
    $T['visits'] += $d['visits']; $T['newVisits'] += $d['newVisits']; $T['sec'] += $d['sec']; $T['visitorDays'] += $d['visitors'];
    foreach ($d['tools'] as $t => $x) { $T['tools'][$t]['visits'] = ($T['tools'][$t]['visits'] ?? 0) + $x['visits']; $T['tools'][$t]['sec'] = ($T['tools'][$t]['sec'] ?? 0) + $x['sec']; }
    foreach (['markets', 'countries', 'cities', 'dev', 'br', 'os'] as $k) $add($T[$k], $d[$k]);
    foreach ($d['len'] as $i => $n) $T['len'][$i] += $n;
    $wd = (int)gmdate('N', strtotime("$day 00:00:00 UTC")) - 1;      // 0 = Monday
    $wdCount[$wd]++;
    foreach ($d['hours'] as $hr => $n) $T['grid'][$wd][$hr] = ($T['grid'][$wd][$hr] ?? 0) + $n;
}
foreach (['markets', 'countries', 'cities', 'dev', 'br', 'os'] as $k) arsort($T[$k]);
uasort($T['tools'], function ($a, $b) { return $b['visits'] <=> $a['visits']; });

// distinct visitors: today, this month (ids are kept until the month is over), finished months from the summary
$monthOf = function (string $m) use ($days) {
    $ids = []; $visits = 0; $sec = 0; $complete = true;
    foreach ($days as $day => $d) if (strpos($day, $m) === 0) {
        $visits += $d['visits']; $sec += $d['sec'];
        if (isset($d['ids'])) foreach ($d['ids'] as $id) $ids[$id] = true; else $complete = false;
    }
    return ['visitors' => count($ids), 'visits' => $visits, 'sec' => $sec, 'complete' => $complete];
};
$months = [];
foreach (array_unique(array_map(function ($d) { return substr($d, 0, 7); }, array_keys($days))) as $m) {
    $x = $monthOf($m);
    if (isset($sum['months'][$m])) $x['visitors'] = $sum['months'][$m]['visitors'];
    $months[$m] = $x;
}
krsort($months);
$thisMonth = $months[gmdate('Y-m', $now)] ?? ['visitors' => 0, 'visits' => 0, 'sec' => 0];

// open right now: page loads whose last beat (with a tool) is under GAP_MAX old
$open = 0;
$lastBeat = [];
foreach (usageReadDay(__DIR__, $today) as $b) $lastBeat[$b['pv']] = $b;
foreach ($lastBeat as $b) if ($now - $b['t'] <= USAGE_GAP_MAX && ($b['tool'] ?? '') !== '') $open++;

// visit list
$listDay = $_GET['day'] ?? $today;
if (!in_array($listDay, $rawDays, true)) $listDay = $rawDays[0] ?? $today;
$listVisits = $listDay === $today ? $todayVisits : usageVisits(usageReadDay(__DIR__, $listDay));

$geoState = json_decode((string)@file_get_contents(__DIR__ . '/cache/geoip/state.json'), true) ?: [];
$hasGeo = is_file(usageGeoFile(__DIR__));
$toolName = function ($t) use ($labels) { return $labels[$t] ?? $t; };

// ---------------------------------------------------------------- render
ob_start();
$avg = $T['visits'] ? intdiv($T['sec'], $T['visits']) : 0;
?>
<div class="head">
  <h1>Visitor statistics</h1>
  <form class="stats-range" method="get">
    <select name="range" aria-label="Period" onchange="this.form.submit()">
      <?php foreach ($RANGES as $k => $v): ?><option value="<?= $k ?>"<?= $k === $range ? ' selected' : '' ?>><?= h($v) ?></option><?php endforeach ?>
    </select>
    <noscript><button class="btn" type="submit">Show</button></noscript>
  </form>
</div>
<p class="sub">Times are UTC (EVE time). A visit is one page load; time counts only while the page is visible.</p>

<div class="tiles stats-tiles">
  <div class="tile lead"><span>Open now</span><b><?= nf($open) ?></b><small>pages on screen</small></div>
  <div class="tile"><span>Today</span><b><?= nf($days[$today]['visitors']) ?></b><small><?= nf($days[$today]['visits']) ?> visits</small></div>
  <div class="tile"><span><?= h(gmdate('F', $now)) ?></span><b><?= nf($thisMonth['visitors']) ?></b><small>visitors, <?= nf($thisMonth['visits']) ?> visits</small></div>
  <div class="tile"><span><?= h($RANGES[$range]) ?></span><b><?= nf($T['visits']) ?></b><small>visits, <?= pct($T['newVisits'], $T['visits']) ?> first-time</small></div>
  <div class="tile"><span>Average visit</span><b><?= h(dur($avg)) ?></b><small><?= h(dur($T['sec'])) ?> in total</small></div>
</div>

<div class="stats-grid">
  <section class="panel">
    <h2>Per day</h2>
    <div class="tablewrap"><table class="data compact">
      <thead><tr><th>Day</th><th>Visitors</th><th>Visits</th><th>First-time</th><th>Time</th><th>Avg visit</th></tr></thead>
      <tbody>
      <?php $maxV = max(array_column($inRange, 'visitors') ?: [0]);
      foreach ($inRange as $day => $d): ?>
        <tr><td><?= h(gmdate('D j M', strtotime("$day 00:00:00 UTC"))) ?><?= $day === $today ? ' <span class="pill">today</span>' : '' ?></td>
          <td class="cellwrap"><span class="cell" style="<?= heat($d['visitors'], $maxV) ?>"><?= nf($d['visitors']) ?></span></td>
          <td><?= nf($d['visits']) ?></td><td><?= pct($d['newVisits'], $d['visits']) ?></td>
          <td><?= h(dur($d['sec'])) ?></td><td><?= h(dur($d['visits'] ? intdiv($d['sec'], $d['visits']) : 0)) ?></td></tr>
      <?php endforeach ?>
      <?php if (!$inRange): ?><tr><td colspan="6" class="muted">No visits yet.</td></tr><?php endif ?>
      </tbody>
    </table></div>
  </section>

  <section class="panel">
    <h2>Per month</h2>
    <div class="tablewrap"><table class="data compact">
      <thead><tr><th>Month</th><th>Visitors</th><th>Visits</th><th>Time</th></tr></thead>
      <tbody>
      <?php foreach ($months as $m => $x): ?>
        <tr><td><?= h(gmdate('F Y', strtotime("$m-01 00:00:00 UTC"))) ?></td><td><?= nf($x['visitors']) ?></td><td><?= nf($x['visits']) ?></td><td><?= h(dur($x['sec'])) ?></td></tr>
      <?php endforeach ?>
      </tbody>
    </table></div>
    <p class="sub">Visitors are distinct per month (same IP address and browser = one visitor).</p>
  </section>
</div>

<section class="panel">
  <h2>Peak hours: average visits per hour, <?= h(strtolower($RANGES[$range])) ?></h2>
  <div class="tablewrap"><table class="stats-hours">
    <thead><tr><th></th><?php for ($hr = 0; $hr < 24; $hr++): ?><th><?= sprintf('%02d', $hr) ?></th><?php endfor ?></tr></thead>
    <tbody>
    <?php $avgGrid = []; $maxG = 0;
    foreach (range(0, 6) as $wd) for ($hr = 0; $hr < 24; $hr++) { $avgGrid[$wd][$hr] = $wdCount[$wd] ? ($T['grid'][$wd][$hr] ?? 0) / $wdCount[$wd] : 0; $maxG = max($maxG, $avgGrid[$wd][$hr]); }
    foreach (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as $wd => $name): ?>
      <tr><td class="name"><?= $name ?></td>
      <?php for ($hr = 0; $hr < 24; $hr++): $v = $avgGrid[$wd][$hr]; ?>
        <td class="cellwrap"><span class="cell<?= $v ? '' : ' none' ?>" style="<?= heat($v, $maxG) ?>" title="<?= $name ?> <?= sprintf('%02d:00', $hr) ?>: <?= round($v, 1) ?> visits"><?= $v ? ($v >= 10 ? round($v) : round($v, 1)) : '' ?></span></td>
      <?php endfor ?></tr>
    <?php endforeach ?>
    </tbody>
  </table></div>
</section>

<div class="stats-grid">
  <section class="panel">
    <h2>Tools</h2>
    <div class="tablewrap"><table class="data compact">
      <thead><tr><th>Tool</th><th>Visits</th><th>Share</th><th>Time</th><th>Avg per visit</th></tr></thead>
      <tbody>
      <?php foreach ($T['tools'] as $t => $x): ?>
        <tr><td><?= h($toolName($t)) ?></td><td><?= nf($x['visits']) ?></td><td><?= pct($x['visits'], $T['visits']) ?></td><td><?= h(dur($x['sec'])) ?></td><td><?= h(dur(intdiv($x['sec'], max(1, $x['visits'])))) ?></td></tr>
      <?php endforeach ?>
      </tbody>
    </table></div>
    <p class="sub">Share: visits that opened the tool (one visit can open several).</p>
  </section>

  <section class="panel">
    <h2>Markets</h2>
    <div class="tablewrap"><table class="data compact">
      <thead><tr><th>Market</th><th>Visits</th><th>Share</th></tr></thead>
      <tbody>
      <?php $mt = array_sum($T['markets']); foreach ($T['markets'] as $m => $n): ?>
        <tr><td><?= h($marketNames[$m] ?? $m) ?></td><td><?= nf($n) ?></td><td><?= pct($n, $mt) ?></td></tr>
      <?php endforeach ?>
      </tbody>
    </table></div>
    <p class="sub">Market set in visits that used a tool with prices.</p>
  </section>
</div>

<div class="stats-grid">
  <section class="panel">
    <h2>Countries</h2>
    <div class="tablewrap"><table class="data compact">
      <thead><tr><th>Country</th><th>Visitors</th><th>Share</th></tr></thead>
      <tbody>
      <?php $ct = array_sum($T['countries']); foreach (array_slice($T['countries'], 0, 30, true) as $k => $n): [$cc, $name] = array_pad(explode('|', $k, 2), 2, ''); ?>
        <tr><td><?= $cc !== '' ? flag($cc) . ' ' . h($name ?: $cc) : '<span class="muted">Unknown</span>' ?></td><td><?= nf($n) ?></td><td><?= pct($n, $ct) ?></td></tr>
      <?php endforeach ?>
      </tbody>
    </table></div>
    <p class="sub">Visitors counted once per day.</p>
  </section>

  <section class="panel">
    <h2>Cities</h2>
    <div class="tablewrap"><table class="data compact">
      <thead><tr><th>City</th><th>Visitors</th></tr></thead>
      <tbody>
      <?php foreach (array_slice($T['cities'], 0, 30, true) as $k => $n): [$city, $region, $cc] = array_pad(explode('|', $k, 3), 3, ''); ?>
        <tr><td><?= flag($cc) ?> <?= h($city) ?><?= $region !== '' && $region !== $city ? ' <small class="muted">' . h($region) . '</small>' : '' ?></td><td><?= nf($n) ?></td></tr>
      <?php endforeach ?>
      </tbody>
    </table></div>
    <p class="sub">Approximate: from the IP address (VPNs show the VPN's location).</p>
  </section>
</div>

<div class="stats-grid stats-small">
  <?php foreach (['dev' => 'Devices', 'br' => 'Browsers', 'os' => 'Systems'] as $k => $title): $tot = array_sum($T[$k]); ?>
  <section class="panel">
    <h2><?= $title ?></h2>
    <table class="data compact"><tbody>
      <?php foreach ($T[$k] as $name => $n): ?><tr><td><?= h($k === 'dev' ? ucfirst($name) : $name) ?></td><td><?= nf($n) ?></td><td><?= pct($n, $tot) ?></td></tr><?php endforeach ?>
    </tbody></table>
  </section>
  <?php endforeach ?>
  <section class="panel">
    <h2>Visit length</h2>
    <table class="data compact"><tbody>
      <?php foreach (USAGE_LEN as $i => [, $name]): ?><tr><td><?= h($name) ?></td><td><?= nf($T['len'][$i]) ?></td><td><?= pct($T['len'][$i], $T['visits']) ?></td></tr><?php endforeach ?>
    </tbody></table>
  </section>
</div>

<section class="panel" id="visits">
  <div class="head">
    <h2>Visits on <?= h(gmdate('l j F Y', strtotime("$listDay 00:00:00 UTC"))) ?> (<?= nf(count($listVisits)) ?>)</h2>
    <form method="get" action="#visits">
      <input type="hidden" name="range" value="<?= $range ?>">
      <select name="day" aria-label="Day" onchange="this.form.submit()">
        <?php foreach ($rawDays ?: [$today] as $d): ?><option value="<?= h($d) ?>"<?= $d === $listDay ? ' selected' : '' ?>><?= h(gmdate('D j M', strtotime("$d 00:00:00 UTC"))) ?></option><?php endforeach ?>
      </select>
      <noscript><button class="btn" type="submit">Show</button></noscript>
    </form>
  </div>
  <div class="tablewrap"><table class="data compact stats-visits">
    <thead><tr><th>Start</th><th>Length</th><th>IP address</th><th>Location</th><th>Tools</th><th>Device</th></tr></thead>
    <tbody>
    <?php foreach (array_slice($listVisits, 0, VISITS_MAX) as $v): ?>
      <tr><td><?= gmdate('H:i', $v['start']) ?><?= $v['new'] ? ' <span class="pill ok">new</span>' : '' ?></td>
        <td><?= h(dur($v['sec'])) ?></td>
        <td class="ip"><?= h($v['ip']) ?></td>
        <td class="loc"><?= $v['cc'] !== '' ? flag($v['cc']) . ' ' . h(implode(', ', array_filter([$v['city'], $v['region'] !== $v['city'] ? $v['region'] : '', $v['country']]))) : '<span class="muted">Unknown</span>' ?></td>
        <td class="loc"><?= h(implode(', ', array_map(function ($t) use ($toolName, $v) { return $toolName($t) . ' ' . dur($v['tools'][$t]); }, $v['toolOrder']))) ?></td>
        <td class="loc"><?= h(ucfirst($v['dev']) . ', ' . $v['br'] . ', ' . $v['os']) ?></td></tr>
    <?php endforeach ?>
    <?php if (!$listVisits): ?><tr><td colspan="6" class="muted">No visits on this day.</td></tr><?php endif ?>
    </tbody>
  </table></div>
  <?php if (count($listVisits) > VISITS_MAX): ?><p class="sub">Showing the latest <?= VISITS_MAX ?>.</p><?php endif ?>
  <p class="sub">IP addresses are kept <?= USAGE_RAW_DAYS ?> days; after that only the totals above remain.</p>
</section>

<footer class="note">
  <?php if (!$hasGeo): ?><p class="msg err">No GeoIP database yet: locations are unknown until <code>cron/geoip.php</code> has run.</p><?php endif ?>
  <?= !empty($geoState['error']) ? '<p class="msg err">GeoIP job: ' . h($geoState['error']) . '</p>' : '' ?>
  <p>IP geolocation by <a href="https://db-ip.com" rel="noopener">DB-IP</a><?= !empty($geoState['month']) ? ' (City Lite ' . h($geoState['month']) . ')' : '' ?>,
    licensed under <a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener">CC BY 4.0</a>.</p>
</footer>
<?php
page('Statistics · EVE Tools', ob_get_clean());
