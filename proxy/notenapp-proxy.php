<?php
// Notenapp-Proxy für normalen PHP-Webspace (z. B. IONOS, PHP ≥ 7.1 mit curl).
// Einfach hochladen, z. B. nach https://deine-domain.de/notenapp-proxy.php – fertig.
// Gleiches Protokoll wie proxy/worker.js:
//
//   POST ?route=rpc    {url, cookie, body}  → leitet JSON-RPC an *.webuntis.com weiter
//                      {url, method:"GET", cookie} → GET auf /WebUntis/api/… (Hausaufgaben)
//   GET  ?route=fetch&url=…                 → Homepage/PDF abrufen (nur ALLOWED_HOSTS,
//                                             auch bei Weiterleitungen)
//
// Der Proxy speichert und protokolliert nichts.

// ---- Einstellungen ---------------------------------------------------------
// Von welcher Website aus darf der Proxy benutzt werden? ('*' = von überall)
$ALLOWED_ORIGIN = getenv('NOTENAPP_ALLOWED_ORIGIN') ?: 'https://dualshade.github.io';
// Schul-Homepage(s) für den Klausurplan-Abruf, kommagetrennt
$ALLOWED_HOSTS = getenv('NOTENAPP_ALLOWED_HOSTS') ?: '';
// ----------------------------------------------------------------------------

// Nur für automatische Tests: andere Untis-Hosts, HTTP und andere Ports erlauben
$RPC_HOST_PATTERN = getenv('NOTENAPP_RPC_HOST_PATTERN') ?: '/(^|\.)webuntis\.com$/i';
$RPC_ALLOW_HTTP = getenv('NOTENAPP_RPC_ALLOW_HTTP') === '1';

