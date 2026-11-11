import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEntry } from './estimator.js';
import { UNITS } from './catalog.js';
import { monthlyEquivalent, summarize } from './model.js';
import {
  defaultStore,
  loadStore,
  saveStore,
  addItem,
  findItem,
  setChecked,
  removeItem,
  setPrice
} from './store.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const WORKSPACE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BODY = 1_000_000;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

export function createServer(opts = {}) {
  const dataDir = opts.dataDir || process.env.DATA_DIR || path.join(process.cwd(), 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const wsFile = (ws) => path.join(dataDir, `${ws}.json`);
  const checkWs = (ws) => {
    if (!WORKSPACE_RE.test(ws)) throw httpError(400, 'invalid workspace name');
    return ws;
  };

  function state(ws) {
    const store = loadStore(wsFile(ws));
    return {
      workspace: ws,
      currency: store.currency,
      budget: store.budget,
      fallbackEstimate: store.fallbackEstimate,
      entries: store.items.map((it) => ({ ...it, monthly: monthlyEquivalent(it) })),
      summary: summarize(store)
    };
  }

  function mutate(ws, fn) {
    const file = wsFile(ws);
    const store = loadStore(file);
    const result = fn(store);
    saveStore(file, store);
    return result;
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(httpError(413, 'body too large'));
          req.destroy();
        } else {
          chunks.push(c);
        }
      });
      req.on('end', () => {
        if (chunks.length === 0) return resolve({});
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(httpError(400, 'invalid JSON body'));
        }
      });
      req.on('error', reject);
    });
  }

  function serveStatic(res, pathname) {
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('forbidden');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const send = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    };
    try {
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
        serveStatic(res, url.pathname);
        return;
      }

      if (url.pathname === '/api/health' && req.method === 'GET') {
        send(200, { ok: true });
        return;
      }

      if (url.pathname === '/api/workspaces' && req.method === 'GET') {
        const names = fs
          .readdirSync(dataDir)
          .filter((f) => f.endsWith('.json'))
          .map((f) => f.slice(0, -5))
          .sort();
        send(200, { workspaces: names });
        return;
      }

      if (url.pathname === '/api/workspaces' && req.method === 'POST') {
        const body = await readBody(req);
        const name = String(body.name || '');
        checkWs(name);
        const file = wsFile(name);
        if (fs.existsSync(file)) throw httpError(409, 'workspace already exists');
        saveStore(file, { ...defaultStore(), workspace: name });
        send(201, state(name));
        return;
      }

      const ws = checkWs(url.searchParams.get('workspace') || 'default');

      if (url.pathname === '/api/state' && req.method === 'GET') {
        send(200, state(ws));
        return;
      }

      if (url.pathname === '/api/entries' && req.method === 'POST') {
        const body = await readBody(req);
        const store = loadStore(wsFile(ws));
        const parsed = parseEntry(String(body.text || ''), store.fallbackEstimate, { currency: store.currency });
        const kind = body.kind === 'recurring' ? 'recurring' : body.kind === 'once' ? 'once' : undefined;
        const item = mutate(ws, (s) => addItem(s, parsed, { kind, interval: body.interval }));
        if (body.price !== undefined && body.price !== null && body.price !== '') {
          mutate(ws, (s) => setPrice(s, item.id, Number(body.price)));
        }
        const saved = findItem(loadStore(wsFile(ws)), item.id);
        send(201, { entry: { ...saved, monthly: monthlyEquivalent(saved) }, state: state(ws) });
        return;
      }

      const m = url.pathname.match(/^\/api\/entries\/(\d+)$/);
      if (m && req.method === 'PATCH') {
        const id = Number(m[1]);
        const body = await readBody(req);
        const item = mutate(ws, (store) => {
          const it = findItem(store, id);
          if (!it) throw httpError(404, 'no entry with that id');
          if (body.checked !== undefined) setChecked(store, id, !!body.checked);
          let recompute = false;
          if (body.quantity !== undefined && body.quantity !== null && body.quantity !== '') {
            const q = Number(body.quantity);
            if (!Number.isFinite(q) || q <= 0) throw httpError(400, 'quantity must be a positive number');
            it.quantity = q;
            recompute = true;
          }
          if (body.unit !== undefined && body.unit !== null && body.unit !== '') {
            const u = String(body.unit).toLowerCase();
            if (!UNITS[u]) throw httpError(400, `unknown unit: ${u}`);
            it.unit = u;
            recompute = true;
          }
          if (recompute) it.cost = Math.round(it.quantity * it.unitPrice * 100) / 100;
          if (body.price !== undefined && body.price !== null && body.price !== '') setPrice(store, id, Number(body.price));
          if (body.name !== undefined && String(body.name).trim()) it.name = String(body.name).trim();
          if (body.kind !== undefined) {
            it.kind = body.kind === 'recurring' ? 'recurring' : 'once';
            it.interval = it.kind === 'recurring' ? body.interval || it.interval || 'monthly' : null;
          } else if (body.interval !== undefined && it.kind === 'recurring') {
            it.interval = String(body.interval);
          }
          return it;
        });
        send(200, { entry: { ...item, monthly: monthlyEquivalent(item) }, state: state(ws) });
        return;
      }

      if (m && req.method === 'DELETE') {
        const id = Number(m[1]);
        const item = mutate(ws, (store) => removeItem(store, id));
        if (!item) throw httpError(404, 'no entry with that id');
        send(200, { removed: item.id, state: state(ws) });
        return;
      }

      if (url.pathname === '/api/settings' && req.method === 'PUT') {
        const body = await readBody(req);
        mutate(ws, (store) => {
          if (body.currency !== undefined) store.currency = String(body.currency).toUpperCase();
          if (body.budget !== undefined) store.budget = body.budget === null || body.budget === '' ? null : Number(body.budget);
          if (body.fallbackEstimate !== undefined) store.fallbackEstimate = Number(body.fallbackEstimate);
          return store;
        });
        send(200, state(ws));
        return;
      }

      send(404, { error: 'not found' });
    } catch (err) {
      send(err.status || 500, { error: err.message || 'internal error' });
    }
  });

  return server;
}

export function start() {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  const server = createServer();
  server.listen(port, host, () => {
    process.stdout.write(`budget-app web listening on http://${host}:${port} (data dir: ${process.env.DATA_DIR || path.join(process.cwd(), 'data')})\n`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start();
}
