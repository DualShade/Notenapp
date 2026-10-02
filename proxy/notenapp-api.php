<?php
// Notenapp-Konto-API für normalen PHP-Webspace (z. B. IONOS, PHP ≥ 7.1).
// Konten, Cloud-Sync der Noten und Kalender-Abo (ICS) für Klausuren/Hausaufgaben.
//
// Speicher: Dateien unter notenapp-data/ (wird automatisch angelegt). Jede Datei
// beginnt mit einer PHP-exit-Zeile (siehe GUARD), sodass ein direkter Aufruf
// über den Browser nichts preisgibt – auch ohne .htaccess. Passwörter: password_hash().
// Sitzungs-, Reset- und Kalender-Tokens werden nur als SHA-256 gespeichert.
//
// Aufruf: POST (Content-Type text/plain, JSON-Body) {"action": "...", ...}
//         GET  ?ics=<kalender-token>   → Kalender-Abo

// ---- Einstellungen ---------------------------------------------------------
$ALLOWED_ORIGIN = getenv('NOTENAPP_ALLOWED_ORIGIN') ?: 'https://dualshade.github.io';
$APP_URL = getenv('NOTENAPP_APP_URL') ?: 'https://dualshade.github.io/Notenapp/';
$DATA_DIR = getenv('NOTENAPP_DATA_DIR') ?: __DIR__ . '/notenapp-data';
$MAIL_FROM = getenv('NOTENAPP_MAIL_FROM') ?: 'Notenapp <noreply@dualshade.xyz>';
$MAIL_LOG = getenv('NOTENAPP_MAIL_LOG') ?: ''; // nur für Tests: Mails in Datei statt senden
$MAX_DATA_BYTES = 3 * 1024 * 1024;
$SESSION_DAYS = 180;
// ----------------------------------------------------------------------------

const GUARD = "<?php exit; ?>\n";

header('Access-Control-Allow-Origin: ' . $ALLOWED_ORIGIN);
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Max-Age: 86400');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
if ($ALLOWED_ORIGIN !== '*') header('Vary: Origin');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

function out($data, $status = 200) {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function fail($message, $status = 400, $extra = []) { out(array_merge(['error' => $message], $extra), $status); }

// ---------- Dateispeicher ----------
function dir_for($kind) {
    global $DATA_DIR;
    $dir = $DATA_DIR . '/' . $kind;
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
        if (!file_exists($DATA_DIR . '/.htaccess')) {
            @file_put_contents($DATA_DIR . '/.htaccess', "Require all denied\nDeny from all\n");
            @file_put_contents($DATA_DIR . '/index.html', '');
        }
    }
    return $dir;
}
function path_for($kind, $key) { return dir_for($kind) . '/' . $key . '.php'; }
function hkey($value) { return hash('sha256', $value); }

function load($kind, $key) {
    $file = path_for($kind, $key);
    if (!is_file($file)) return null;
    $raw = file_get_contents($file);
    if ($raw === false) return null;
    if (strncmp($raw, GUARD, strlen(GUARD)) === 0) $raw = substr($raw, strlen(GUARD));
    $data = json_decode($raw, true);
    return is_array($data) ? $data : null;
}
function save($kind, $key, $data) {
    $file = path_for($kind, $key);
    $tmp = $file . '.' . bin2hex(random_bytes(4)) . '.tmp';
    if (file_put_contents($tmp, GUARD . json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX) === false) {
        fail('Speichern fehlgeschlagen.', 500);
    }
    @chmod($tmp, 0600);
    if (!rename($tmp, $file)) { @unlink($tmp); fail('Speichern fehlgeschlagen.', 500); }
}
function remove($kind, $key) { $f = path_for($kind, $key); if (is_file($f)) @unlink($f); }

/** Exklusive Sperre pro Konto, damit gleichzeitige Syncs sich nicht überschreiben. */
function with_lock($name, $fn) {
    $fh = fopen(dir_for('locks') . '/' . $name . '.lock', 'c');
    flock($fh, LOCK_EX);
    try { return $fn(); } finally { flock($fh, LOCK_UN); fclose($fh); }
}

// ---------- Hilfen ----------
function token() { return bin2hex(random_bytes(32)); }
function client_ip() { return $_SERVER['REMOTE_ADDR'] ?? 'unknown'; }
function norm_email($email) { return strtolower(trim((string) $email)); }

/** Höchstens $max Versuche pro $window Sekunden für einen Schlüssel. */
function rate_limited($key, $max, $window) {
    $k = hkey($key);
    $entry = load('ratelimit', $k);
    $now = time();
    if (!$entry || $entry['since'] + $window < $now) return false;
    return $entry['count'] >= $max;
}
function rate_hit($key, $window) {
    $k = hkey($key);
    $entry = load('ratelimit', $k);
    $now = time();
    if (!$entry || $entry['since'] + $window < $now) $entry = ['count' => 0, 'since' => $now];
    $entry['count']++;
    save('ratelimit', $k, $entry);
}
function rate_clear($key) { remove('ratelimit', hkey($key)); }

