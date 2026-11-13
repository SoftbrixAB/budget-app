function round2(n) {
  return Math.round(n * 100) / 100;
}

export function monthlyEquivalent(entry) {
  if (entry.kind !== 'recurring' || !entry.interval) return 0;
  const cost = Number(entry.cost) || 0;
  switch (entry.interval) {
    case 'weekly':
      return round2((cost * 52) / 12);
    case 'quarterly':
      return round2(cost / 3);
    case 'yearly':
      return round2(cost / 12);
    case 'monthly':
    default:
      return round2(cost);
  }
}

function normalizedCost(it, cost) {
  if (it.kind === 'recurring') return monthlyEquivalent({ kind: it.kind, interval: it.interval, cost });
  return cost;
}

export function summarize(store) {
  let once = 0;
  let onceChecked = 0;
  let monthly = 0;
  let monthlyChecked = 0;
  let estimated = 0;
  let actual = 0;
  let actualCount = 0;
  for (const it of store.items) {
    const cost = Number(it.cost) || 0;
    if (it.kind === 'recurring') {
      const m = monthlyEquivalent(it);
      monthly += m;
      if (it.checked) monthlyChecked += m;
    } else {
      once += cost;
      if (it.checked) onceChecked += cost;
    }
    estimated += normalizedCost(it, Number(it.estimatedCost ?? it.cost) || 0);
    if (it.actualCost !== null && it.actualCost !== undefined) {
      actual += normalizedCost(it, Number(it.actualCost) || 0);
      actualCount++;
    }
  }
  const total = once + monthly;
  const checked = onceChecked + monthlyChecked;
  const remaining = store.budget !== null && store.budget !== undefined ? store.budget - total : null;
  return {
    once: round2(once),
    onceChecked: round2(onceChecked),
    monthly: round2(monthly),
    monthlyChecked: round2(monthlyChecked),
    total: round2(total),
    checked: round2(checked),
    unchecked: round2(total - checked),
    remaining: remaining === null ? null : round2(remaining),
    estimated: round2(estimated),
    actual: round2(actual),
    actualCount
  };
}
