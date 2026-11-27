<?php
/*
 * EVE Tools: set the password of the visitor statistics page (stats.php). Run by hand, never from the web.
 *
 *   php stats-password.php <site folder>
 *
 * Asks for the new password (or reads it from the first line of standard input) and saves its hash in
 * <site>/cache/stats_auth.json. Setting a new password signs out every browser signed in with the old one.
 * Until a password is set, stats.php shows nothing.
 */

require __DIR__ . '/lib.php';

$site = siteFolder('stats-password');
$tty = function_exists('posix_isatty') && posix_isatty(STDIN);
if ($tty) { echo 'New password for stats.php: '; @shell_exec('stty -echo'); }
$pass = rtrim((string)fgets(STDIN), "\r\n");
if ($tty) { @shell_exec('stty echo'); echo PHP_EOL; }
if (strlen($pass) < 10) { echo "ERROR: use at least 10 characters.\n"; exit(1); }

if (!is_dir("$site/cache") && !mkdir("$site/cache", 0775, true)) { echo "ERROR: can't create $site/cache\n"; exit(1); }
writeJsonAtomic("$site/cache/stats_auth.json", ['hash' => password_hash($pass, PASSWORD_DEFAULT), 'setAt' => time()]);
echo "Saved. Open stats.php on the site and sign in.\n";
