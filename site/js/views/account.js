import { h, icon, field, toast, confirmDialog, formatDateTime, setChildren } from '../ui.js';
import { getState } from '../store.js';
import {
  getAccount, syncStatus, syncNow, login, register, logout, requestReset, confirmReset,
  changePassword, deleteAccount, createFeed,
} from '../sync.js';
import { hasUserData, toPayload } from '../sync-model.js';

let mode = 'login'; // login | register | forgot

function passwordInput(autocomplete = 'current-password') {
  return h('input', { type: 'password', autocomplete, minlength: 8, required: true });
}

function busyButton(label) {
  return h('button', { type: 'submit', class: 'btn primary block' }, label);
}

async function withBusy(button, fn) {
  const label = button.textContent;
  button.disabled = true;
  button.replaceChildren(h('span', { class: 'spinner small-spinner' }), ' Bitte warten …');
  try {
    await fn();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

function signedOutView() {
  const wrap = h('div', { class: 'stack' });
  const render = () => {
    const email = h('input', { type: 'email', autocomplete: 'email', required: true, placeholder: 'du@beispiel.de' });
    const tabs = h('div', { class: 'segmented' },
      ['login', 'register'].map((m) => h('button', {
        type: 'button', class: mode === m ? 'active' : '', onclick: () => { mode = m; render(); },
      }, m === 'login' ? 'Anmelden' : 'Registrieren')));

    if (mode === 'forgot') {
      const submit = busyButton('Link senden');
      setChildren(wrap,
        h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); withBusy(submit, async () => {
          await requestReset(email.value.trim());
          toast('Falls ein Konto existiert, ist eine E-Mail unterwegs.', 'success');
          mode = 'login';
          render();
        }); } },
        h('p', { class: 'muted small' }, 'Gib deine E-Mail-Adresse ein. Du bekommst einen Link, mit dem du ein neues Passwort festlegen kannst.'),
        field('E-Mail', email),
        submit,
        h('button', { type: 'button', class: 'btn ghost', onclick: () => { mode = 'login'; render(); } }, 'Zurück zur Anmeldung')));
      return;
    }

    const password = passwordInput(mode === 'register' ? 'new-password' : 'current-password');
    const repeat = mode === 'register' ? passwordInput('new-password') : null;
    const submit = busyButton(mode === 'register' ? 'Konto erstellen' : 'Anmelden');
    const local = hasUserData(toPayload(getState()));
    setChildren(wrap,
      tabs,
      h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); withBusy(submit, async () => {
        if (repeat && repeat.value !== password.value) throw new Error('Die Passwörter stimmen nicht überein.');
        if (mode === 'register') await register(email.value.trim(), password.value);
        else await login(email.value.trim(), password.value);
        toast(mode === 'register' ? 'Konto erstellt – deine Daten sind jetzt gesichert.' : 'Angemeldet und synchronisiert.', 'success');
      }); } },
      field('E-Mail', email),
      field('Passwort', password, mode === 'register' ? 'Mindestens 8 Zeichen.' : null),
      repeat ? field('Passwort wiederholen', repeat) : null,
      submit,
      mode === 'login' ? h('button', { type: 'button', class: 'btn ghost small', onclick: () => { mode = 'forgot'; render(); } }, 'Passwort vergessen?') : null),
      local ? h('p', { class: 'hint' }, icon('check', 14), ' Deine Noten auf diesem Gerät werden übernommen und mit dem Konto zusammengeführt – es geht nichts verloren.') : null);
  };
  render();
  return h('div', { class: 'view' },
    h('section', { class: 'card hero' },
      h('h2', {}, 'Nie wieder Noten verlieren'),
      h('p', { class: 'muted' }, 'Mit einem Konto werden deine Noten, Fächer, Klausuren und Hausaufgaben automatisch gesichert und zwischen Handy, Tablet und PC synchronisiert – auch offline.'),
      wrap),
    privacyNote());
}

function privacyNote() {
  return h('p', { class: 'muted small' },
    'Datenschutz: Die Daten liegen verschlüsselt übertragen auf einem Server in Deutschland (IONOS). Dein Untis-Passwort wird nie hochgeladen. Passwörter werden nur als sicherer Hash gespeichert. Du kannst dein Konto jederzeit vollständig löschen.');
}

function statusLine() {
  const st = syncStatus();
  const account = getAccount();
  const text = {
    syncing: 'Synchronisiere …',
    idle: account?.lastSyncAt ? `Synchronisiert ${formatDateTime(account.lastSyncAt)}` : 'Noch nicht synchronisiert',
    offline: 'Offline – wird synchronisiert, sobald du wieder online bist',
    error: `Fehler: ${st.error}`,
  }[st.state] ?? '';
  return h('div', { class: `sync-line ${st.state}` }, icon(st.state === 'error' ? 'alert' : st.state === 'syncing' ? 'refresh' : 'check', 18), h('span', {}, text));
}

