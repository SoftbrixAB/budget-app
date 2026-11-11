# budget-app

A zero-dependency Node.js budget app — now with a **web UI + JSON REST API** (SaaS-ready
shape) and a **CLI** that shares the same model. It keeps a **checklist** of entries and
**estimates the cost of each entry automatically**, and it handles both **one-time
purchases** and **recurring costs** (weekly / monthly / quarterly / yearly).

## Requirements

Node.js >= 18. No npm dependencies.

## Run the web app

```sh
npm start          # serves UI + API on http://127.0.0.1:3000 (HOST/PORT env to change)
```

- Open http://127.0.0.1:3000 in a browser.
- Each **workspace** is a separate budget (data file in `./data/<workspace>.json`,
  override with `DATA_DIR`). Create/switch workspaces in the header — this is the
  multi-tenant seed for a SaaS product.
- Add entries as free text, e.g. `Kontorsstol`, `2 kg apples`, `PS5 @ 6000`,
  or pick a cost type (one-time / recurring monthly / …) in the form.
- Check items off, override any estimate with the **price** button, see one-time total,
  recurring per-month total, total planned spend, and remaining budget.

## Run the CLI

```sh
npm run cli -- list
node budget.js add "2 kg apples"
node budget.js add --monthly Hyra
node budget.js --file my.json --currency SEK list
```

CLI commands: `add [--once|--monthly|--quarterly|--yearly|--weekly] <item> [qty] [unit] [@ price]`,
`list`, `check` / `uncheck` / `toggle <id>`, `price <id> <amount>`, `remove <id>`,
`budget [amount]`, `fallback [amount]`, `clear`, `help`.
Without arguments it starts an interactive session.

## How cost estimation works

`src/estimator.js` parses each entry text in this order:

1. **Explicit price** — `PS5 @ 6000`, `wine $12` → `source: given` (taken as-is in the workspace currency).
2. **Catalog match** — `src/catalog.js` (~90 items: groceries, household, and small-company
   items in Swedish/English — kontorsstol, skrivare, pennor, papper, skärm, PS5,
   handkontroll, kaffe, papperskorg, hemmaserver, hyra, försäkring, pensionssparande, …).
   Longest keyword wins; quantities with units are converted (`2 kg apples`, `500 g chicken`,
   `bread x3`). Catalog prices are in USD and converted with `FX_RATES` when the workspace
   uses another currency (set the currency **before** adding entries). → `source: catalog`.
3. **Fallback** — unknown items get a configurable flat estimate (`fallback`, default 5)
   → `source: fallback`.

Any estimate can be overridden per entry → `source: manual`.

## Recurring vs one-time

Every entry has a `kind` (`once` | `recurring`) and, for recurring, an `interval`
(`weekly` | `monthly` | `quarterly` | `yearly`). The catalog hints the type
(`Hyra`, `Internet`, `Pensionssparande` → recurring monthly; `Domän` → yearly), and you can
force it in the UI or with `add --monthly …`. Summaries report:

- **One-time**: total cost of one-time purchases
- **Recurring/month**: recurring costs normalized to a monthly equivalent
  (yearly ÷ 12, quarterly ÷ 3, weekly × 52/12)
- **Total planned**: one-time + monthly equivalent; compared against `budget`

## REST API

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | health check |
| `GET /api/workspaces` | list workspaces |
| `POST /api/workspaces` | create workspace `{name}` |
| `GET /api/state?workspace=X` | settings + entries (with `monthly` equivalent) + summary |
| `POST /api/entries?workspace=X` | add entry `{text, kind?, interval?, price?}` |
| `PATCH /api/entries/:id?workspace=X` | update `{checked?, price?, name?, kind?, interval?}` |
| `DELETE /api/entries/:id?workspace=X` | delete entry |
| `PUT /api/settings?workspace=X` | update `{currency?, budget?, fallbackEstimate?}` |

The server binds to `127.0.0.1` by default (`HOST`/`PORT` env). Static files are served
from `public/` with path-traversal protection; workspace names are validated; request
bodies are size-limited.

## SaaS roadmap (seed structure)

- **Workspaces** already isolate data per tenant (`data/<workspace>.json`); swap the
  file store for a database by changing `loadStore`/`saveStore` in `src/store.js`.
- The API is the integration surface for a hosted frontend or mobile app.
- Next steps for production: authentication + per-workspace membership, HTTPS termination
  in front of the app (never expose it directly), rate limiting, and billing (e.g. Stripe)
  keyed on workspace.

## Tests

```sh
npm test
```

41 tests with the built-in `node:test` runner: estimator parsing/conversion/FX,
store persistence + v1 migration, model summaries, CLI end-to-end (spawned processes),
and the web API end-to-end (server on an ephemeral loopback port).
