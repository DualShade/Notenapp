// "Mit Untis verbinden": Schule suchen, dann nur Benutzername + Passwort.

import { h, icon, openModal, field, toast, setChildren } from '../ui.js';
import { findSchools, connectUntis, untisAccount } from '../data.js';

export function openUntisConnect() {
  const existing = untisAccount();
  let school = existing ? { name: existing.schoolName || existing.school, server: existing.server, loginName: existing.school } : null;

  openModal('Mit Untis verbinden', (close) => {
    const body = h('div', { class: 'stack' });

    const searchStep = () => {
      const results = h('div', { class: 'list school-results' });
      const status = h('p', { class: 'muted small' }, 'Gib den Namen oder Ort deiner Schule ein.');
      let timer;
      let seq = 0;
      const run = async (q) => {
        const mine = ++seq;
        if (q.trim().length < 3) {
          results.replaceChildren();
          status.textContent = 'Mindestens 3 Zeichen eingeben.';
          return;
        }
        status.replaceChildren(h('span', { class: 'spinner small-spinner' }), ' Suche …');
        try {
          const schools = await findSchools(q);
          if (mine !== seq) return; // veraltete Antwort
          status.textContent = schools.length ? `${schools.length} Treffer` : 'Keine Schule gefunden.';
          results.replaceChildren(...schools.map((s) => h('button', {
            type: 'button', class: 'list-item',
            onclick: () => { school = { name: s.name, server: s.server, loginName: s.loginName }; loginStep(); },
          },
          icon('home', 18),
          h('div', { class: 'grow' }, h('div', { class: 'title' }, s.name), h('div', { class: 'sub' }, s.address)),
          icon('chevron', 18))));
        } catch (err) {
          if (mine !== seq) return;
          results.replaceChildren();
          status.textContent = err.message;
        }
      };
      const input = h('input', {
        type: 'search', placeholder: 'z. B. Gymnasium Musterstadt', autocomplete: 'off', enterkeyhint: 'search',
        oninput: (e) => { clearTimeout(timer); timer = setTimeout(() => run(e.target.value), 400); },
        onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); run(e.target.value); } },
      });

      const manualServer = h('input', { type: 'text', placeholder: 'xyz.webuntis.com' });
      const manualSchool = h('input', { type: 'text', placeholder: 'Schulname aus der Untis-Adresse' });
      setChildren(body,
        field('Schule suchen', input),
        status,
        results,
        h('details', { class: 'more' },
          h('summary', {}, 'Schule nicht gefunden? Manuell eingeben'),
          h('p', { class: 'muted small' }, 'Öffne WebUntis im Browser. Die Adresse sieht z. B. so aus: https://nessa.webuntis.com/WebUntis/?school=gym-musterstadt → Server „nessa.webuntis.com“, Schule „gym-musterstadt“.'),
          h('div', { class: 'grid-2' }, field('Server', manualServer), field('Schule', manualSchool)),
          h('button', { type: 'button', class: 'btn', onclick: () => {
            if (!manualServer.value.trim() || !manualSchool.value.trim()) { toast('Bitte Server und Schule eingeben.', 'error'); return; }
            school = { name: manualSchool.value.trim(), server: manualServer.value.trim(), loginName: manualSchool.value.trim() };
            loginStep();
          } }, 'Weiter')));
      setTimeout(() => input.focus(), 50);
    };

    const loginStep = () => {
      const user = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: false, value: existing?.username ?? '' });
      const pass = h('input', { type: 'password', autocomplete: 'current-password' });
      const submit = h('button', { type: 'submit', class: 'btn primary block' }, 'Verbinden');
      const error = h('p', { class: 'danger small', role: 'alert' });
      const connect = async () => {
        if (!user.value.trim() || !pass.value) { error.textContent = 'Bitte Benutzername und Passwort eingeben.'; return; }
        submit.disabled = true;
        submit.replaceChildren(h('span', { class: 'spinner small-spinner' }), ' Verbinde …');
        error.textContent = '';
        try {
          const { timetable, created } = await connectUntis({
            server: school.server, school: school.loginName, schoolName: school.name,
            username: user.value.trim(), password: pass.value,
          });
          toast(`Verbunden! ${timetable.lessons.length} Stunden geladen${created ? `, ${created} Fächer angelegt` : ''}.`, 'success');
          close();
        } catch (err) {
          error.textContent = err.message;
          submit.disabled = false;
          submit.textContent = 'Verbinden';
        }
      };
      setChildren(body,
        h('div', { class: 'choice' },
          icon('home', 22),
          h('div', { class: 'grow' }, h('strong', {}, school.name), h('div', { class: 'sub' }, school.server)),
          h('button', { type: 'button', class: 'btn ghost small', onclick: searchStep }, 'Ändern')),
        h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); connect(); } },
          field('Benutzername', user),
          field('Passwort', pass),
          error,
          submit),
        h('p', { class: 'muted small' }, 'Deine Zugangsdaten werden nur auf diesem Gerät gespeichert und nur an WebUntis gesendet, damit der Stundenplan bei jedem Öffnen aktuell ist.'));
      setTimeout(() => (user.value ? pass : user).focus(), 50);
    };

    if (school) loginStep(); else searchStep();
    return body;
  });
}