function signedInView(account) {
  const oldPw = passwordInput();
  const newPw = passwordInput('new-password');
  const pwSubmit = busyButton('Passwort ändern');
  const feedBox = h('div', { class: 'stack' });
  const renderFeed = () => {
    const url = getAccount()?.feedUrl;
    setChildren(feedBox,
      h('p', { class: 'muted small' }, 'Abonniere deine Klausuren und Hausaufgaben im Kalender deines Handys (Apple, Google, Outlook). Du bekommst am Vorabend um 18 Uhr eine Erinnerung – auch wenn die App geschlossen ist.'),
      url ? h('div', { class: 'stack' },
        h('input', { type: 'text', readonly: true, value: url, onfocus: (e) => e.target.select() }),
        h('div', { class: 'row gap wrap' },
          h('a', { class: 'btn primary', href: url.replace(/^https?:/, 'webcal:') }, icon('calendar', 18), 'Im Kalender abonnieren'),
          h('button', { class: 'btn', onclick: async () => { await navigator.clipboard?.writeText(url); toast('Link kopiert.'); } }, 'Link kopieren'),
          h('button', { class: 'btn ghost', onclick: async () => {
            if (await confirmDialog('Neuen Link erzeugen? Der alte Link funktioniert dann nicht mehr.', { ok: 'Neu erzeugen', danger: false })) {
              try { await createFeed(); renderFeed(); } catch (err) { toast(err.message, 'error'); }
            }
          } }, 'Neuer Link')),
        h('small', { class: 'hint' }, 'Halte den Link geheim – wer ihn kennt, sieht deine Termine.'))
        : h('button', { class: 'btn primary', onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          try { await createFeed(); renderFeed(); } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
        } }, icon('calendar', 18), 'Kalender-Abo einrichten'));
  };
  renderFeed();

  return h('div', { class: 'view' },
    h('section', { class: 'card hero' },
      h('div', { class: 'row gap', style: { alignItems: 'center' } }, h('span', { class: 'avatar' }, account.email[0].toUpperCase()),
        h('div', { class: 'grow' }, h('strong', {}, account.email), h('div', { class: 'muted small' }, 'Angemeldet'))),
      statusLine(),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn', onclick: () => syncNow() }, icon('refresh', 18), 'Jetzt synchronisieren'),
        h('button', { class: 'btn ghost', onclick: async () => {
          if (await confirmDialog('Abmelden? Deine Daten bleiben auf diesem Gerät und in der Cloud.', { ok: 'Abmelden', danger: false })) {
            await logout();
            toast('Abgemeldet.');
          }
        } }, 'Abmelden'))),
    h('section', { class: 'card' }, h('h3', { class: 'card-title' }, 'Kalender-Abo'), feedBox),
    h('details', { class: 'card' },
      h('summary', {}, 'Passwort ändern'),
      h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); withBusy(pwSubmit, async () => {
        await changePassword(oldPw.value, newPw.value);
        oldPw.value = ''; newPw.value = '';
        toast('Passwort geändert. Andere Geräte wurden abgemeldet.', 'success');
      }); } },
      field('Aktuelles Passwort', oldPw),
      field('Neues Passwort', newPw, 'Mindestens 8 Zeichen.'),
      pwSubmit)),
    h('details', { class: 'card' },
      h('summary', {}, 'Konto löschen'),
      h('p', { class: 'muted small' }, 'Löscht dein Konto und alle Daten in der Cloud endgültig. Die Daten auf diesem Gerät bleiben erhalten.'),
      h('button', { class: 'btn danger ghost', onclick: async () => {
        const pw = prompt('Zum Bestätigen dein Passwort eingeben:');
        if (!pw) return;
        try {
          await deleteAccount(pw);
          toast('Konto gelöscht.');
        } catch (err) { toast(err.message, 'error'); }
      } }, icon('trash', 18), 'Konto endgültig löschen')),
    privacyNote());
}

export function accountView() {
  const account = getAccount();
  return account ? signedInView(account) : signedOutView();
}

/** Link aus der Passwort-vergessen-Mail: #/passwort/<token> */
export function resetView(resetToken) {
  const pw = passwordInput('new-password');
  const repeat = passwordInput('new-password');
  const submit = busyButton('Passwort speichern');
  return h('div', { class: 'view' },
    h('section', { class: 'card hero' },
      h('h2', {}, 'Neues Passwort festlegen'),
      h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); withBusy(submit, async () => {
        if (pw.value !== repeat.value) throw new Error('Die Passwörter stimmen nicht überein.');
        await confirmReset(resetToken, pw.value);
        toast('Passwort geändert – du bist angemeldet.', 'success');
        location.hash = '#/konto';
      }); } },
      field('Neues Passwort', pw, 'Mindestens 8 Zeichen.'),
      field('Wiederholen', repeat),
      submit)));
}
