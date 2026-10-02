import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subjectAverage, weightPercent, formatRatio } from '../site/js/grades.js';
import { migrate, defaultState } from '../site/js/store.js';

test('Gewichtung als Verhältnis: LK 2:1, GK 1:1', () => {
  const grades = [{ type: 'klausur', points: 12 }, { type: 'muendlich', points: 9 }];
  assert.equal(subjectAverage(grades, { schriftlich: 2, muendlich: 1 }).average, 11);
  assert.equal(subjectAverage(grades, { schriftlich: 1, muendlich: 1 }).average, 10.5);
  // Alte Prozentwerte funktionieren weiterhin
  assert.equal(subjectAverage(grades, { schriftlich: 50, muendlich: 50 }).average, 10.5);
  assert.equal(weightPercent({ schriftlich: 2, muendlich: 1 }, 'schriftlich'), 67);
  assert.equal(formatRatio({ schriftlich: 2, muendlich: 1 }), '2 : 1');
  assert.equal(formatRatio({ schriftlich: 1.5, muendlich: 1 }), '1,5 : 1');
});

test('Standards: LK 2:1, GK 1:1', () => {
  const { weights } = defaultState().settings;
  assert.deepEqual(weights, { LK: { schriftlich: 2, muendlich: 1 }, GK: { schriftlich: 1, muendlich: 1 } });
});

test('Migration: alte 50/50-Standards werden umgestellt, eigene Werte bleiben', () => {
  const old = defaultState();
  old.version = 1;
  old.settings.weights = { LK: { schriftlich: 50, muendlich: 50 }, GK: { schriftlich: 50, muendlich: 50 } };
  const m = migrate(structuredClone(old));
  assert.deepEqual(m.settings.weights.LK, { schriftlich: 2, muendlich: 1 });
  assert.deepEqual(m.settings.weights.GK, { schriftlich: 1, muendlich: 1 });
  assert.equal(m.version, 2);

  const custom = structuredClone(old);
  custom.settings.weights.LK = { schriftlich: 70, muendlich: 30 };
  assert.deepEqual(migrate(custom).settings.weights.LK, { schriftlich: 70, muendlich: 30 });
});
