// Konto & Cloud-Sync. Der Server speichert einen Gesamtstand mit Revisionsnummer;
// beim Sync wird der Cloud-Stand mit dem lokalen pro Eintrag zusammengeführt
// (sync-model.js) und nur bei Unterschieden wieder hochgeladen.

import { APP_CONFIG } from './config.js';
import { getState, applyRemote, onLocalChange } from './store.js';
import { toPayload, mergePayloads } from './sync-model.js';

const KEY = 'notenapp:account';
const listeners = new Set();
let account = loadAccount();
let status = { state: account ? 'idle' : 'signed-out', error: null };
let running = null;
let again = false;
let timer = null;

function loadAccount() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}

function saveAccount() {
  try {
    if (account) localStorage.setItem(KEY, JSON.stringify(account));
    else localStorage.removeItem(KEY);
  } catch {
    // Speicher nicht verfügbar
  }
}

function setStatus(next) {
  status = { ...status, ...next };
  listeners.forEach((l) => l(status));
}

export function onSyncStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function syncStatus() {
  return status;
}

export function getAccount() {
  return account;
}

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function api(action, body = {}) {
  if (!APP_CONFIG.apiUrl) throw new ApiError('Kein Server konfiguriert.', 0);
  let res;
  try {
    res = await fetch(APP_CONFIG.apiUrl, {
      method: 'POST',
      // text/plain = keine CORS-Vorabanfrage nötig
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action, ...body }),
    });
  } catch {
    throw new ApiError('Keine Verbindung zum Server.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Serverfehler (${res.status})`, res.status, data);
  return data;
}

function authed(action, body = {}) {
  if (!account) throw new ApiError('Nicht angemeldet.', 401);
  return api(action, { ...body, token: account.token }).catch((err) => {
    if (err.status === 401) signOutLocally(err.message);
    throw err;
  });
}

function signOutLocally(reason = null) {
  account = null;
  saveAccount();
  setStatus({ state: 'signed-out', error: reason });
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function runSync() {
  setStatus({ state: 'syncing', error: null });
  for (let attempt = 0; attempt < 4; attempt++) {
    const remote = await authed('pull');
    const local = toPayload(getState());
    const merged = mergePayloads(local, remote.data);
    if (!same(merged, local)) applyRemote(merged);
    if (remote.data && same(merged, remote.data)) {
      account.rev = remote.rev;
      break;
    }
    try {
      const pushed = await authed('push', { baseRev: remote.rev, data: merged });
      account.rev = pushed.rev;
      break;
    } catch (err) {
      if (err.status !== 409) throw err; // anderes Gerät war schneller → neu zusammenführen
    }
  }
  account.lastSyncAt = new Date().toISOString();
  saveAccount();
  setStatus({ state: 'idle', error: null });
}

/** Jetzt synchronisieren (mehrfache Aufrufe werden zusammengefasst). */
export async function syncNow() {
  if (!account) return;
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await runSync();
      } while (again);
    } catch (err) {
      if (account) setStatus({ state: navigator.onLine === false || err.status === 0 ? 'offline' : 'error', error: err.message });
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Nach einer Änderung kurz warten und dann synchronisieren. */
export function scheduleSync(delay = 1500) {
  if (!account) return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, delay);
}

async function signedIn(result) {
  account = { email: result.email, token: result.token, rev: 0, lastSyncAt: null, feedUrl: null };
  saveAccount();
  // Lokale Daten und Cloud-Daten werden zusammengeführt – es geht nichts verloren.
  await syncNow();
  if (status.state === 'error') throw new ApiError(status.error, 500);
}

export async function register(email, password) {
  await signedIn(await api('register', { email, password }));
}

export async function login(email, password) {
  await signedIn(await api('login', { email, password }));
}

export async function logout() {
  try {
    await authed('logout');
  } catch {
    // Server nicht erreichbar → trotzdem lokal abmelden
  }
  signOutLocally();
}

export async function changePassword(oldPassword, newPassword) {
  await authed('change_password', { oldPassword, newPassword });
}

export async function deleteAccount(password) {
  await authed('delete_account', { password });
  signOutLocally();
}

export async function requestReset(email) {
  await api('reset_request', { email });
}

export async function confirmReset(resetToken, password) {
  await signedIn(await api('reset_confirm', { resetToken, password }));
}

/** Kalender-Abo-Link erzeugen (ein neuer Link macht den alten ungültig). */
export async function createFeed({ disable = false } = {}) {
  const { url } = await authed('feed', { disable });
  account.feedUrl = url;
  saveAccount();
  setStatus({});
  return url;
}

/** Automatischen Sync einrichten: nach Änderungen, beim Öffnen, wenn wieder online. */
export function startSync() {
  onLocalChange(() => scheduleSync());
  window.addEventListener('online', () => scheduleSync(0));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync(0);
  });
  // Beim Schließen/Wechseln der App ausstehende Änderungen sofort senden
  window.addEventListener('pagehide', () => { if (timer) { clearTimeout(timer); syncNow(); } });
  if (account) syncNow();
}
