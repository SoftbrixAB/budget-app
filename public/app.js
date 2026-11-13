const $ = (id) => document.getElementById(id);

const state = {
  ws: localStorage.getItem('budget.ws') || 'default',
  data: null,
  lastAddedId: null
};

async function api(path, opts = {}) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${path}${sep}workspace=${encodeURIComponent(state.ws)}`, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function money(n) {
  const cur = state.data ? state.data.currency : 'USD';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(n);
  } catch {
    return `${Number(n).toFixed(2)} ${cur}`;
  }
}

function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('toasts').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 350);
  }, 4200);
}

function route() {
  const isSettings = location.hash === '#/settings';
  $('view-checklist').hidden = isSettings;
  $('view-settings').hidden = !isSettings;
  document.querySelectorAll('nav a').forEach((a) =>
    a.classList.toggle('active', a.dataset.view === (isSettings ? 'settings' : 'checklist'))
  );
}
window.addEventListener('hashchange', route);

async function refreshWorkspaces() {
  const { workspaces } = await fetch('/api/workspaces').then((r) => r.json());
  const sel = $('workspace');
  sel.innerHTML = '';
  for (const w of workspaces.length ? workspaces : ['default']) {
    const opt = document.createElement('option');
    opt.value = w;
    opt.textContent = w;
    sel.appendChild(opt);
  }
  if (![...sel.options].some((o) => o.value === state.ws)) state.ws = sel.options[0].value;
  sel.value = state.ws;
}

async function refresh() {
  state.data = await api('/api/state');
  render();
}

function render() {
  const d = state.data;
  $('currency').value = d.currency;
  $('budget').value = d.budget ?? '';
  $('fallback').value = d.fallbackEstimate;

  const s = d.summary;
  const over = s.remaining !== null && s.remaining < 0;
  $('summary').innerHTML = `
    <div class="stat"><div class="label">One-time</div><div class="value">${money(s.once)}</div></div>
    <div class="stat"><div class="label">Recurring / month</div><div class="value">${money(s.monthly)}</div></div>
    <div class="stat"><div class="label">Total planned</div><div class="value">${money(s.total)}</div></div>
    <div class="stat"><div class="label">Estimated</div><div class="value">${money(s.estimated)}</div></div>
    <div class="stat"><div class="label">Actual${s.actualCount ? ` (${s.actualCount})` : ''}</div><div class="value">${money(s.actual)}</div></div>
    <div class="stat ${over ? 'over' : ''}"><div class="label">Checked</div><div class="value">${money(s.checked)}</div></div>
    <div class="budget-line">${d.budget !== null ? `Budget ${money(d.budget)} — ${over ? 'over budget by ' : 'remaining '}${money(Math.abs(s.remaining))}` : 'No budget set (see Settings)'}</div>
  `;

  renderList($('list-recurring'), d.entries.filter((e) => e.kind === 'recurring'));
  renderList($('list-once'), d.entries.filter((e) => e.kind !== 'recurring'));

  if (state.lastAddedId !== null) {
    const li = document.querySelector(`li[data-id="${state.lastAddedId}"]`);
    if (li) {
      li.classList.add('flash');
      li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    state.lastAddedId = null;
  }
}

function renderList(ul, entries) {
  ul.innerHTML = '';
  if (!entries.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'nothing here yet';
    ul.appendChild(li);
    return;
  }
  for (const e of entries) {
    const li = document.createElement('li');
    li.dataset.id = e.id;
    if (e.checked) li.classList.add('checked');
    li.innerHTML = `
      <label><input type="checkbox" ${e.checked ? 'checked' : ''}><span class="name">${esc(e.name)}</span></label>
      <span class="qty">${esc(e.quantity)} ${esc(e.unit)}</span>
      <span class="cost">${money(e.cost)}${e.kind === 'recurring' ? ' / ' + esc(e.interval) : ''}</span>
      ${e.kind === 'recurring' ? `<span class="badge" title="monthly equivalent">≈ ${money(e.monthly)}/mo</span>` : ''}
      ${e.actualCost !== null && e.actualCost !== undefined ? `<span class="badge act" title="actual paid (estimate was ${money(e.estimatedCost ?? e.cost)})">actual ${money(e.actualCost)}</span>` : ''}
      <span class="badge src">${esc(e.source)}</span>
      <button type="button" data-act="edit">edit</button>
      <button type="button" data-act="del" class="del">✕</button>
    `;
    li.querySelector('input[type=checkbox]').addEventListener('change', async (ev) => {
      const body = { checked: ev.target.checked };
      if (ev.target.checked && (e.actualCost === null || e.actualCost === undefined)) {
        const p = prompt(`Actual cost paid for "${e.name}" (empty = keep estimate ${money(e.cost)}):`);
        if (p !== null && p !== '') body.actual = Number(p);
      }
      try {
        await api(`/api/entries/${e.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        });
        await refresh();
      } catch (err) {
        toast(err.message, 'err');
      }
    });
    li.querySelector('[data-act=edit]').addEventListener('click', () => startEdit(li, e));
    li.querySelector('[data-act=del]').addEventListener('click', async () => {
      try {
        await api(`/api/entries/${e.id}`, { method: 'DELETE' });
        toast(`removed #${e.id} "${e.name}"`);
        await refresh();
      } catch (err) {
        toast(err.message, 'err');
      }
    });
    ul.appendChild(li);
  }
}

