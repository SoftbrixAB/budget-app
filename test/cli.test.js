import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const entry = path.join(repoRoot, 'budget.js');

function makeFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'budget-cli-')), 'budget.json');
}

function cli(file, ...args) {
  const r = spawnSync(process.execPath, [entry, '--file', file, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test('end-to-end: add, list, check, price, budget, remove, clear', () => {
  const file = makeFile();

  const added = cli(file, 'add', '2 kg apples');
  assert.match(added, /#1 "apples"/);
  assert.match(added, /\$6\.00/);
  assert.match(added, /\[catalog\]/);
  assert.match(added, /\(once\)/);

  cli(file, 'add', 'milk');
  cli(file, 'add', '4 dragon scales');

  let out = cli(file, 'list');
  assert.match(out, /apples/);
  assert.match(out, /\[ \]/);
  assert.match(out, /dragon scales\s+4 each\s+\$20\.00/);
  assert.match(out, /Total planned: \$27\.60/);
  assert.match(out, /Recurring: \$0\.00\/month/);

  out = cli(file, 'check', '1');
  assert.match(out, /#1 "apples" checked/);
  out = cli(file, 'list');
  assert.match(out, /\[x\]\s+once\s+apples/);
  assert.match(out, /One-time: \$27\.60 \(checked \$6\.00\)/);
  assert.match(out, /Estimated: \$27\.60\s+Actual: \$0\.00/);

  out = cli(file, 'actual', '1', '5.50');
  assert.match(out, /#1 "apples" actual \$5\.50 \(estimated \$6\.00\)/);
  out = cli(file, 'list');
  assert.match(out, /apples\s+2 kg\s+\$6\.00\s+\$5\.50/);
  assert.match(out, /Actual: \$5\.50 \(1 entry\)/);
  out = cli(file, 'actual', '1', 'clear');
  assert.match(out, /#1 "apples" actual cleared/);

  out = cli(file, 'price', '2', '2.00');
  assert.match(out, /#2 "milk" price set to \$2\.00 \[manual\]/);

  out = cli(file, 'budget', '30');
  assert.match(out, /budget set to \$30\.00/);
  out = cli(file, 'list');
  assert.match(out, /Budget: \$30\.00/);
  assert.match(out, /remaining \$2\.00/);

  out = cli(file, 'toggle', '3');
  assert.match(out, /#3 "dragon scales" checked/);
  out = cli(file, 'clear');
  assert.match(out, /removed 2 checked entries/);
  out = cli(file, 'list');
  assert.doesNotMatch(out, /apples/);
  assert.match(out, /milk/);

  out = cli(file, 'remove', '2');
  assert.match(out, /removed #2 "milk"/);
  out = cli(file, 'list');
  assert.match(out, /No entries yet/);
});

test('recurring entries: catalog hint and explicit --monthly flag', () => {
  const file = makeFile();
  let out = cli(file, 'add', 'Hyra');
  assert.match(out, /\$1,200\.00\/month/);
  assert.match(out, /\(recurring\/monthly\)/);
  out = cli(file, 'add', '--monthly', 'Bokföring');
  assert.match(out, /#2 "Bokföring"/);
  assert.match(out, /\(recurring\/monthly\)/);
  out = cli(file, 'add', '--yearly', 'Domän');
  assert.match(out, /\(recurring\/yearly\)/);
  out = cli(file, 'add', '--once', 'Kontorsstol');
  assert.match(out, /\$250\.00/);
  assert.match(out, /\(once\)/);
  out = cli(file, 'list');
  assert.match(out, /recurring\/monthly\s+Hyra/);
  assert.match(out, /Recurring: \$1,251\.25\/month/);
  assert.match(out, /One-time: \$250\.00/);
});

test('data persists across processes', () => {
  const file = makeFile();
  cli(file, 'add', 'bread x3');
  const out = cli(file, 'list');
  assert.match(out, /bread/);
  assert.match(out, /\$9\.00/);
});

test('unknown command prints help', () => {
  const file = makeFile();
  const out = cli(file, 'frobnicate');
  assert.match(out, /unknown command: frobnicate/);
  assert.match(out, /add \[--once/);
});

test('currency flag is applied and persisted; catalog prices convert', () => {
  const file = makeFile();
  const r = spawnSync(process.execPath, [entry, '--file', file, '--currency', 'sek', 'add', 'milk'], {
    encoding: 'utf8'
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /17\.28/);
  const out = cli(file, 'list');
  assert.match(out, /17\.28/);
});

test('check with a bad id reports an error', () => {
  const file = makeFile();
  const out = cli(file, 'check', '42');
  assert.match(out, /error: no entry with that id/);
});

test('add splits multi-item lines into separate entries with per-part estimates', () => {
  const file = makeFile();
  let out = cli(file, 'add', 'PS5 + handkontroll');
  assert.match(out, /#1 "PS5".*\$500\.00 \[catalog\]/);
  assert.match(out, /#2 "handkontroll".*\$70\.00 \[catalog\]/);
  out = cli(file, 'add', '2 kg apples, 500 g chicken');
  assert.match(out, /#3 "apples".*\$6\.00/);
  assert.match(out, /#4 "chicken".*\$4\.00/);
  out = cli(file, 'add', 'milk @ 2,50');
  assert.match(out, /#5 "milk".*\$2\.50 \[given\]/);
  out = cli(file, 'list');
  assert.match(out, /Total planned: \$582\.50/);
});
