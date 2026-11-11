import fs from 'node:fs';
import path from 'node:path';

export function defaultStore() {
  return {
    version: 1,
    currency: 'USD',
    budget: null,
    fallbackEstimate: 5,
    items: [],
    nextId: 1
  };
}

export function loadStore(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(raw);
    const store = { ...defaultStore(), ...data };
    if (!Array.isArray(store.items)) store.items = [];
    if (typeof store.nextId !== 'number') store.nextId = store.items.length + 1;
    return store;
  } catch {
    return defaultStore();
  }
}

export function saveStore(file, store) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2) + '\n');
}

export function addItem(store, parsed) {
  const item = {
    id: store.nextId++,
    createdAt: new Date().toISOString(),
    checked: false,
    ...parsed
  };
  store.items.push(item);
  return item;
}

export function findItem(store, id) {
  return store.items.find((it) => it.id === id) || null;
}

export function setChecked(store, id, checked) {
  const item = findItem(store, id);
  if (!item) return null;
  item.checked = checked;
  return item;
}

export function removeItem(store, id) {
  const idx = store.items.findIndex((it) => it.id === id);
  if (idx === -1) return null;
  return store.items.splice(idx, 1)[0];
}

export function setPrice(store, id, amount) {
  const item = findItem(store, id);
  if (!item) return null;
  item.source = 'manual';
  item.unitPrice = Math.round(amount * 100) / 100;
  item.cost = Math.round(item.quantity * item.unitPrice * 100) / 100;
  return item;
}

export function clearChecked(store) {
  const before = store.items.length;
  store.items = store.items.filter((it) => !it.checked);
  return before - store.items.length;
}

export function totals(store) {
  const total = store.items.reduce((s, it) => s + (Number(it.cost) || 0), 0);
  const checked = store.items.reduce((s, it) => s + (it.checked ? Number(it.cost) || 0 : 0), 0);
  const remaining = store.budget !== null && store.budget !== undefined ? store.budget - total : null;
  return {
    total: Math.round(total * 100) / 100,
    checked: Math.round(checked * 100) / 100,
    unchecked: Math.round((total - checked) * 100) / 100,
    remaining: remaining === null ? null : Math.round(remaining * 100) / 100
  };
}