header('Access-Control-Allow-Origin: ' . $ALLOWED_ORIGIN);
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Max-Age: 86400');
header('Cache-Control: no-store');
if ($ALLOWED_ORIGIN !== '*') header('Vary: Origin');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function respond_json($data, $status = 200) {
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function host_allowed($list, $host) {
    foreach (array_filter(array_map('trim', explode(',', strtolower($list)))) as $h) {
        $suffix = '.' . $h;
        if ($host === $h || substr($host, -strlen($suffix)) === $suffix) return true;
    }
    return false;
}

// Prüft eine Adresse für route=fetch: nur http/https, Host in ALLOWED_HOSTS, keine
// Zugangsdaten (user:pass@). Gilt für die erste Adresse und jedes Weiterleitungsziel
// gleich. Liefert [Adresse, null] oder [null, Fehlermeldung]. Die Adresse wird aus den
// geprüften Teilen neu gebaut, damit curl keinen anderen Host herausliest als parse_url().
function fetch_target($url, $allowedHosts) {
    $parts = parse_url($url);
    if (!is_array($parts)) $parts = [];
    $scheme = strtolower($parts['scheme'] ?? '');
    $host = strtolower($parts['host'] ?? '');
    if (!in_array($scheme, ['http', 'https'], true) || !preg_match('/\A[a-z0-9._-]+\z/', $host)
        || !host_allowed($allowedHosts, $host)) {
        return [null, "Host $host ist nicht freigegeben (ALLOWED_HOSTS)."];
    }
    if (isset($parts['user']) || isset($parts['pass'])) return [null, 'Zugangsdaten in der Adresse sind nicht erlaubt.'];
    $path = $parts['path'] ?? '';
    if ($path === '' || $path[0] !== '/') $path = '/' . $path;
    return [$scheme . '://' . $host . (isset($parts['port']) ? ':' . $parts['port'] : '') . $path
        . (isset($parts['query']) ? '?' . $parts['query'] : ''), null];
}

// Löst eine Location-Angabe gegen die aktuelle Adresse auf (RFC 3986, Abschnitt 5.2):
// absolut, protokollrelativ (//host/…), pfadabsolut (/…), pfadrelativ (plan.pdf, ../x)
// oder nur ?query. Leerzeichen und Bytes über 127 kodiert curl bei Weiterleitungen
// selbst; hier genauso, dazu Steuerzeichen. Der #Anker fällt weg, er geht nie an den Server.
function resolve_location($base, $ref) {
    $ref = preg_replace_callback('/[\x00-\x20\x7f-\xff]/', function ($m) { return rawurlencode($m[0]); }, $ref);
    // Schema, Authority, Pfad, Query, jeweils mit Trennzeichen: leer heißt „nicht da“
    $re = '~^([a-z][a-z0-9+.-]*:)?(//[^/?#]*)?([^?#]*)(\?[^#]*)?~i';
    preg_match($re, $base, $b);
    preg_match($re, $ref, $r);
    $b += ['', '', '', '', ''];
    $r += ['', '', '', '', ''];
    if ($r[1] !== '') return $r[1] . $r[2] . remove_dot_segments($r[3]) . $r[4];
    if ($r[2] !== '') return $b[1] . $r[2] . remove_dot_segments($r[3]) . $r[4];
    if ($r[3] === '') return $b[1] . $b[2] . $b[3] . ($r[4] !== '' ? $r[4] : $b[4]);
    if ($r[3][0] !== '/') {
        // Verzeichnis der aktuellen Adresse davor (bis einschließlich des letzten /)
        $slash = strrpos($b[3], '/');
        $dir = ($b[2] !== '' && $b[3] === '') ? '/' : ($slash === false ? '' : substr($b[3], 0, $slash + 1));
        $r[3] = $dir . $r[3];
    }
    return $b[1] . $b[2] . remove_dot_segments($r[3]) . $r[4];
}

// Punkt-Segmente (./ und ../) entfernen, RFC 3986, Abschnitt 5.2.4
function remove_dot_segments($path) {
    $out = '';
    while ($path !== '') {
        if (strpos($path, '../') === 0) $path = substr($path, 3);
        elseif (strpos($path, './') === 0 || strpos($path, '/./') === 0) $path = substr($path, 2);
        elseif ($path === '/.') $path = '/';
        elseif (strpos($path, '/../') === 0 || $path === '/..') {
            $path = '/' . substr($path, 4);
            $out = substr($out, 0, (int) strrpos($out, '/'));
        } elseif ($path === '.' || $path === '..') $path = '';
        else {
            $next = strpos($path, '/', 1);
            if ($next === false) $next = strlen($path);
            $out .= substr($path, 0, $next);
            $path = substr($path, $next);
        }
    }
    return $out;
}

// curl folgt keiner Weiterleitung selbst (route=fetch macht das mit Prüfung jedes Ziels)
// und spricht nur http und https. Liefert [Status, Content-Type, Body, Location].
function forward($url, $method, $headers, $body = null, $timeout = 30) {
    $location = '';
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_HEADER => false,
        CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$location) {
            // Eine neue Statuszeile (etwa nach 100 Continue) beginnt eine neue Antwort
            if (stripos($line, 'HTTP/') === 0) $location = '';
            elseif ($location === '' && stripos($line, 'Location:') === 0) $location = trim(substr($line, 9));
            return strlen($line);
        },
    ]);
    // Ab curl 7.85 sind CURLOPT_PROTOCOLS und CURLOPT_REDIR_PROTOCOLS veraltet; die
    // *_STR-Varianten dafür gibt es ab PHP 8.3.
    if (defined('CURLOPT_PROTOCOLS_STR')) {
        curl_setopt($ch, CURLOPT_PROTOCOLS_STR, 'http,https');
        curl_setopt($ch, CURLOPT_REDIR_PROTOCOLS_STR, 'http,https');
    } else {
        curl_setopt($ch, CURLOPT_PROTOCOLS, CURLPROTO_HTTP | CURLPROTO_HTTPS);
        curl_setopt($ch, CURLOPT_REDIR_PROTOCOLS, CURLPROTO_HTTP | CURLPROTO_HTTPS);
    }
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $response = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $type = curl_getinfo($ch, CURLINFO_CONTENT_TYPE) ?: 'application/octet-stream';
    $error = curl_error($ch);
    // Ab PHP 8.0 schließt PHP das Handle selbst; ab 8.5 ist curl_close() veraltet
    // und die Warnung würde die JSON-Antwort zerstören.
    if (PHP_VERSION_ID < 80000) curl_close($ch);
    if ($response === false) respond_json(['error' => 'Proxy-Fehler: ' . $error], 502);
    return [$status, $type, $response, $location];
}

$route = $_GET['route'] ?? '';