function check_password_rules($password) {
    if (!is_string($password) || strlen($password) < 8) fail('Das Passwort muss mindestens 8 Zeichen lang sein.');
    if (strlen($password) > 200) fail('Das Passwort ist zu lang.');
}

function new_session($userKey, &$user) {
    global $SESSION_DAYS;
    $t = token();
    $h = hkey($t);
    save('sessions', $h, ['user' => $userKey, 'created' => time(), 'used' => time()]);
    $user['sessions'] = array_values(array_filter($user['sessions'] ?? [], function ($s) use ($SESSION_DAYS) {
        $sess = load('sessions', $s);
        return $sess && $sess['used'] > time() - $SESSION_DAYS * 86400;
    }));
    $user['sessions'][] = $h;
    return $t;
}

function auth($body) {
    global $SESSION_DAYS;
    $t = (string) ($body['token'] ?? '');
    if (!preg_match('/^[a-f0-9]{64}$/', $t)) fail('Bitte melde dich an.', 401);
    $h = hkey($t);
    $sess = load('sessions', $h);
    if (!$sess || $sess['used'] < time() - $SESSION_DAYS * 86400) { remove('sessions', $h); fail('Sitzung abgelaufen – bitte erneut anmelden.', 401); }
    $user = load('users', $sess['user']);
    if (!$user) { remove('sessions', $h); fail('Konto nicht gefunden.', 401); }
    if ($sess['used'] < time() - 86400) { $sess['used'] = time(); save('sessions', $h, $sess); }
    return [$sess['user'], $user, $h];
}

function send_mail($to, $subject, $text) {
    global $MAIL_FROM, $MAIL_LOG;
    if ($MAIL_LOG) {
        file_put_contents($MAIL_LOG, json_encode(['to' => $to, 'subject' => $subject, 'text' => $text]) . "\n", FILE_APPEND);
        return true;
    }
    $headers = "From: $MAIL_FROM\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit";
    return @mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $text, $headers);
}

function self_url() {
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['SERVER_PORT'] ?? '') == 443;
    return ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . strtok($_SERVER['REQUEST_URI'] ?? '/', '?');
}

// ---------- Kalender (ICS) ----------
function ics_text($s) {
    return str_replace(["\\", ';', ',', "\r\n", "\n"], ['\\\\', '\\;', '\\,', '\\n', '\\n'], (string) $s);
}
function ics_fold($line) {
    $out = '';
    while (strlen($line) > 74) {
        $cut = 74;
        while ($cut > 0 && (ord($line[$cut]) & 0xC0) === 0x80) $cut--; // UTF-8 nicht zerschneiden
        $out .= substr($line, 0, $cut) . "\r\n ";
        $line = substr($line, $cut);
    }
    return $out . $line . "\r\n";
}
function ics_feed($feedToken) {
    if (!preg_match('/^[a-f0-9]{64}$/', $feedToken)) { http_response_code(404); exit; }
    $feed = load('feeds', hkey($feedToken));
    $stored = $feed ? load('data', $feed['user']) : null;
    if (!$stored) { http_response_code(404); exit; }
    $p = $stored['payload'] ?? [];
    $names = [];
    foreach ($p['subjects'] ?? [] as $s) $names[$s['id']] = $s['name'] ?? '';
    $lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dualshade//Notenapp//DE', 'CALSCALE:GREGORIAN',
        'X-WR-CALNAME:Notenapp', 'X-WR-TIMEZONE:Europe/Berlin', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
    $stamp = gmdate('Ymd\THis\Z');
    $event = function ($uid, $date, $summary, $desc, $alarm) use (&$lines, $stamp) {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $date)) return;
        $d = str_replace('-', '', $date);
        $next = gmdate('Ymd', strtotime($date . ' 12:00:00 UTC') + 86400);
        array_push($lines, 'BEGIN:VEVENT', "UID:$uid@notenapp", "DTSTAMP:$stamp", "DTSTART;VALUE=DATE:$d", "DTEND;VALUE=DATE:$next",
            'SUMMARY:' . ics_text($summary), 'TRANSP:TRANSPARENT');
        if ($desc) $lines[] = 'DESCRIPTION:' . ics_text($desc);
        if ($alarm) array_push($lines, 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' . ics_text($summary), "TRIGGER:$alarm", 'END:VALARM');
        $lines[] = 'END:VEVENT';
    };
    foreach ($p['klausuren'] ?? [] as $k) {
        $name = $names[$k['subjectId'] ?? ''] ?? 'Fach';
        $event('k-' . $k['id'], $k['date'] ?? '', ($k['title'] ?? 'Klausur') . ': ' . $name, $k['info'] ?? '', '-PT6H'); // Vorabend 18 Uhr
    }
    foreach ($p['homework'] ?? [] as $hw) {
        if (!empty($hw['done'])) continue;
        $name = $names[$hw['subjectId'] ?? ''] ?? '';
        $event('h-' . $hw['id'], $hw['due'] ?? '', 'HA ' . ($name ? "$name: " : '') . ($hw['title'] ?? ''), $hw['notes'] ?? '', '-PT6H');
    }
    $lines[] = 'END:VCALENDAR';
    header('Content-Type: text/calendar; charset=utf-8');
    header('Content-Disposition: inline; filename="notenapp.ics"');
    foreach ($lines as $l) echo ics_fold($l);
    exit;
}

