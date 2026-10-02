// Nachgebauter WebUntis-Server (Schulsuche + JSON-RPC) für Tests.
import { createServer } from 'node:http';

export const MOCK_SCHOOLS = [
  { displayName: 'Gymnasium Musterstadt', address: '12345 Musterstadt, Schulweg 1', server: 'mock.webuntis.com', loginName: 'gym-musterstadt', schoolId: 1, serverUrl: 'https://mock.webuntis.com/WebUntis/?school=gym-musterstadt' },
  { displayName: 'Gesamtschule Musterstadt', address: '12345 Musterstadt, Parkallee 3', server: 'mock.webuntis.com', loginName: 'ge-musterstadt', schoolId: 2, serverUrl: '' },
];

function untisDate(d) {
  return Number(d.toISOString().slice(0, 10).replaceAll('-', ''));
}

/** Beantwortet einen JSON-RPC-Aufruf. Liefert {status, json}. */
export function handleUntis(pathname, rpc, cookie = '') {
  const ok = (result) => ({ status: 200, json: { jsonrpc: '2.0', id: rpc.id, result } });
  const err = (code, message) => ({ status: 200, json: { jsonrpc: '2.0', id: rpc.id, error: { code, message } } });
  if (pathname.endsWith('/schoolquery2')) {
    const q = String(rpc.params?.[0]?.search ?? '').toLowerCase();
    if (q === 'schule') return err(-6003, 'too many results');
    return ok({ size: 2, schools: MOCK_SCHOOLS.filter((s) => s.displayName.toLowerCase().includes(q) || s.address.toLowerCase().includes(q)) });
  }
  switch (rpc.method) {
    case 'authenticate':
      return rpc.params.user === 'max' && rpc.params.password === 'geheim'
        ? ok({ sessionId: 'SESSION42', personType: 5, personId: 7, klasseId: 1 })
        : err(-8504, 'bad credentials');
    case 'getTimetable': {
      if (!/JSESSIONID=SESSION42/.test(cookie)) return err(-8520, 'not authenticated');
      const start = String(rpc.params.options.startDate);
      const monday = new Date(Date.UTC(+start.slice(0, 4), +start.slice(4, 6) - 1, +start.slice(6, 8)));
      const day = (n) => untisDate(new Date(monday.getTime() + n * 86400000));
      const p = (d, s, e, su, long, sg) => ({ id: d * 10000 + s, date: d, startTime: s, endTime: e, su: [{ id: 1, name: su, longname: long }], te: [{ id: 1, name: 'ABC' }], ro: [{ id: 1, name: 'R1' }], kl: [], sg });
      return ok([
        p(day(0), 800, 930, 'M', 'Mathematik', 'M-L1'), p(day(2), 800, 930, 'M', 'Mathematik', 'M-L1'), p(day(4), 800, 845, 'M', 'Mathematik', 'M-L1'),
        p(day(1), 800, 930, 'D', 'Deutsch', 'D-G1'), p(day(3), 800, 845, 'D', 'Deutsch', 'D-G1'),
      ]);
    }
    case 'getTimegridUnits':
      return ok([{ day: 2, timeUnits: [{ name: '1', startTime: 800, endTime: 845 }, { name: '2', startTime: 845, endTime: 930 }] }]);
    case 'logout':
      return ok(null);
    default:
      return err(-32601, 'method not found');
  }
}

/** Startet den Mock als HTTP-Server. */
export function startMockUntisServer() {
  const calls = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const rpc = JSON.parse(body || '{}');
    calls.push({ method: rpc.method, cookie: req.headers.cookie ?? '' });
    const { status, json } = handleUntis(new URL(req.url, 'http://x').pathname, rpc, req.headers.cookie ?? '');
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(json));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, calls })));
}
