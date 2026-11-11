import path from 'node:path';
import readline from 'node:readline';
import { parseEntry } from './estimator.js';
import {
  loadStore,
  saveStore,
  addItem,
  findItem,
  setChecked,
  removeItem,
  setPrice,
  clearChecked,
  totals
} from './store.js';

export function fmt(amount, currency) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
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

const HELP = `budget-app commands:
  add <item> [qty] [unit] [@ price]   add a checklist entry, cost is estimated automatically
                                      e.g. add 2 kg apples   |   add bread x3   |   add milk @ 2.50
  list, ls                            show the checklist with per-entry estimates and totals
  check <id> / uncheck <id>           mark an entry as bought / not bought
  toggle <id>                         flip the checked state of an entry
  price <id> <amount>                 override the estimate with an actual price
  remove <id>, rm <id>                delete an entry
  budget [amount]                     show or set the budget limit
  fallback [amount]                   show or set the fallback estimate for unknown items
  clear                               remove all checked entries
  help                                show this help
  exit, quit                          leave the interactive session

options:
  -f, --file <path>     data file (default: $BUDGET_FILE or ./budget.json)
  -c, --currency <code> set currency, e.g. USD, EUR, SEK
  -h, --help            show this help`;

function renderList(store) {
  const cur = store.currency || 'USD';
  const lines = [];
  if (store.items.length === 0) {
    lines.push('No entries yet. Add one with: add 2 kg apples');
  } else {
    const headers = ['ID', 'DONE', 'ITEM', 'QTY', 'ESTIMATE', 'SOURCE'];
    const rows = store.items.map((it) => [
      String(it.id),
      it.checked ? '[x]' : '[ ]',
      it.name,
      `${it.quantity} ${it.unit}`,
      fmt(it.cost, cur),
      it.source
    ]);
    const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
    const fmtRow = (r) =>
      r
        .map((cell, i) => (i === 0 || i === 4 ? cell.padStart(widths[i]) : cell.padEnd(widths[i])))
        .join('  ')
        .trimEnd();
    lines.push(fmtRow(headers));
    lines.push(widths.map((w) => '-'.repeat(w)).join('  '));
    for (const r of rows) lines.push(fmtRow(r));
  }
  const t = totals(store);
  lines.push('');
  lines.push(`Total estimated: ${fmt(t.total, cur)}  (checked: ${fmt(t.checked, cur)}, unchecked: ${fmt(t.unchecked, cur)})`);
  if (store.budget !== null && store.budget !== undefined) {
    const over = t.remaining < 0;
    lines.push(
      `Budget: ${fmt(store.budget, cur)}  ${over ? 'over budget by ' : 'remaining '}${fmt(Math.abs(t.remaining), cur)}`
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
      if (!rest.length) return { changed: false, text: 'usage: add <item> [qty] [unit] [@ price]' };
      let parsed;
      try {
        parsed = parseEntry(rest.join(' '), ctx.store.fallbackEstimate);
      } catch (err) {
        return { changed: false, text: `error: ${err.message}` };
      }
      const item = addItem(ctx.store, parsed);
      return {
        changed: true,
        text: `added #${item.id} "${item.name}" (${item.quantity} ${item.unit}) — estimated ${fmt(item.cost, cur)} [${item.source}]`
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
    case 'budget': {
      if (rest.length === 0) {
        const t = totals(ctx.store);
        return {
          changed: false,
          text:
            ctx.store.budget === null || ctx.store.budget === undefined
              ? 'budget: not set'
              : `budget: ${fmt(ctx.store.budget, cur)}, total estimated ${fmt(t.total, cur)}, remaining ${fmt(t.remaining, cur)}`
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