if ($route === 'rpc' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $payload = json_decode(file_get_contents('php://input'), true);
    if (!is_array($payload) || !is_string($payload['url'] ?? null) || $payload['url'] === '') {
        respond_json(['error' => 'Ungültige Anfrage.'], 400);
    }
    $parts = parse_url($payload['url']);
    $scheme = $parts['scheme'] ?? '';
    $host = strtolower($parts['host'] ?? '');
    $schemeOk = $scheme === 'https' || ($RPC_ALLOW_HTTP && $scheme === 'http');
    // Nur der Standard-Port: ein Port, der nicht antwortet, hielte PHP bis zum Timeout fest.
    $portOk = !isset($parts['port']) || $parts['port'] === 443 || $RPC_ALLOW_HTTP;
    if (!$schemeOk || !$portOk || !preg_match($RPC_HOST_PATTERN, $host)) {
        respond_json(['error' => 'Nur https://*.webuntis.com ist erlaubt.'], 403);
    }
    $method = $payload['method'] ?? 'POST';
    if (!is_string($method)) respond_json(['error' => 'Ungültige Methode.'], 400);
    $method = strtoupper($method);
    // GET nur für die REST-API (Hausaufgaben), alles andere ist JSON-RPC per POST. Im Pfad
    // nur Buchstaben, Ziffern, _ - und /: Punkt-Segmente wie /../, ..;/ oder %2e lösen curl
    // oder der Untis-Server erst nach dieser Prüfung auf.
    $path = $parts['path'] ?? '';
    if ($method === 'GET' && !preg_match('#^/WebUntis/api/[A-Za-z0-9_/-]+\z#', $path)) {
        respond_json(['error' => 'GET nur für /WebUntis/api/ erlaubt.'], 403);
    }
    if ($method !== 'GET' && $method !== 'POST') respond_json(['error' => 'Ungültige Methode.'], 400);
    $headers = ['Content-Type: application/json', 'Accept: application/json', 'User-Agent: Notenapp'];
    $cookie = $payload['cookie'] ?? '';
    if (is_scalar($cookie) && (string) $cookie !== '') {
        $headers[] = 'Cookie: ' . preg_replace('/[\r\n]/', '', substr((string) $cookie, 0, 2000));
    }
    $rpcBody = $payload['body'] ?? '';
    list($status, , $body) = $method === 'GET'
        ? forward($payload['url'], 'GET', $headers)
        : forward($payload['url'], 'POST', $headers, is_scalar($rpcBody) ? (string) $rpcBody : '');
    http_response_code($status);
    header('Content-Type: application/json');
    echo $body;
    exit;
}

if ($route === 'fetch' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    $url = $_GET['url'] ?? '';
    if (!is_string($url)) respond_json(['error' => 'Ungültige URL.'], 400);
    // Weiterleitungen verfolgt der Proxy selbst, höchstens 5, und prüft jedes Ziel wie die
    // erste Adresse. Folgte curl selbst, käme eine freigegebene Homepage, die weiterleitet,
    // an jede Adresse heran, auch an interne des Servers. Alle Abrufe zusammen haben
    // 30 Sekunden, wie vorher curl mit seinen Weiterleitungen.
    $deadline = microtime(true) + 30;
    for ($redirects = 0; ; $redirects++) {
        list($target, $error) = fetch_target($url, $ALLOWED_HOSTS);
        if ($target === null) respond_json(['error' => ($redirects ? 'Weiterleitung: ' : '') . $error], 403);
        list($status, $type, $body, $location) = forward($target, 'GET', ['User-Agent: Mozilla/5.0 (Notenapp-Proxy)'], null,
            max(1, (int) ceil($deadline - microtime(true))));
        if (!in_array($status, [301, 302, 303, 307, 308], true) || $location === '') break;
        if ($redirects === 5) respond_json(['error' => 'Proxy-Fehler: mehr als 5 Weiterleitungen.'], 502);
        $url = resolve_location($target, $location);
    }
    http_response_code($status);
    header('Content-Type: ' . $type);
    echo $body;
    exit;
}

respond_json(['ok' => true, 'service' => 'notenapp-proxy', 'version' => 4, 'features' => ['homework'], 'routes' => ['POST ?route=rpc', 'GET ?route=fetch&url=']]);
