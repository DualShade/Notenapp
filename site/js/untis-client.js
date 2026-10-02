// Minimaler WebUntis-JSON-RPC-Client. Läuft in Node (GitHub Action),
// Cloudflare Workers und überall sonst, wo `fetch` existiert.
// Im Browser direkt geht es wegen CORS nicht – dafür gibt es Action/Proxy.

const CLIENT_NAME = 'notenapp';

export class UntisError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'UntisError';
    this.code = code;
  }
}

function toUntisDate(date) {
  const d = typeof date === 'string' ? new Date(`${date}T12:00:00Z`) : date;
  return Number(d.toISOString().slice(0, 10).replaceAll('-', ''));
}

function encodeBase64(str) {
  if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(str)));
  return Buffer.from(str, 'utf8').toString('base64');
}

function normalizeServer(server) {
  return String(server).trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

export class UntisClient {
  constructor({ server, school, username, password, fetchImpl = globalThis.fetch }) {
    if (!server || !school) throw new UntisError('Untis-Server und Schulname werden benötigt.');
    this.server = normalizeServer(server);
    this.school = school;
    this.username = username;
    this.password = password;
    this.fetch = fetchImpl;
    this.sessionId = null;
    this.person = null;
    this.requestId = 0;
  }

  get url() {
    return `https://${this.server}/WebUntis/jsonrpc.do?school=${encodeURIComponent(this.school)}`;
  }

  async call(method, params = {}) {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    const cookies = [`schoolname="_${encodeBase64(this.school)}"`];
    if (this.sessionId) cookies.push(`JSESSIONID=${this.sessionId}`);
    headers.Cookie = cookies.join('; ');
    const res = await this.fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: String(++this.requestId), method, params, jsonrpc: '2.0' }),
    });
    if (!res.ok) throw new UntisError(`WebUntis antwortet mit HTTP ${res.status} (${method}).`, res.status);
    const data = await res.json();
    if (data.error) throw new UntisError(`${method}: ${data.error.message} (${data.error.code})`, data.error.code);
    return data.result;
  }

  async login() {
    if (!this.username || !this.password) throw new UntisError('Benutzername und Passwort fehlen.');
    const result = await this.call('authenticate', {
      user: this.username,
      password: this.password,
      client: CLIENT_NAME,
    });
    if (!result?.sessionId) throw new UntisError('Login fehlgeschlagen – keine Session erhalten.');
    this.sessionId = result.sessionId;
    this.person = {
      id: result.personId,
      type: result.personType,
      klasseId: result.klasseId,
    };
    return this.person;
  }

  async logout() {
    if (!this.sessionId) return;
    try {
      await this.call('logout', {});
    } catch {
      // Logout-Fehler sind egal.
    }
    this.sessionId = null;
  }

  element() {
    const p = this.person;
    if (p?.id && p.type) return { id: p.id, type: p.type };
    if (p?.klasseId) return { id: p.klasseId, type: 1 };
    throw new UntisError('Konto hat keinen eigenen Stundenplan (weder Schüler noch Klasse).');
  }

  async getTimetable(startDate, endDate) {
    const element = this.element();
    const range = { startDate: toUntisDate(startDate), endDate: toUntisDate(endDate) };
    try {
      return await this.call('getTimetable', {
        options: {
          element,
          ...range,
          showInfo: true,
          showSubstText: true,
          showLsText: true,
          showStudentgroup: true,
          klasseFields: ['id', 'name', 'longname'],
          roomFields: ['id', 'name', 'longname'],
          subjectFields: ['id', 'name', 'longname'],
          teacherFields: ['id', 'name', 'longname'],
        },
      });
    } catch (err) {
      // Ältere/eingeschränkte Konten kennen das options-Format nicht.
      if (!(err instanceof UntisError)) throw err;
      return this.call('getTimetable', { id: element.id, type: element.type, ...range });
    }
  }

  async getTimegrid() {
    try {
      return await this.call('getTimegridUnits', {});
    } catch {
      return [];
    }
  }

  async tryList(method) {
    try {
      return await this.call(method, {});
    } catch {
      return [];
    }
  }
}

function mondayOf(date) {
  const d = new Date(date);
  d.setUTCHours(12, 0, 0, 0);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

/**
 * Lädt den eigenen Stundenplan für mehrere Wochen und gibt die Rohdaten zurück.
 * Ergebnis ist mit `normalizeTimetable` (timetable.js) weiterzuverarbeiten.
 */
export async function fetchUntisTimetable({
  server, school, username, password, weeksBack = 1, weeksAhead = 4, now = new Date(), fetchImpl,
}) {
  const client = new UntisClient({ server, school, username, password, fetchImpl });
  await client.login();
  try {
    const firstMonday = addDays(mondayOf(now), -7 * weeksBack);
    const periods = [];
    const errors = [];
    for (let w = 0; w <= weeksBack + weeksAhead; w++) {
      const start = addDays(firstMonday, 7 * w);
      const end = addDays(start, 6);
      try {
        const week = await client.getTimetable(start, end);
        if (Array.isArray(week)) periods.push(...week);
      } catch (err) {
        errors.push(`${start.toISOString().slice(0, 10)}: ${err.message}`);
      }
    }
    if (!periods.length && errors.length) throw new UntisError(errors[0]);

    const timegrid = await client.getTimegrid();
    // Namenslisten nur nachladen, wenn Untis nur IDs geliefert hat.
    const needsNames = periods.some((p) => (p.su ?? []).some((s) => s.id && !s.name));
    const lookups = needsNames
      ? {
        subjects: await client.tryList('getSubjects'),
        teachers: await client.tryList('getTeachers'),
        rooms: await client.tryList('getRooms'),
        klassen: await client.tryList('getKlassen'),
      }
      : null;

    return {
      fetchedAt: new Date().toISOString(),
      server: client.server,
      school,
      element: client.element(),
      range: {
        from: firstMonday.toISOString().slice(0, 10),
        to: addDays(firstMonday, 7 * (weeksBack + weeksAhead) + 6).toISOString().slice(0, 10),
      },
      timegrid,
      lookups,
      periods,
      warnings: errors,
    };
  } finally {
    await client.logout();
  }
}
