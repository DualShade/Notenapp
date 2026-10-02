// Kalender-Datei (.ics) mit Klausuren und offenen Hausaufgaben – ohne Konto.

function text(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function fold(line) {
  const out = [];
  let rest = line;
  while (new TextEncoder().encode(rest).length > 74) {
    let cut = 74;
    while (new TextEncoder().encode(rest.slice(0, cut)).length > 74) cut--;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

const ymd = (iso) => iso.replaceAll('-', '');
function nextDay(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function buildIcs(state) {
  const names = Object.fromEntries(state.subjects.map((s) => [s.id, s.name]));
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dualshade//Notenapp//DE', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Notenapp'];
  const event = (uid, date, summary, desc) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) return;
    lines.push('BEGIN:VEVENT', `UID:${uid}@notenapp`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ymd(date)}`, `DTEND;VALUE=DATE:${ymd(nextDay(date))}`,
      `SUMMARY:${text(summary)}`, 'TRANSP:TRANSPARENT');
    if (desc) lines.push(`DESCRIPTION:${text(desc)}`);
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${text(summary)}`, 'TRIGGER:-PT6H', 'END:VALARM', 'END:VEVENT');
  };
  for (const k of state.klausuren) event(`k-${k.id}`, k.date, `${k.title || 'Klausur'}: ${names[k.subjectId] ?? 'Fach'}`, k.info);
  for (const hw of state.homework) if (!hw.done) event(`h-${hw.id}`, hw.due, `HA ${names[hw.subjectId] ? `${names[hw.subjectId]}: ` : ''}${hw.title}`, hw.notes);
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function downloadIcs(state) {
  const blob = new Blob([buildIcs(state)], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'notenapp-termine.ics';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
