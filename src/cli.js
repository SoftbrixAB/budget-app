import path from 'node:path';
import readline from 'node:readline';
import { parseEntry } from './estimator.js';
import { summarize } from './model.js';
import {
  loadStore,
  saveStore,
  addItem,
  findItem,
  setChecked,
  removeItem,
  setPrice,
  setActual,
  clearChecked
} from './store.js';

export function fmt(amount, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return `${Number(amount).toFixed(2)} ${currency}`;
  }
}

export function splitArgs(line) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

const KIND_FLAGS = {
  once: { kind: 'once', interval: null },
  weekly: { kind: 'recurring', interval: 'weekly' },
  monthly: { kind: 'recurring', interval: 'monthly' },
  quarterly: { kind: 'recurring', interval: 'quarterly' },
  yearly: { kind: 'recurring', interval: 'yearly' }
};

const HELP = `budget-app CLI commands:
  add [--once|--monthly|--quarterly|--yearly|--weekly] <item> [qty] [unit] [@ price]
                                      add a checklist entry, cost is estimated automatically;
                                      cost type defaults to the catalog hint or one-time
                                      e.g. add 2 kg apples | add Kontorsstol | add --monthly Hyra | add PS5 @ 6000
  list, ls                            show the checklist with per-entry estimates and totals
  check <id> / uncheck <id>           mark an entry as bought / not bought
  toggle <id>                         flip the checked state of an entry
  price <id> <amount>                 override the planned cost (estimate is kept for comparison)
  actual <id> <amount|clear>          set/clear the actual paid cost (vs the estimate)
  remove <id>, rm <id>                delete an entry
  budget [amount]                     show or set the budget limit (vs total planned spend)
  fallback [amount]                   show or set the fallback estimate for unknown items
  clear                               remove all checked entries
  help                                show this help
  exit, quit                          leave the interactive session

Run the web app instead with: npm start   (serves the UI + REST API on http://127.0.0.1:3000)

options:
  -f, --file <path>     data file (default: $BUDGET_FILE or ./budget.json)
  -c, --currency <code> set currency, e.g. USD, EUR, SEK
  -h, --help            show this help`;

function kindLabel(it) {
  return it.kind === 'recurring' ? `recurring/${it.interval}` : 'once';
}

function renderList(store) {
  const cur = store.currency || 'USD';
  const lines = [];
  if (store.items.length === 0) {
    lines.push('No entries yet. Add one with: add 2 kg apples');
  } else {
    const headers = ['ID', 'DONE', 'KIND', 'ITEM', 'QTY', 'ESTIMATE', 'ACTUAL', 'SOURCE'];
    const rows = store.items.map((it) => [
      String(it.id),
      it.checked ? '[x]' : '[ ]',
      kindLabel(it),
      it.name,
      `${it.quantity} ${it.unit}`,
      fmt(it.cost, cur) + (it.kind === 'recurring' ? `/${it.interval}` : ''),
      it.actualCost !== null && it.actualCost !== undefined ? fmt(it.actualCost, cur) : '—',
      it.source
    ]);
    const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
    const fmtRow = (r) =>
      r
        .map((cell, i) => (i === 0 || i === 5 ? cell.padStart(widths[i]) : cell.padEnd(widths[i])))
        .join('  ')
        .trimEnd();
    lines.push(fmtRow(headers));
    lines.push(widths.map((w) => '-'.repeat(w)).join('  '));
    for (const r of rows) lines.push(fmtRow(r));
  }
  const s = summarize(store);
  lines.push('');
  lines.push(
    `One-time: ${fmt(s.once, cur)} (checked ${fmt(s.onceChecked, cur)})  ` +
      `Recurring: ${fmt(s.monthly, cur)}/month (checked ${fmt(s.monthlyChecked, cur)})  ` +
      `Total planned: ${fmt(s.total, cur)}`
  );
  lines.push(
    `Estimated: ${fmt(s.estimated, cur)}  Actual: ${fmt(s.actual, cur)}${s.actualCount ? ` (${s.actualCount} ${s.actualCount === 1 ? 'entry' : 'entries'})` : ''}`
  );
  if (store.budget !== null && store.budget !== undefined) {
    const over = s.remaining < 0;
    lines.push(
      `Budget: ${fmt(store.budget, cur)}  ${over ? 'over budget by ' : 'remaining '}${fmt(Math.abs(s.remaining), cur)}`
    );
  } else {
    lines.push('Budget: not set (use: budget <amount>)');
  }
  return lines.join('\n');
}

