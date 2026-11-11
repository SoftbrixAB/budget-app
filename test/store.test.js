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
  clearChecked,
  totals
} from '../src/store.js';
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

test('totals splits checked vs unchecked and computes remaining', () => {
  const store = defaultStore();
  store.budget = 20;
  const a = addItem(store, parseEntry('2 kg apples'));
  addItem(store, parseEntry('milk'));
  setChecked(store, a.id, true);
  const t = totals(store);
  assert.equal(t.total, 7.6);
  assert.equal(t.checked, 6.0);
  assert.equal(t.unchecked, 1.6);
  assert.equal(t.remaining, 12.4);
});
