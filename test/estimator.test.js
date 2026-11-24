import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEntry, parseEntryLine } from '../src/estimator.js';

test('parses quantity and unit from the front: "2 kg apples"', () => {
  const e = parseEntry('2 kg apples');
  assert.equal(e.name, 'apples');
  assert.equal(e.quantity, 2);
  assert.equal(e.unit, 'kg');
  assert.equal(e.source, 'catalog');
  assert.equal(e.cost, 6.0);
});

test('converts grams to kilograms: "500 g chicken"', () => {
  const e = parseEntry('500 g chicken');
  assert.equal(e.quantity, 0.5);
  assert.equal(e.unit, 'kg');
  assert.equal(e.cost, 4.0);
});

test('defaults to one unit of the catalog item: "milk"', () => {
  const e = parseEntry('milk');
  assert.equal(e.quantity, 1);
  assert.equal(e.unit, 'l');
  assert.equal(e.cost, 1.6);
});

test('supports trailing multiplier: "bread x3"', () => {
  const e = parseEntry('bread x3');
  assert.equal(e.name, 'bread');
  assert.equal(e.quantity, 3);
  assert.equal(e.cost, 9.0);
});

test('supports leading multiplier: "3x toilet paper"', () => {
  const e = parseEntry('3x toilet paper');
  assert.equal(e.name, 'toilet paper');
  assert.equal(e.quantity, 3);
  assert.equal(e.cost, 3.0);
});

test('quantity without unit is counted in the catalog unit: "2 apples"', () => {
  const e = parseEntry('2 apples');
  assert.equal(e.quantity, 2);
  assert.equal(e.unit, 'kg');
  assert.equal(e.cost, 6.0);
});

test('explicit price wins and is flagged as given: "milk @ 2.50"', () => {
  const e = parseEntry('milk @ 2.50');
  assert.equal(e.source, 'given');
  assert.equal(e.cost, 2.5);
  assert.equal(e.unitPrice, 2.5);
});

test('explicit price with currency symbol: "wine $12"', () => {
  const e = parseEntry('wine $12');
  assert.equal(e.source, 'given');
  assert.equal(e.cost, 12);
});

test('unknown items get the fallback estimate and are flagged', () => {
  const e = parseEntry('unicorn horn', 7);
  assert.equal(e.source, 'fallback');
  assert.equal(e.unit, 'each');
  assert.equal(e.cost, 7);
});

test('fallback multiplies by quantity: "4 dragon scales"', () => {
  const e = parseEntry('4 dragon scales', 7);
  assert.equal(e.source, 'fallback');
  assert.equal(e.quantity, 4);
  assert.equal(e.cost, 28);
});

test('prefers the longest matching keyword: "ground coffee"', () => {
  const e = parseEntry('ground coffee');
  assert.equal(e.name, 'ground coffee');
  assert.equal(e.unitPrice, 14.0);
  assert.equal(e.recurring, null);
});

test('does not match substrings inside words: "milkshake" is not milk', () => {
  const e = parseEntry('milkshake', 5);
  assert.equal(e.source, 'fallback');
});

test('empty input throws', () => {
  assert.throws(() => parseEntry('   '), /empty/);
  assert.throws(() => parseEntry('2 kg'), /empty/);
});

test('volume conversion: "250 ml juice"', () => {
  const e = parseEntry('250 ml juice');
  assert.equal(e.quantity, 0.25);
  assert.equal(e.unit, 'l');
  assert.equal(e.cost, 0.63);
});

test('swedish office items match the catalog: "Kontorsstol"', () => {
  const e = parseEntry('Kontorsstol');
  assert.equal(e.source, 'catalog');
  assert.equal(e.cost, 250);
  assert.equal(e.recurring, null);
});

test('"Skärm med inbyggd kamera" matches monitor', () => {
  const e = parseEntry('Skärm med inbyggd kamera och ljud');
  assert.equal(e.source, 'catalog');
  assert.equal(e.unitPrice, 300);
});

test('"PS5" matches the console; longer keywords win in mixed text', () => {
  const e = parseEntry('PS5');
  assert.equal(e.source, 'catalog');
  assert.equal(e.unitPrice, 500);
  const mixed = parseEntry('PS5 med extra handkontroll');
  assert.equal(mixed.unitPrice, 70);
});

test('recurring catalog items carry the interval hint: "Hyra"', () => {
  const e = parseEntry('Hyra');
  assert.equal(e.source, 'catalog');
  assert.equal(e.recurring, 'monthly');
  assert.equal(e.cost, 1200);
});

test('"Pensionssparande" is recurring monthly', () => {
  const e = parseEntry('Pensionssparande');
  assert.equal(e.recurring, 'monthly');
  assert.equal(e.cost, 200);
});

test('"Domän" is recurring yearly', () => {
  const e = parseEntry('Domän');
  assert.equal(e.recurring, 'yearly');
});

test('catalog prices convert to the workspace currency: SEK', () => {
  const e = parseEntry('milk', 5, { currency: 'SEK' });
  assert.equal(e.source, 'catalog');
  assert.equal(e.unitPrice, 17.28);
  assert.equal(e.cost, 17.28);
});

test('given prices are not converted (already in workspace currency)', () => {
  const e = parseEntry('Hyra @ 12000', 5, { currency: 'SEK' });
  assert.equal(e.source, 'given');
  assert.equal(e.cost, 12000);
});

test('fallback estimate is not converted (already in workspace currency)', () => {
  const e = parseEntry('mystery item', 500, { currency: 'SEK' });
  assert.equal(e.source, 'fallback');
  assert.equal(e.cost, 500);
});

test('parseEntryLine splits multi-item lines into one parsed entry per part', () => {
  const plus = parseEntryLine('PS5 + handkontroll');
  assert.equal(plus.length, 2);
  assert.deepEqual(plus.map((p) => p.name), ['PS5', 'handkontroll']);
  assert.deepEqual(plus.map((p) => p.cost), [500, 70]);
  assert.deepEqual(plus.map((p) => p.source), ['catalog', 'catalog']);

  const comma = parseEntryLine('2 kg apples, 500 g chicken');
  assert.equal(comma.length, 2);
  assert.deepEqual(comma.map((p) => p.cost), [6, 4]);

  const och = parseEntryLine('Kontorsstol och Pennor');
  assert.equal(och.length, 2);
  assert.deepEqual(och.map((p) => p.cost), [250, 8]);

  const single = parseEntryLine('milk');
  assert.equal(single.length, 1);
  assert.equal(single[0].cost, 1.6);
});

test('parseEntryLine does not split decimal commas in prices', () => {
  const parts = parseEntryLine('milk @ 2,50');
  assert.equal(parts.length, 1);
  assert.equal(parts[0].source, 'given');
  assert.equal(parts[0].cost, 2.5);
});

test('parseEntryLine throws on empty input', () => {
  assert.throws(() => parseEntryLine('   '), /empty/);
  assert.throws(() => parseEntryLine(' + '), /empty/);
});