function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export function execute(ctx, args) {
  const [cmd, ...rest] = args;
  const cur = ctx.store.currency || 'USD';
  switch (cmd) {
    case 'add': {
      if (!rest.length) return { changed: false, text: 'usage: add [--once|--monthly|--quarterly|--yearly|--weekly] <item> [qty] [unit] [@ price]' };
      let kind;
      let interval;
      const textParts = [];
      for (const t of rest) {
        const key = t.replace(/^--/, '').toLowerCase();
        if (KIND_FLAGS[key] && kind === undefined) {
          kind = KIND_FLAGS[key].kind;
          interval = KIND_FLAGS[key].interval;
        } else {
          textParts.push(t);
        }
      }
      if (!textParts.length) return { changed: false, text: 'usage: add [--once|--monthly|--quarterly|--yearly|--weekly] <item> [qty] [unit] [@ price]' };
      let parsed;
      try {
        parsed = parseEntry(textParts.join(' '), ctx.store.fallbackEstimate, { currency: ctx.store.currency });
      } catch (err) {
        return { changed: false, text: `error: ${err.message}` };
      }
      const item = addItem(ctx.store, parsed, { kind, interval });
      const per = item.kind === 'recurring' ? `/${item.interval}` : '';
      return {
        changed: true,
        text: `added #${item.id} "${item.name}" (${item.quantity} ${item.unit}) — estimated ${fmt(item.cost, cur)}${per} [${item.source}] (${kindLabel(item)})`
      };
    }
    case 'list':
    case 'ls':
      return { changed: false, text: renderList(ctx.store) };
    case 'check':
    case 'uncheck':
    case 'toggle': {
      const id = parseId(rest[0]);
      const item = id !== null ? findItem(ctx.store, id) : null;
      if (!item) return { changed: false, text: 'error: no entry with that id (see: list)' };
      const next = cmd === 'check' ? true : cmd === 'uncheck' ? false : !item.checked;
      setChecked(ctx.store, id, next);
      return { changed: true, text: `#${id} "${item.name}" ${next ? 'checked' : 'unchecked'} — ${fmt(item.cost, cur)}` };
    }
    case 'remove':
    case 'rm': {
      const id = parseId(rest[0]);
      const item = id !== null ? removeItem(ctx.store, id) : null;
      if (!item) return { changed: false, text: 'error: no entry with that id (see: list)' };
      return { changed: true, text: `removed #${id} "${item.name}"` };
    }
    case 'price': {
      const id = parseId(rest[0]);
      const amount = Number(String(rest[1]).replace(',', '.').replace(/[$€£]/g, ''));
      const item = id !== null ? findItem(ctx.store, id) : null;
      if (!item || !Number.isFinite(amount) || amount < 0) {
        return { changed: false, text: 'usage: price <id> <amount>' };
      }
      setPrice(ctx.store, id, amount);
      return { changed: true, text: `#${id} "${item.name}" price set to ${fmt(item.cost, cur)} [manual]` };
    }
    case 'actual': {
      const id = parseId(rest[0]);
      const item = id !== null ? findItem(ctx.store, id) : null;
      if (!item) return { changed: false, text: 'error: no entry with that id (see: list)' };
      if (rest[1] === undefined || String(rest[1]).toLowerCase() === 'clear') {
        setActual(ctx.store, id, null);
        return { changed: true, text: `#${id} "${item.name}" actual cleared` };
      }
      const amount = Number(String(rest[1]).replace(',', '.').replace(/[$€£]/g, ''));
      if (!Number.isFinite(amount) || amount < 0) return { changed: false, text: 'usage: actual <id> <amount|clear>' };
      setActual(ctx.store, id, amount);
      return {
        changed: true,
        text: `#${id} "${item.name}" actual ${fmt(amount, cur)} (estimated ${fmt(item.estimatedCost ?? item.cost, cur)})`
      };
    }
    case 'budget': {
      if (rest.length === 0) {
        const s = summarize(ctx.store);
        return {
          changed: false,
          text:
            ctx.store.budget === null || ctx.store.budget === undefined
              ? 'budget: not set'
              : `budget: ${fmt(ctx.store.budget, cur)}, total planned ${fmt(s.total, cur)}, remaining ${fmt(s.remaining, cur)}`
        };
      }
      const amount = Number(String(rest[0]).replace(',', '.'));
      if (!Number.isFinite(amount) || amount < 0) return { changed: false, text: 'usage: budget <amount>' };
      ctx.store.budget = amount;
      return { changed: true, text: `budget set to ${fmt(amount, cur)}` };
    }
    case 'fallback': {
      if (rest.length === 0) return { changed: false, text: `fallback estimate: ${fmt(ctx.store.fallbackEstimate, cur)}` };
      const amount = Number(String(rest[0]).replace(',', '.'));
      if (!Number.isFinite(amount) || amount < 0) return { changed: false, text: 'usage: fallback <amount>' };
      ctx.store.fallbackEstimate = amount;
      return { changed: true, text: `fallback estimate set to ${fmt(amount, cur)}` };
    }
    case 'clear': {
      const n = clearChecked(ctx.store);
      return { changed: true, text: n === 0 ? 'nothing checked, nothing removed' : `removed ${n} checked entr${n === 1 ? 'y' : 'ies'}` };
    }
    case 'help':
    case undefined:
      return { changed: false, text: HELP };
    default:
      return { changed: false, text: `unknown command: ${cmd}\n\n${HELP}` };
  }
}

export function run(argv) {
  let file = process.env.BUDGET_FILE || path.join(process.cwd(), 'budget.json');
  let currency = null;
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-f' || a === '--file') file = argv[++i];
    else if (a === '-c' || a === '--currency') currency = argv[++i];
    else if (a === '-h' || a === '--help') {
      process.stdout.write(HELP + '\n');
      return;
    } else args.push(a);
  }

  const ctx = { file, store: loadStore(file) };
  let dirty = false;
  if (currency) {
    ctx.store.currency = currency.toUpperCase();
    dirty = true;
  }

  if (args.length > 0) {
    const r = execute(ctx, args);
    process.stdout.write(r.text + '\n');
    if (r.changed || dirty) saveStore(file, ctx.store);
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'budget> ' });
  process.stdout.write(HELP + '\n');
  rl.prompt();
  rl.on('line', (line) => {
    const parts = splitArgs(line.trim());
    if (parts.length === 0) {
      rl.prompt();
      return;
    }
    if (parts[0] === 'exit' || parts[0] === 'quit') {
      rl.close();
      return;
    }
    const r = execute(ctx, parts);
    process.stdout.write(r.text + '\n');
    if (r.changed) {
      saveStore(file, ctx.store);
      dirty = false;
    }
    rl.prompt();
  });
  rl.on('close', () => {
    if (dirty) saveStore(file, ctx.store);
    process.exit(0);
  });
}