// ---------- Routing ----------
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (isset($_GET['ics'])) ics_feed((string) $_GET['ics']);
    out(['ok' => true, 'service' => 'notenapp-api']);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Methode nicht erlaubt.', 405);

$raw = file_get_contents('php://input');
if (strlen($raw) > $MAX_DATA_BYTES + 4096) fail('Daten zu groß.', 413);
$body = json_decode($raw, true);
if (!is_array($body)) fail('Ungültige Anfrage.');
$action = (string) ($body['action'] ?? '');

switch ($action) {
    case 'register': {
        $email = norm_email($body['email'] ?? '');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Bitte eine gültige E-Mail-Adresse eingeben.');
        check_password_rules($body['password'] ?? '');
        if (rate_limited('register:' . client_ip(), 10, 3600)) fail('Zu viele neue Konten von diesem Netz. Bitte später erneut versuchen.', 429);
        $key = hkey($email);
        $token = with_lock('user-' . $key, function () use ($key, $email, $body) {
            if (load('users', $key)) fail('Für diese E-Mail gibt es schon ein Konto. Bitte melde dich an.', 409);
            $user = ['email' => $email, 'hash' => password_hash($body['password'], PASSWORD_DEFAULT), 'created' => time(), 'sessions' => []];
            $t = new_session($key, $user);
            save('users', $key, $user);
            save('data', $key, ['rev' => 0, 'updated' => time(), 'payload' => null]);
            return $t;
        });
        rate_hit('register:' . client_ip(), 3600);
        out(['token' => $token, 'email' => $email, 'rev' => 0]);
    }

    case 'login': {
        $email = norm_email($body['email'] ?? '');
        $password = (string) ($body['password'] ?? '');
        $limitKeys = ['login:' . $email, 'login-ip:' . client_ip()];
        if (rate_limited($limitKeys[0], 10, 900) || rate_limited($limitKeys[1], 30, 900)) {
            fail('Zu viele Fehlversuche. Bitte warte 15 Minuten.', 429);
        }
        $key = hkey($email);
        $user = load('users', $key);
        if (!$user || !password_verify($password, $user['hash'])) {
            foreach ($limitKeys as $k) rate_hit($k, 900);
            fail('E-Mail oder Passwort ist falsch.', 401);
        }
        rate_clear($limitKeys[0]);
        $token = with_lock('user-' . $key, function () use ($key, $password) {
            $user = load('users', $key);
            if (password_needs_rehash($user['hash'], PASSWORD_DEFAULT)) $user['hash'] = password_hash($password, PASSWORD_DEFAULT);
            $t = new_session($key, $user);
            save('users', $key, $user);
            return $t;
        });
        $stored = load('data', $key);
        out(['token' => $token, 'email' => $user['email'], 'rev' => $stored['rev'] ?? 0]);
    }

    case 'logout': {
        [, , $sessionKey] = auth($body);
        remove('sessions', $sessionKey);
        out(['ok' => true]);
    }

    case 'pull': {
        [$key] = auth($body);
        $stored = load('data', $key) ?: ['rev' => 0, 'payload' => null];
        out(['rev' => $stored['rev'], 'data' => $stored['payload'], 'updated' => $stored['updated'] ?? null]);
    }

    case 'push': {
        [$key] = auth($body);
        if (!isset($body['data']) || !is_array($body['data'])) fail('Keine Daten.');
        $encoded = json_encode($body['data']);
        if (strlen($encoded) > $MAX_DATA_BYTES) fail('Daten zu groß.', 413);
        $baseRev = (int) ($body['baseRev'] ?? -1);
        $result = with_lock('data-' . $key, function () use ($key, $baseRev, $body) {
            $stored = load('data', $key) ?: ['rev' => 0, 'payload' => null];
            if ($baseRev !== (int) $stored['rev']) return ['conflict' => true, 'rev' => $stored['rev'], 'data' => $stored['payload']];
            $rev = (int) $stored['rev'] + 1;
            save('data', $key, ['rev' => $rev, 'updated' => time(), 'payload' => $body['data']]);
            return ['rev' => $rev];
        });
        if (!empty($result['conflict'])) out(['error' => 'conflict', 'rev' => $result['rev'], 'data' => $result['data']], 409);
        out($result);
    }

    case 'change_password': {
        [$key, $user, $sessionKey] = auth($body);
        if (!password_verify((string) ($body['oldPassword'] ?? ''), $user['hash'])) fail('Das aktuelle Passwort stimmt nicht.', 403);
        check_password_rules($body['newPassword'] ?? '');
        with_lock('user-' . $key, function () use ($key, $sessionKey, $body) {
            $user = load('users', $key);
            $user['hash'] = password_hash($body['newPassword'], PASSWORD_DEFAULT);
            // Andere Geräte abmelden
            foreach ($user['sessions'] ?? [] as $s) if ($s !== $sessionKey) remove('sessions', $s);
            $user['sessions'] = [$sessionKey];
            save('users', $key, $user);
        });
        out(['ok' => true]);
    }

    case 'delete_account': {
        [$key, $user] = auth($body);
        if (!password_verify((string) ($body['password'] ?? ''), $user['hash'])) fail('Das Passwort stimmt nicht.', 403);
        with_lock('user-' . $key, function () use ($key, $user) {
            foreach ($user['sessions'] ?? [] as $s) remove('sessions', $s);
            if (!empty($user['feed'])) remove('feeds', $user['feed']);
            remove('data', $key);
            remove('users', $key);
        });
        out(['ok' => true]);
    }

    case 'reset_request': {
        global $APP_URL;
        $email = norm_email($body['email'] ?? '');
        $key = hkey($email);
        $user = filter_var($email, FILTER_VALIDATE_EMAIL) ? load('users', $key) : null;
        if ($user && !rate_limited('reset:' . $email, 3, 3600)) {
            rate_hit('reset:' . $email, 3600);
            $t = token();
            save('resets', hkey($t), ['user' => $key, 'expires' => time() + 3600]);
            $link = $APP_URL . '#/passwort/' . $t;
            send_mail($user['email'], 'Notenapp: Passwort zurücksetzen',
                "Hallo,\n\njemand (hoffentlich du) möchte das Passwort für dein Notenapp-Konto zurücksetzen.\n\n" .
                "Neues Passwort festlegen (1 Stunde gültig):\n$link\n\n" .
                "Wenn du das nicht warst, ignoriere diese Mail einfach – dein Passwort bleibt unverändert.\n");
        }
        // Immer gleiche Antwort, damit niemand herausfinden kann, welche E-Mails registriert sind
        out(['ok' => true]);
    }

    case 'reset_confirm': {
        $t = (string) ($body['resetToken'] ?? '');
        if (!preg_match('/^[a-f0-9]{64}$/', $t)) fail('Der Link ist ungültig.', 400);
        $reset = load('resets', hkey($t));
        if (!$reset || $reset['expires'] < time()) { remove('resets', hkey($t)); fail('Der Link ist abgelaufen. Bitte fordere einen neuen an.', 410); }
        check_password_rules($body['password'] ?? '');
        $key = $reset['user'];
        $token = with_lock('user-' . $key, function () use ($key, $body) {
            $user = load('users', $key);
            if (!$user) fail('Konto nicht gefunden.', 404);
            foreach ($user['sessions'] ?? [] as $s) remove('sessions', $s);
            $user['sessions'] = [];
            $user['hash'] = password_hash($body['password'], PASSWORD_DEFAULT);
            $tok = new_session($key, $user);
            save('users', $key, $user);
            return [$tok, $user['email']];
        });
        remove('resets', hkey($t));
        rate_clear('login:' . $token[1]);
        $stored = load('data', $key);
        out(['token' => $token[0], 'email' => $token[1], 'rev' => $stored['rev'] ?? 0]);
    }

    case 'feed': {
        [$key, $user] = auth($body);
        $url = with_lock('user-' . $key, function () use ($key, $body) {
            $user = load('users', $key);
            if (!empty($user['feed'])) remove('feeds', $user['feed']);
            if (!empty($body['disable'])) { unset($user['feed']); save('users', $key, $user); return null; }
            $t = token();
            save('feeds', hkey($t), ['user' => $key]);
            $user['feed'] = hkey($t);
            save('users', $key, $user);
            return self_url() . '?ics=' . $t;
        });
        out(['url' => $url]);
    }

    default:
        fail('Unbekannte Aktion.', 404);
}
