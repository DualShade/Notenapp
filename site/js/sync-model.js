// Änderungsverfolgung und Zusammenführen für den Cloud-Sync.
//
// Jeder Eintrag (Fach, Note, Klausur, …) bekommt beim Ändern `updatedAt`.
// Gelöschte Einträge landen als Grabstein in `deleted[collection][id]`.
// Beim Sync werden zwei Stände pro Eintrag zusammengeführt: der neuere gewinnt,
// eine spätere Löschung schlägt eine ältere Änderung. So gehen auch Änderungen,
// die offline auf mehreren Geräten gemacht wurden, nicht verloren.

export const COLLECTIONS = ['subjects', 'grades', 'klausuren', 'homework', 'absences', 'finals'];

// Einstellungen, die nur auf diesem Gerät gelten bzw. nie hochgeladen werden.
const LOCAL_SETTINGS = ['proxyUrl', 'theme'];
const TOMBSTONE_DAYS = 365;

function withoutStamp(item) {
  const { updatedAt, ...rest } = item;
  return JSON.stringify(rest);
}

/** Einstellungen ohne lokale/geheime Teile (Untis-Passwort bleibt auf dem Gerät). */
export function syncableSettings(settings) {
  const out = { ...settings };
  for (const key of LOCAL_SETTINGS) delete out[key];
  if (out.untis) out.untis = { ...out.untis, password: '' };
  return out;
}

/** Momentaufnahme zum späteren Vergleich. */
export function buildIndex(state) {
  const index = { settings: JSON.stringify(syncableSettings(state.settings)), ignored: JSON.stringify(state.ignoredKlausurKeys ?? []) };
  for (const c of COLLECTIONS) {
    index[c] = new Map((state[c] ?? []).map((item) => [item.id, withoutStamp(item)]));
  }
  return index;
}

/**
 * Vergleicht den Zustand mit der letzten Momentaufnahme, setzt Zeitstempel und
 * Grabsteine und liefert die neue Momentaufnahme. `changed` sagt, ob sich
 * etwas Synchronisierbares geändert hat.
 */
export function trackChanges(index, state, now = Date.now()) {
  let changed = false;
  state.deleted ??= {};
  for (const c of COLLECTIONS) {
    state[c] ??= [];
    const prev = index?.[c] ?? new Map();
    const seen = new Set();
    for (const item of state[c]) {
      seen.add(item.id);
      const json = withoutStamp(item);
      if (prev.get(item.id) !== json) {
        item.updatedAt = now;
        changed = true;
        if (state.deleted[c]?.[item.id]) delete state.deleted[c][item.id]; // wiederhergestellt
      }
    }
    for (const id of prev.keys()) {
      if (!seen.has(id)) {
        state.deleted[c] ??= {};
        state.deleted[c][id] = now;
        changed = true;
      }
    }
  }
  const settingsJson = JSON.stringify(syncableSettings(state.settings));
  if (index && index.settings !== settingsJson) {
    state.settingsUpdatedAt = now;
    changed = true;
  }
  const ignoredJson = JSON.stringify(state.ignoredKlausurKeys ?? []);
  if (index && index.ignored !== ignoredJson) changed = true;
  return { index: buildIndex(state), changed: changed && !!index };
}

/** Was hochgeladen wird. */
export function toPayload(state) {
  const payload = {
    version: state.version,
    settings: syncableSettings(state.settings),
    settingsUpdatedAt: state.settingsUpdatedAt ?? 0,
    ignoredKlausurKeys: state.ignoredKlausurKeys ?? [],
    deleted: state.deleted ?? {},
  };
  for (const c of COLLECTIONS) payload[c] = state[c] ?? [];
  return payload;
}

function pruneTombstones(deleted, now) {
  const limit = now - TOMBSTONE_DAYS * 86400000;
  const out = {};
  for (const [c, ids] of Object.entries(deleted ?? {})) {
    for (const [id, ts] of Object.entries(ids ?? {})) {
      if (ts >= limit) (out[c] ??= {})[id] = ts;
    }
  }
  return out;
}

/** Zwei Stände zusammenführen (pro Eintrag, neuere Änderung gewinnt). */
export function mergePayloads(local, remote, now = Date.now()) {
  if (!remote) return local;
  if (!local) return remote;
  const deleted = {};
  for (const src of [local.deleted, remote.deleted]) {
    for (const [c, ids] of Object.entries(src ?? {})) {
      for (const [id, ts] of Object.entries(ids ?? {})) {
        deleted[c] ??= {};
        deleted[c][id] = Math.max(deleted[c][id] ?? 0, ts);
      }
    }
  }
  const merged = {
    version: Math.max(local.version ?? 1, remote.version ?? 1),
    settings: (remote.settingsUpdatedAt ?? 0) > (local.settingsUpdatedAt ?? 0) ? remote.settings : local.settings,
    settingsUpdatedAt: Math.max(local.settingsUpdatedAt ?? 0, remote.settingsUpdatedAt ?? 0),
    ignoredKlausurKeys: [...new Set([...(local.ignoredKlausurKeys ?? []), ...(remote.ignoredKlausurKeys ?? [])])],
  };
  for (const c of COLLECTIONS) {
    const byId = new Map();
    for (const item of remote[c] ?? []) byId.set(item.id, item);
    for (const item of local[c] ?? []) {
      const other = byId.get(item.id);
      // Bei Gleichstand gewinnt der lokale Stand
      if (!other || (item.updatedAt ?? 0) >= (other.updatedAt ?? 0)) byId.set(item.id, item);
    }
    merged[c] = [...byId.values()].filter((item) => !(deleted[c]?.[item.id] >= (item.updatedAt ?? 0)));
    // Löschungen, die von einer späteren Änderung überholt wurden, aufheben
    for (const item of merged[c]) if (deleted[c]?.[item.id]) delete deleted[c][item.id];
  }
  merged.deleted = pruneTombstones(deleted, now);
  return merged;
}

/** Zusammengeführten Stand in den lokalen Zustand übernehmen (lokale Einstellungen bleiben). */
export function applyPayload(state, payload) {
  for (const c of COLLECTIONS) state[c] = structuredClone(payload[c] ?? []);
  state.deleted = structuredClone(payload.deleted ?? {});
  state.ignoredKlausurKeys = [...(payload.ignoredKlausurKeys ?? [])];
  state.settingsUpdatedAt = payload.settingsUpdatedAt ?? 0;
  if (payload.settings) {
    const local = state.settings;
    const password = local.untis?.password ?? '';
    state.settings = { ...local, ...structuredClone(payload.settings) };
    for (const key of LOCAL_SETTINGS) state.settings[key] = local[key];
    // Gleiches Untis-Konto → lokal gespeichertes Passwort behalten
    const sameAccount = state.settings.untis?.username === local.untis?.username && state.settings.untis?.school === local.untis?.school;
    state.settings.untis = { ...state.settings.untis, password: sameAccount ? password : '' };
  }
  return state;
}

/** Hat ein Stand irgendwelche Nutzerdaten? */
export function hasUserData(payload) {
  return COLLECTIONS.some((c) => (payload?.[c] ?? []).length > 0);
}
