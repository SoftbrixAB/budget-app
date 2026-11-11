import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEntry } from '../src/estimator.js';

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
