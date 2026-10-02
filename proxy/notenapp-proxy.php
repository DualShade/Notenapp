<?php
// Notenapp-Proxy für normalen PHP-Webspace (z. B. IONOS, PHP ≥ 7.1 mit curl).
// Einfach hochladen, z. B. nach https://deine-domain.de/notenapp-proxy.php – fertig.
// Gleiches Protokoll wie proxy/worker.js:
//
//   POST ?route=rpc    {url, cookie, body}  → leitet JSON-RPC an *.webuntis.com weiter
//   GET  ?route=fetch&url=…                 → Homepage/PDF abrufen (nur ALLOWED_HOSTS)
//
// Der Proxy speichert und protokolliert nichts.

// ---- Einstellungen ---------------------------------------------------------
// Von welcher Website aus darf der Proxy benutzt werden? ('*' = von überall)
$ALLOWED_ORIGIN = getenv('NOTENAPP_ALLOWED_ORIGIN') ?: 'https://dualshade.github.io';
// Schul-Homepage(s) für den Klausurplan-Abruf, kommagetrennt
$ALLOWED_HOSTS = getenv('NOTENAPP_ALLOWED_HOSTS') ?: '';
// ----------------------------------------------------------------------------

// Nur für automatische Tests: andere Untis-Hosts/HTTP erlauben
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

function forward($url, $method, $headers, $body = null) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => $method === 'GET',
        CURLOPT_MAXREDIRS => 5,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_HEADER => false,
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $response = curl_exec($ch);
    if ($response === false) {
        $error = curl_error($ch);
        curl_close($ch);
        respond_json(['error' => 'Proxy-Fehler: ' . $error], 502);
    }
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $type = curl_getinfo($ch, CURLINFO_CONTENT_TYPE) ?: 'application/octet-stream';
    curl_close($ch);
    return [$status, $type, $response];
}

$route = $_GET['route'] ?? '';

if ($route === 'rpc' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $payload = json_decode(file_get_contents('php://input'), true);
    if (!is_array($payload) || empty($payload['url'])) respond_json(['error' => 'Ungültige Anfrage.'], 400);
    $parts = parse_url($payload['url']);
    $scheme = $parts['scheme'] ?? '';
    $host = strtolower($parts['host'] ?? '');
    $schemeOk = $scheme === 'https' || ($RPC_ALLOW_HTTP && $scheme === 'http');
    if (!$schemeOk || !preg_match($RPC_HOST_PATTERN, $host)) {
        respond_json(['error' => 'Nur https://*.webuntis.com ist erlaubt.'], 403);
    }
    $headers = ['Content-Type: application/json', 'Accept: application/json', 'User-Agent: Notenapp'];
    if (!empty($payload['cookie'])) {
        $headers[] = 'Cookie: ' . preg_replace('/[\r\n]/', '', substr((string) $payload['cookie'], 0, 2000));
    }
    list($status, , $body) = forward($payload['url'], 'POST', $headers, (string) ($payload['body'] ?? ''));
    http_response_code($status);
    header('Content-Type: application/json');
    echo $body;
    exit;
}

if ($route === 'fetch' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    $url = $_GET['url'] ?? '';
    $parts = parse_url($url);
    $host = strtolower($parts['host'] ?? '');
    if (!in_array($parts['scheme'] ?? '', ['http', 'https'], true) || !host_allowed($ALLOWED_HOSTS, $host)) {
        respond_json(['error' => "Host $host ist nicht freigegeben (ALLOWED_HOSTS)."], 403);
    }
    list($status, $type, $body) = forward($url, 'GET', ['User-Agent: Mozilla/5.0 (Notenapp-Proxy)']);
    http_response_code($status);
    header('Content-Type: ' . $type);
    echo $body;
    exit;
}

respond_json(['ok' => true, 'service' => 'notenapp-proxy', 'routes' => ['POST ?route=rpc', 'GET ?route=fetch&url=']]);
