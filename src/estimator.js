import { CATALOG, UNITS, canonical } from './catalog.js';

function round2(n) {
  return Math.round(n * 100) / 100;
}

function parseNumber(s) {
  return Number(String(s).replace(',', '.'));
}

function matchCatalog(name) {
  let best = null;
  for (const entry of CATALOG) {
    for (const kw of entry.keywords) {
      const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s|es)?\\b`, 'i');
      if (re.test(name) && (!best || kw.length > best.kwLen)) {
        best = { ...entry, kwLen: kw.length };
      }
    }
  }
  return best;
}

export function parseEntry(text, fallbackEstimate = 5) {
  let rest = String(text).trim();
  if (!rest) throw new Error('entry name is empty');

  let givenPrice = null;
  const priceRe = /(?:^|\s)(?:[@=]|[$€£])\s*(\d+(?:[.,]\d+)?)(?:\s*(usd|eur|gbp))?(?=\s|$)/i;
  const codePriceRe = /(?:^|\s)(\d+(?:[.,]\d+)?)\s*(usd|eur|gbp)(?=\s|$)/i;
  let pm = rest.match(priceRe) || rest.match(codePriceRe);
  if (pm) {
    givenPrice = parseNumber(pm[1]);
    rest = (rest.slice(0, pm.index) + ' ' + rest.slice(pm.index + pm[0].length)).trim();
  }

  let quantity = 1;
  let unit = null;
  let m = rest.match(/^(\d+(?:[.,]\d+)?)\s*(x|kg|g|mg|ml|l|litre|liter|kwh|pcs?|pc|each|ea)?\s+(.+)$/i);
  if (m) {
    quantity = parseNumber(m[1]);
    unit = (m[2] || '').toLowerCase() || null;
    if (unit === 'x') unit = null;
    rest = m[3].trim();
  } else {
    m = rest.match(/^(.+?)\s+x\s*(\d+(?:[.,]\d+)?)$/i);
    if (m) {
      rest = m[1].trim();
      quantity = parseNumber(m[2]);
    }
  }

  const name = rest.replace(/\s+/g, ' ').trim();
  if (!name || UNITS[name.toLowerCase()]) throw new Error('entry name is empty');

  if (givenPrice !== null) {
    return { name, quantity: 1, unit: 'each', unitPrice: round2(givenPrice), cost: round2(givenPrice), source: 'given' };
  }

  const hit = matchCatalog(name);
  if (hit) {
    const entryUnit = UNITS[hit.unit];
    let qty = quantity;
    if (unit) {
      const parsed = UNITS[unit];
      if (parsed && parsed.dim === entryUnit.dim) {
        qty = (quantity * parsed.factor) / entryUnit.factor;
      }
    }
    qty = round2(qty);
    return { name, quantity: qty, unit: hit.unit, unitPrice: hit.price, cost: round2(qty * hit.price), source: 'catalog' };
  }

  const parsedUnit = unit ? UNITS[unit] : null;
  const shownUnit = parsedUnit ? unit : 'each';
  return {
    name,
    quantity,
    unit: shownUnit,
    unitPrice: round2(fallbackEstimate),
    cost: round2(quantity * fallbackEstimate),
    source: 'fallback'
  };
}

export function reestimate(item, fallbackEstimate = 5) {
  const parsed = parseEntry(`${item.quantity !== 1 || item.unit !== 'each' ? `${item.quantity} ${item.unit} ` : ''}${item.name}`, fallbackEstimate);
  return { ...item, ...parsed, source: parsed.source === 'fallback' ? 'fallback' : 'catalog' };
}
