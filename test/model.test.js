import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlyEquivalent, summarize } from '../src/model.js';

test('monthlyEquivalent converts intervals to per-month', () => {
  assert.equal(monthlyEquivalent({ kind: 'recurring', interval: 'monthly', cost: 100 }), 100);
  assert.equal(monthlyEquivalent({ kind: 'recurring', interval: 'yearly', cost: 1200 }), 100);
  assert.equal(monthlyEquivalent({ kind: 'recurring', interval: 'quarterly', cost: 90 }), 30);
  assert.equal(monthlyEquivalent({ kind: 'recurring', interval: 'weekly', cost: 52 }), Math.round((52 * 52 / 12) * 100) / 100);
  assert.equal(monthlyEquivalent({ kind: 'once', interval: null, cost: 500 }), 0);
});

test('summarize handles empty store', () => {
  const s = summarize({ items: [], budget: null });
  assert.deepEqual(s, {
    once: 0,
    onceChecked: 0,
    monthly: 0,
    monthlyChecked: 0,
    total: 0,
    checked: 0,
    unchecked: 0,
    remaining: null,
    estimated: 0,
    actual: 0,
    actualCount: 0
  });
});

test('summarize counts checked recurring separately and tracks estimated vs actual', () => {
  const store = {
    budget: 1000,
    items: [
      { kind: 'recurring', interval: 'monthly', cost: 300, estimatedCost: 280, actualCost: 310, checked: true },
      { kind: 'recurring', interval: 'yearly', cost: 1200, checked: false },
      { kind: 'once', interval: null, cost: 50, estimatedCost: 45, checked: false }
    ]
  };
  const s = summarize(store);
  assert.equal(s.monthly, 400);
  assert.equal(s.monthlyChecked, 300);
  assert.equal(s.once, 50);
  assert.equal(s.total, 450);
  assert.equal(s.checked, 300);
  assert.equal(s.unchecked, 150);
  assert.equal(s.remaining, 550);
  assert.equal(s.estimated, 280 + 100 + 45);
  assert.equal(s.actual, 310);
  assert.equal(s.actualCount, 1);
});
