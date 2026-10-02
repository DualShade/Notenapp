import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectCourses, blockOne, blockTwo, abiGrade, pointsForGrade, checkRules } from '../site/js/abi-calc.js';

function courses() {
  const list = [];
  // 2 LKs × 4 Halbjahre = 8 LK-Kurse mit 12 Punkten
  for (const s of ['M', 'PH']) for (let i = 0; i < 4; i++) list.push({ id: `${s}${i}`, points: 12, isLK: true });
  // 9 GKs × 4 Halbjahre = 36 GK-Kurse, abgestuft
  'D E GE SW IF SP BI KU PL'.split(' ').forEach((s, n) => {
    for (let i = 0; i < 4; i++) list.push({ id: `${s}${i}`, points: 13 - n, isLK: false });
  });
  return list;
}

test('Block I: alle LK-Kurse + beste GK-Kurse, LK doppelt', () => {
  const list = courses();
  const chosen = selectCourses(list, { totalCourses: 40 });
  assert.equal(chosen.size, 40);
  assert.ok(['M0', 'M3', 'PH2'].every((id) => chosen.has(id)));
  assert.ok(!chosen.has('PL0'), 'schlechtester GK fliegt raus (5 Punkte)');
  const b1 = blockOne(list, chosen);
  assert.equal(b1.S, 48);
  // P = 8*12*2 + 4*(13+12+11+10+9+8+7+6) = 192 + 304 = 496 → 496/48*40 = 413,33 → 413
  assert.equal(b1.E, 413);
  // Erzwingen: Philosophie rein, Sport raus
  const forced = selectCourses(list, { totalCourses: 40, forced: { PL0: true, SP0: false } });
  assert.ok(forced.has('PL0') && !forced.has('SP0'));
});

test('Abinote aus Gesamtpunkten (offizielle Tabelle)', () => {
  assert.equal(abiGrade(900), 1);
  assert.equal(abiGrade(823), 1);
  assert.equal(abiGrade(822), 1.1);
  assert.equal(abiGrade(805), 1.1);
  assert.equal(abiGrade(804), 1.2);
  assert.equal(abiGrade(300), 4);
  assert.equal(abiGrade(299), null);
  assert.equal(pointsForGrade(1.0), 823);
  assert.equal(pointsForGrade(1.5), 733);
  assert.equal(abiGrade(733), 1.5);
  assert.equal(abiGrade(732), 1.6);
  assert.equal(pointsForGrade(4.0), 300);
});

test('Block II und Bestehensregeln', () => {
  const b2 = blockTwo([12, 10, 9, 4, 3]);
  assert.equal(b2.E, 152);
  assert.equal(b2.atLeastFive, 3);
  const issues = checkRules({ count: 40, E: 190, under: 9 }, blockTwo([4, 4, 4, 10, 3]));
  assert.equal(issues.length, 3);
});
