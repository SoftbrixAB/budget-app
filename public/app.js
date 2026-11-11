const $ = (id) => document.getElementById(id);

const state = {
  ws: localStorage.getItem('budget.ws') || 'default',
  data: null
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
    <div class="stat ${over ? 'over' : ''}"><div class="label">Checked</div><div class="value">${money(s.checked)}</div></div>
    <div class="budget-line">${d.budget !== null ? `Budget ${money(d.budget)} — ${over ? 'over budget by ' : 'remaining '}${money(Math.abs(s.remaining))}` : 'No budget set (see Settings)'}</div>
  `;

  renderList($('list-recurring'), d.entries.filter((e) => e.kind === 'recurring'));
  renderList($('list-once'), d.entries.filter((e) => e.kind !== 'recurring'));
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
    if (e.checked) li.classList.add('checked');
    li.innerHTML = `
      <label><input type="checkbox" ${e.checked ? 'checked' : ''}><span class="name">${esc(e.name)}</span></label>
      <span class="qty">${esc(e.quantity)} ${esc(e.unit)}</span>
      <span class="cost">${money(e.cost)}${e.kind === 'recurring' ? ' / ' + esc(e.interval) : ''}</span>
      ${e.kind === 'recurring' ? `<span class="badge" title="monthly equivalent">≈ ${money(e.monthly)}/mo</span>` : ''}
      <span class="badge src">${esc(e.source)}</span>
      <button type="button" data-act="price">price</button>
      <button type="button" data-act="del" class="del">✕</button>
    `;
    li.querySelector('input[type=checkbox]').addEventListener('change', async (ev) => {
      await api(`/api/entries/${e.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ checked: ev.target.checked })
      });
      await refresh();
    });
    li.querySelector('[data-act=price]').addEventListener('click', async () => {
      const p = prompt('Override price (leave empty to keep estimate)', e.unitPrice);
      if (p === null || p === '') return;
      await api(`/api/entries/${e.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ price: Number(p) })
      });
      await refresh();
    });
    li.querySelector('[data-act=del]').addEventListener('click', async () => {
      await api(`/api/entries/${e.id}`, { method: 'DELETE' });
      await refresh();
    });
    ul.appendChild(li);
  }
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
    await api('/api/entries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    $('add-text').value = '';
    $('add-price').value = '';
    await refresh();
  } catch (err) {
    alert(err.message);
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
    await refresh();
  } catch (err) {
    alert(err.message);
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
    await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name })
    }).then(async (r) => {
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || r.statusText);
      return b;
    });
    state.ws = name;
    localStorage.setItem('budget.ws', name);
    await refreshWorkspaces();
    await refresh();
  } catch (err) {
    alert(err.message);
  }
});

refreshWorkspaces().then(refresh).catch((err) => {
  document.body.innerHTML = `<main><section class="card"><h2>Error</h2><p>${esc(err.message)}</p></section></main>`;
});
