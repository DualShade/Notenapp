// Tab "Mehr": alle weiteren Bereiche als Kacheln.

import { h, icon } from '../ui.js';
import { getAccount, syncStatus } from '../sync.js';

const TILES = [
  ['statistik', 'chart', 'Statistik', 'Verlauf, Verteilung, Stärken'],
  ['abi', 'cap', 'Abi-Rechner', 'Block I + II, Abi-Schnitt'],
  ['schluessel', 'key', 'Notenschlüssel', 'Punkte, Prozent, BE-Rechner'],
  ['gewichtung', 'grid', 'Gewichtung', 'Schriftlich : mündlich je Fach'],
  ['fehlzeiten', 'clock', 'Fehlzeiten', 'Versäumte Stunden'],
  ['druck', 'file', 'Notenübersicht', 'Drucken oder als PDF'],
  ['einstellungen', 'settings', 'Einstellungen', 'Untis, Gewichtung, Design'],
];

export function moreView() {
  const account = getAccount();
  const st = syncStatus();
  return h('div', { class: 'view' },
    h('a', { class: 'card account-tile', href: '#/konto' },
      h('span', { class: 'avatar' }, account ? account.email[0].toUpperCase() : icon('cloud', 20)),
      h('div', { class: 'grow' },
        h('strong', {}, account ? account.email : 'Konto & Cloud-Sync'),
        h('div', { class: 'muted small' }, account
          ? (st.state === 'error' ? `Sync-Fehler: ${st.error}` : st.state === 'offline' ? 'Offline' : 'Daten gesichert & synchronisiert')
          : 'Melde dich an, damit deine Noten nie verloren gehen')),
      icon('chevron', 18)),
    h('div', { class: 'tiles' }, TILES.map(([path, ic, title, sub]) => h('a', { class: 'tile', href: `#/${path}` },
      icon(ic, 24), h('strong', {}, title), h('small', {}, sub)))));
}
