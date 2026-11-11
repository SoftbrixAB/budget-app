# budget-app

A zero-dependency Node.js CLI budget app. It keeps a **checklist** of entries and
**estimates the cost of each entry automatically** when you add it, with running
totals for checked (bought) vs unchecked items and an optional budget limit.

## Requirements

Node.js >= 18. No npm dependencies.

## Usage

```sh
npm start                 # interactive session
node budget.js list       # one-shot command
node budget.js add "2 kg apples"
node budget.js --file my.json --currency EUR list
```

Data is stored in `./budget.json` (override with `--file <path>` or `$BUDGET_FILE`).

## Commands

| Command | Description |
| --- | --- |
| `add <item> [qty] [unit] [@ price]` | Add an entry; the cost is estimated automatically |
| `list` | Show the checklist with per-entry estimates and totals |
| `check <id>` / `uncheck <id>` / `toggle <id>` | Mark entries as bought / not bought |
| `price <id> <amount>` | Override the estimate with an actual price |
| `remove <id>` | Delete an entry |
| `budget [amount]` | Show or set the budget limit |
| `fallback [amount]` | Show or set the fallback estimate for unknown items |
| `clear` | Remove all checked entries |
| `help` | Show all commands |

## How cost estimation works

When you add an entry, the text is parsed in this order:

1. **Explicit price** — `add milk @ 2.50` or `add wine $12` uses the given price (`source: given`).
2. **Catalog match** — a built-in price catalog (`src/catalog.js`) matches the item
   name, e.g. `add 2 kg apples` → 2 kg × $3.00/kg = $6.00 (`source: catalog`).
   Quantities with units (`kg`, `g`, `l`, `ml`, `kwh`, `pcs`, ...) are converted to
   the catalog unit. A bare quantity (`add 2 apples`) counts in the item's unit.
3. **Fallback** — unknown items get a configurable flat estimate
   (default $5, `source: fallback`).

Override any estimate with `price <id> <amount>` (`source: manual`).

## Example session

```
budget> add 2 kg apples
added #1 "apples" (2 kg) — estimated $6.00 [catalog]
budget> add bread x3
added #2 "bread" (3 each) — estimated $9.00 [catalog]
budget> add concert ticket @ 45
added #3 "concert ticket" (1 each) — estimated $45.00 [given]
budget> check 1
#1 "apples" checked — $6.00
budget> budget 100
budget set to $100.00
budget> list
ID  DONE  ITEM             QTY        ESTIMATE  SOURCE
 1  [x]   apples           2 kg       $6.00     catalog
 2  [ ]   bread            3 each     $9.00     catalog
 3  [ ]   concert ticket   1 each     $45.00    given

Total estimated: $60.00  (checked: $6.00, unchecked: $54.00)
Budget: $100.00  remaining $40.00
```

## Tests

```sh
npm test
```
