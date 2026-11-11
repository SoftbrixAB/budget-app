import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  defaultStore,
  loadStore,
  saveStore,
  addItem,
  setChecked,
  removeItem,
  setPrice,
  clearChecked
} from '../src/store.js';
import { summarize } from '../src/model.js';
import { parseEntry } from '../src/estimator.js';

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'budget-')), 'budget.json');
}

test('save/load round-trips the store', () => {
  const file = tmpFile();
  const store = defaultStore();
  store.budget = 100;
  addItem(store, parseEntry('2 kg apples'));
  addItem(store, parseEntry('milk'));
  saveStore(file, store);
  const loaded = loadStore(file);
  assert.equal(loaded.budget, 100);
  assert.equal(loaded.items.length, 2);
  assert.equal(loaded.nextId, 3);
  assert.equal(loaded.items[0].cost, 6.0);
});

test('loadStore returns a fresh store for a missing file', () => {
  const store = loadStore(path.join(os.tmpdir(), 'does-not-exist-budget.json'));
  assert.deepEqual(store.items, []);
  assert.equal(store.currency, 'USD');
});

test('loadStore survives a corrupt file', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{ not json');
  const store = loadStore(file);
  assert.deepEqual(store.items, []);
});

test('v1 files are migrated: items without kind become one-time', () => {
  const file = tmpFile();
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      currency: 'USD',
      budget: null,
      fallbackEstimate: 5,
      items: [{ id: 1, name: 'milk', quantity: 1, unit: 'l', unitPrice: 1.6, cost: 1.6, source: 'catalog', checked: true }],
      nextId: 2
    })
  );
  const store = loadStore(file);
  assert.equal(store.items[0].kind, 'once');
  assert.equal(store.items[0].interval, null);
  assert.equal(store.items[0].checked, true);
});

test('addItem applies recurring kind/interval from catalog hint or opts', () => {
  const store = defaultStore();
  const hyra = addItem(store, parseEntry('Hyra'));
  assert.equal(hyra.kind, 'recurring');
  assert.equal(hyra.interval, 'monthly');
  const forced = addItem(store, parseEntry('Hyra'), { kind: 'once' });
  assert.equal(forced.kind, 'once');
  assert.equal(forced.interval, null);
  const forcedInterval = addItem(store, parseEntry('Domän'), { kind: 'recurring', interval: 'monthly' });
  assert.equal(forcedInterval.interval, 'monthly');
});

test('checklist toggle, remove and clearChecked', () => {
  const store = defaultStore();
  const a = addItem(store, parseEntry('milk'));
  const b = addItem(store, parseEntry('bread'));
  setChecked(store, a.id, true);
  assert.equal(store.items.find((i) => i.id === a.id).checked, true);
  setChecked(store, b.id, true);
  assert.equal(clearChecked(store), 2);
  assert.equal(store.items.length, 0);
  removeItem(store, 999);
});

test('setPrice marks the entry manual and recomputes cost from quantity', () => {
  const store = defaultStore();
  const item = addItem(store, parseEntry('2 kg apples'));
  setPrice(store, item.id, 4.5);
  const updated = store.items[0];
  assert.equal(updated.source, 'manual');
  assert.equal(updated.unitPrice, 4.5);
  assert.equal(updated.cost, 9.0);
});

test('summarize splits one-time vs recurring-monthly and computes remaining', () => {
  const store = defaultStore();
  store.budget = 2000;
  const a = addItem(store, parseEntry('2 kg apples'));
  addItem(store, parseEntry('Hyra'));
  addItem(store, parseEntry('Domän'));
  setChecked(store, a.id, true);
  const s = summarize(store);
  assert.equal(s.once, 6.0);
  assert.equal(s.onceChecked, 6.0);
  assert.equal(s.monthly, 1200 + 15 / 12);
  assert.equal(s.total, 6.0 + 1200 + 15 / 12);
  assert.equal(s.remaining, 2000 - s.total);
});