const UNIT_OPTIONS = ['each', 'kg', 'g', 'l', 'ml', 'kwh'];
const INTERVAL_OPTIONS = ['weekly', 'monthly', 'quarterly', 'yearly'];

function startEdit(li, e) {
  li.classList.add('editing');
  li.innerHTML = `
    <input class="e-name" type="text" value="${esc(e.name)}" title="name">
    <input class="e-qty" type="number" step="any" min="0.0001" value="${e.quantity}" title="quantity">
    <select class="e-unit" title="unit">
      ${UNIT_OPTIONS.map((u) => `<option value="${u}" ${u === e.unit ? 'selected' : ''}>${u}</option>`).join('')}
    </select>
    <input class="e-price" type="number" step="0.01" min="0" value="${e.unitPrice}" title="unit price (planned)">
    <input class="e-actual" type="number" step="0.01" min="0" value="${e.actualCost ?? ''}" title="actual paid (empty = none)" placeholder="actual">
    <select class="e-kind" title="cost type">
      <option value="once" ${e.kind === 'once' ? 'selected' : ''}>one-time</option>
      <option value="recurring" ${e.kind === 'recurring' ? 'selected' : ''}>recurring</option>
    </select>
    <select class="e-interval" title="interval" ${e.kind === 'recurring' ? '' : 'hidden'}>
      ${INTERVAL_OPTIONS.map((i) => `<option value="${i}" ${i === e.interval ? 'selected' : ''}>${i}</option>`).join('')}
    </select>
    <button type="button" class="save">Save</button>
    <button type="button" class="cancel">Cancel</button>
  `;
  const kindSel = li.querySelector('.e-kind');
  kindSel.addEventListener('change', () => {
    li.querySelector('.e-interval').hidden = kindSel.value !== 'recurring';
  });
  li.querySelector('.cancel').addEventListener('click', () => refresh());
  li.querySelector('.save').addEventListener('click', async () => {
    const actualVal = li.querySelector('.e-actual').value;
    const body = {
      name: li.querySelector('.e-name').value,
      quantity: Number(li.querySelector('.e-qty').value),
      unit: li.querySelector('.e-unit').value,
      price: Number(li.querySelector('.e-price').value),
      actual: actualVal === '' ? null : Number(actualVal),
      kind: kindSel.value
    };
    if (kindSel.value === 'recurring') body.interval = li.querySelector('.e-interval').value;
    try {
      await api(`/api/entries/${e.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      toast(`updated #${e.id} "${body.name}" — now ${money(body.quantity * body.price)}${body.kind === 'recurring' ? '/' + body.interval : ''}`);
      await refresh();
    } catch (err) {
      toast(err.message, 'err');
    }
  });
}

$('add-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const body = { text: $('add-text').value };
  const kind = $('add-kind').value;
  if (kind === 'once') body.kind = 'once';
  else if (kind) {
    body.kind = 'recurring';
    body.interval = kind;
  }
  if ($('add-price').value) body.price = Number($('add-price').value);
  try {
    const r = await api('/api/entries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const e = r.entry;
    state.lastAddedId = e.id;
    toast(`added #${e.id} "${e.name}" — estimated ${money(e.cost)}${e.kind === 'recurring' ? '/' + e.interval : ''} [${e.source}]`);
    $('add-text').value = '';
    $('add-price').value = '';
    await refresh();
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('settings-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  try {
    await api('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        currency: $('currency').value,
        budget: $('budget').value === '' ? null : Number($('budget').value),
        fallbackEstimate: Number($('fallback').value)
      })
    });
    toast('settings saved');
    await refresh();
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('workspace').addEventListener('change', async (ev) => {
  state.ws = ev.target.value;
  localStorage.setItem('budget.ws', state.ws);
  await refresh();
});

$('new-ws').addEventListener('click', async () => {
  const name = prompt('New workspace name (letters, numbers, - _):');
  if (!name) return;
  try {
    const r = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const b = await r.json();
    if (!r.ok) throw new Error(b.error || r.statusText);
    state.ws = name;
    localStorage.setItem('budget.ws', name);
    toast(`workspace "${name}" created`);
    await refreshWorkspaces();
    await refresh();
  } catch (err) {
    toast(err.message, 'err');
  }
});

route();
refreshWorkspaces().then(refresh).catch((err) => {
  document.body.innerHTML = `<main><section class="card"><h2>Error</h2><p>${esc(err.message)}</p></section></main>`;
});
