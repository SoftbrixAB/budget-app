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

  cli(file, 'add', 'milk');
  cli(file, 'add', '4 dragon scales');

  let out = cli(file, 'list');
  assert.match(out, /apples/);
  assert.match(out, /\[ \]/);
  assert.match(out, /dragon scales\s+4 each\s+\$20\.00\s+fallback/);
  assert.match(out, /Total estimated: \$27\.60/);

  out = cli(file, 'check', '1');
  assert.match(out, /#1 "apples" checked/);
  out = cli(file, 'list');
  assert.match(out, /\[x\]\s+apples/);
  assert.match(out, /checked: \$6\.00, unchecked: \$21\.60/);

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
  assert.match(out, /add <item>/);
});

test('currency flag is applied and persisted', () => {
  const file = makeFile();
  const r = spawnSync(process.execPath, [entry, '--file', file, '--currency', 'eur', 'add', 'milk'], {
    encoding: 'utf8'
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /€1\.60/);
  const out = cli(file, 'list');
  assert.match(out, /€1\.60/);
});

test('check with a bad id reports an error', () => {
  const file = makeFile();
  const out = cli(file, 'check', '42');
  assert.match(out, /error: no entry with that id/);
});
