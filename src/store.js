import fs from 'node:fs';
import path from 'node:path';

export function defaultStore() {
  return {
    version: 2,
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
    for (const it of store.items) {
      if (!it.kind) it.kind = 'once';
      if (it.interval === undefined) it.interval = null;
      if (it.checked === undefined) it.checked = false;
    }
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

export function addItem(store, parsed, opts = {}) {
  const kind = opts.kind || (parsed.recurring ? 'recurring' : 'once');
  const interval = kind === 'recurring' ? opts.interval || parsed.recurring || 'monthly' : null;
  const { recurring, ...fields } = parsed;
  const item = {
    id: store.nextId++,
    createdAt: new Date().toISOString(),
    checked: false,
    kind,
    interval,
    ...fields
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
