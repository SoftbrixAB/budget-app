import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server.js';

async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-web-'));
  const server = createServer({ dataDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, dataDir };
}

async function j(res) {
  const body = await res.json();
  return { status: res.status, body };
}

test('web API end-to-end on loopback', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const health = await j(await fetch(`${base}/api/health`));
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);

  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /budget-app/);

  const appJs = await fetch(`${base}/app.js`);
  assert.equal(appJs.status, 200);
  assert.match(appJs.headers.get('content-type'), /javascript/);

  const traversal = await fetch(`${base}/../src/server.js`);
  assert.ok([403, 404].includes(traversal.status));

  let r = await j(await fetch(`${base}/api/workspaces`));
  assert.deepEqual(r.body.workspaces, []);

  r = await j(
    await fetch(`${base}/api/workspaces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'acme' })
    })
  );
  assert.equal(r.status, 201);
  assert.equal(r.body.workspace, 'acme');

  r = await j(
    await fetch(`${base}/api/workspaces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'acme' })
    })
  );
  assert.equal(r.status, 409);

  r = await j(
    await fetch(`${base}/api/workspaces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '../evil' })
    })
  );
  assert.equal(r.status, 400);

  r = await j(
    await fetch(`${base}/api/entries?workspace=acme`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Kontorsstol' })
    })
  );
  assert.equal(r.status, 201);
  assert.equal(r.body.entry.source, 'catalog');
  assert.equal(r.body.entry.cost, 250);
  assert.equal(r.body.entry.kind, 'once');
  assert.equal(r.body.state.summary.once, 250);

  r = await j(
    await fetch(`${base}/api/entries?workspace=acme`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Hyra' })
    })
  );
  assert.equal(r.body.entry.kind, 'recurring');
  assert.equal(r.body.entry.interval, 'monthly');
  assert.equal(r.body.entry.cost, 1200);
  assert.equal(r.body.state.summary.monthly, 1200);
  assert.equal(r.body.state.summary.total, 1450);

  r = await j(
    await fetch(`${base}/api/entries?workspace=acme`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'PS5', kind: 'once', price: 5999 })
    })
  );
  assert.equal(r.body.entry.source, 'manual');
  assert.equal(r.body.entry.cost, 5999);

  r = await j(await fetch(`${base}/api/state?workspace=acme`));
  assert.equal(r.body.entries.length, 3);
  const hyra = r.body.entries.find((e) => e.name === 'Hyra');
  assert.equal(hyra.monthly, 1200);

  r = await j(
    await fetch(`${base}/api/entries/${hyra.id}?workspace=acme`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checked: true })
    })
  );
  assert.equal(r.body.entry.checked, true);
  assert.equal(r.body.state.summary.monthlyChecked, 1200);

  r = await j(
    await fetch(`${base}/api/entries/${hyra.id}?workspace=acme`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ interval: 'yearly' })
    })
  );
  assert.equal(r.body.entry.interval, 'yearly');
  assert.equal(r.body.entry.monthly, 100);

  r = await j(
    await fetch(`${base}/api/settings?workspace=acme`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currency: 'SEK', budget: 100000, fallbackEstimate: 500 })
    })
  );
  assert.equal(r.body.currency, 'SEK');
  assert.equal(r.body.budget, 100000);

  r = await j(
    await fetch(`${base}/api/entries?workspace=acme`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Papperskorg' })
    })
  );
  assert.equal(r.body.entry.cost, 270);

  const ps5 = (await j(await fetch(`${base}/api/state?workspace=acme`))).body.entries.find((e) => e.name === 'PS5');
  r = await j(await fetch(`${base}/api/entries/${ps5.id}?workspace=acme`, { method: 'DELETE' }));
  assert.equal(r.status, 200);
  assert.equal(r.body.state.entries.length, 3);

  r = await j(await fetch(`${base}/api/entries/999?workspace=acme`, { method: 'DELETE' }));
  assert.equal(r.status, 404);

  r = await j(await fetch(`${base}/api/state?workspace=..%2F..`));
  assert.equal(r.status, 400);

  r = await j(await fetch(`${base}/api/nope?workspace=acme`));
  assert.equal(r.status, 404);

  const wsList = await j(await fetch(`${base}/api/workspaces`));
  assert.deepEqual(wsList.body.workspaces, ['acme']);
});

test('PATCH edits name/quantity/unit/price/kind and recomputes cost', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  const post = (p, b) =>
    fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  const patch = (id, b) =>
    fetch(`${base}/api/entries/${id}?workspace=w`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

  await post('/api/workspaces', { name: 'w' });
  const added = await j(await post('/api/entries?workspace=w', { text: '2 kg apples' }));
  const id = added.body.entry.id;
  assert.equal(added.body.entry.cost, 6);

  let r = await j(await patch(id, { quantity: 5 }));
  assert.equal(r.status, 200);
  assert.equal(r.body.entry.quantity, 5);
  assert.equal(r.body.entry.cost, 15);

  r = await j(await patch(id, { price: 4 }));
  assert.equal(r.body.entry.source, 'manual');
  assert.equal(r.body.entry.unitPrice, 4);
  assert.equal(r.body.entry.cost, 20);

  r = await j(await patch(id, { name: 'big apples', kind: 'recurring', interval: 'monthly', unit: 'kg' }));
  assert.equal(r.body.entry.name, 'big apples');
  assert.equal(r.body.entry.kind, 'recurring');
  assert.equal(r.body.entry.interval, 'monthly');
  assert.equal(r.body.entry.unit, 'kg');
  assert.equal(r.body.entry.monthly, 20);

  r = await j(await patch(id, { unit: 'bogus' }));
  assert.equal(r.status, 400);

  r = await j(await patch(id, { quantity: -1 }));
  assert.equal(r.status, 400);
});

test('PATCH sets/clears actualCost and summary exposes estimated vs actual', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  const post = (p, b) =>
    fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

  await post('/api/workspaces', { name: 'w' });
  const added = await j(await post('/api/entries?workspace=w', { text: '2 kg apples' }));
  const id = added.body.entry.id;
  assert.equal(added.body.entry.estimatedCost, 6);
  assert.equal(added.body.entry.actualCost, null);

  let r = await j(
    await fetch(`${base}/api/entries/${id}?workspace=w`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actual: 5.5 })
    })
  );
  assert.equal(r.body.entry.actualCost, 5.5);
  assert.equal(r.body.state.summary.actual, 5.5);
  assert.equal(r.body.state.summary.estimated, 6);
  assert.equal(r.body.state.summary.actualCount, 1);

  r = await j(
    await fetch(`${base}/api/entries/${id}?workspace=w`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actual: null })
    })
  );
  assert.equal(r.body.entry.actualCost, null);
  assert.equal(r.body.state.summary.actual, 0);
  assert.equal(r.body.state.summary.actualCount, 0);

  r = await j(
    await fetch(`${base}/api/entries/${id}?workspace=w`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actual: -3 })
    })
  );
  assert.equal(r.status, 400);
});

test('POST /api/entries splits multi-item lines into separate entries', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  const post = (p, b) =>
    fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

  await post('/api/workspaces', { name: 'w' });
  let r = await j(await post('/api/entries?workspace=w', { text: 'PS5 + handkontroll' }));
  assert.equal(r.status, 201);
  assert.equal(r.body.entries.length, 2);
  assert.deepEqual(r.body.entries.map((e) => [e.name, e.cost, e.source]), [
    ['PS5', 500, 'catalog'],
    ['handkontroll', 70, 'catalog']
  ]);
  assert.equal(r.body.entry.name, 'PS5');
  assert.equal(r.body.state.summary.once, 570);

  r = await j(await post('/api/entries?workspace=w', { text: 'milk @ 2,50' }));
  assert.equal(r.body.entries.length, 1);
  assert.equal(r.body.entries[0].cost, 2.5);

  r = await j(await post('/api/entries?workspace=w', { text: 'Hyra, Internet', kind: 'recurring', interval: 'monthly' }));
  assert.equal(r.body.entries.length, 2);
  assert.deepEqual(r.body.entries.map((e) => e.kind), ['recurring', 'recurring']);
  assert.equal(r.body.state.summary.monthly, 1250);
});
