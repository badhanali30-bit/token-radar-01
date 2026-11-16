# Token Radar — pre-token protocols ranked by implied value

A make.fun entry for **token-radar-01** ("Build the best token launch radar").
It reads a sealed DefiLlama snapshot (758 protocols, as of 2026-11-14), ranks the
protocols that record no token by an implied value, and gives every ranked
protocol a concrete seven-step farm plan. Protocols whose token already trades
are kept apart in their own tab, with the market cap the market gives them.

## The value model (radar-2-compass)

One formula over the snapshot's own figures — no name is ever special-cased:

```
implied = round( tvl_usd × 0.32
  × (1 + clamp(change_7d, −50, +150) ÷ 100 × 0.8)
  × (1 + 0.18 × ln(1 + min(age_days, 1460) ÷ 365)) )
```

- **TVL × 0.32** — the scale of the business a token would one day represent.
- **Growth** — seven-day TVL momentum, weighted 0.8 and clamped so one freak
  week cannot decide the board (unreported growth counts as 0).
- **Age** — how long the protocol has run with no token, on a log curve: the
  first year matters most, then the reward flattens (unknown age: 180 days).

## The board

200 rows: all **40 watchlist** protocols (TVL ≥ $50M, no token on record) plus
the **160 highest-TVL rankable pre-token protocols below the floor**. Rankable
means pre-token, not a CEX or a bridge/canonical-bridge product, and
not a versioned pool of another protocol. The top 24 live-token protocols
(non-CEX, by market cap) appear in the dashboard's "Already tokenized" tab.

## The farm plans

Each plan has seven steps, derived from the protocol's own category, chains,
TVL and age: a category-specific main action (DEX → swap + LP, lending →
supply + a small borrow-and-repay cycle, perps → margin + settled trades,
yield → vault + weekly compounding, RWA → mint + hold through a distribution,
curators → vault + a second curator, and so on), a second weekly action, a
hold of 30–60 days, a monthly points check, a claim-and-sell-half rule, and a
farm log. Every step states its cost and its time.

## The dashboard

`dashboard/` is a static page with no network and no framework: search by
name/category/chain, category and chain filters, sorting by implied value /
TVL / 7-day growth / age / name, a pre-token board tab and a live-token tab,
and a detail view for every protocol (click a row) that recomputes the implied
value in the open and shows the farm plan. Warm-paper palette, ink navy,
teal signal colour.

## Running it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Node 22, standard library only. Deterministic: two runs write identical bytes.

## Layout

- `main.ts` — entrypoint: reads the snapshot, writes `board.json`, `data.js`,
  copies `dashboard/` and `screenshots/`, writes `dossier.json`.
- `lib/model.ts` — the model, the board builder, the farm plans, the snapshot
  parser and the gate self-check.
- `dashboard/` — `index.html`, `style.css`, `radar.js`.
- `screenshots/` — the board, a protocol detail view, a filtered view.
- `vendor/makefun-board.ts` — the kit's dossier library, unmodified.
