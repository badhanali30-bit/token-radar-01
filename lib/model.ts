// Token Radar — the scoring model (radar-2, "compass").
//
// The board ranks pre-token protocols only. A protocol is pre-token when the
// snapshot records no token for it: mcap_usd, gecko_id and symbol are all null.
// Protocols whose token already trades are never ranked here; they are listed
// apart, with the market cap the market itself gives them.
//
// Implied value is one formula over the snapshot's own figures — nothing else:
//
//   base        = tvl_usd x 0.32
//   growth      = clamp(change_7d, -50, +150)          (per cent, 0 when unreported)
//   growthMult  = 1 + growth / 100 x 0.8
//   ageYears    = min(age_days, 1460) / 365            (1460 days = 4 years, capped)
//   ageMult     = 1 + 0.18 x ln(1 + ageYears)          (unknown age: 180 days)
//   implied     = max(1, round(base x growthMult x ageMult))
//
// Why these three inputs, and why this shape:
//   * TVL is the scale of the business a token would one day represent. A
//     protocol holding $1B is worth more, all else equal, than one holding
//     $50M, so value starts as a fixed share (0.32) of TVL.
//   * Seven-day growth is momentum. A protocol growing 40% in a week is
//     attracting capital now; one shrinking 20% is losing it. The 0.8 weight
//     moves value up to +120% or down to -40%, and the clamp stops one freak
//     week (a +900% spike, a -95% collapse) from deciding the whole board.
//   * Age with no token is durability. A protocol that has run two years
//     without issuing a token has survived cycles and still has its launch
//     ahead of it; a three-week-old protocol has proved little. The logarithm
//     rewards the first year most and then flattens, so an ancient protocol
//     cannot outrank a much larger, faster-growing younger one on age alone.
//     The 1,460-day cap (4 years) keeps the age multiplier inside 1–1.33.
// No protocol name is ever special-cased: the same function scores every row,
// and the dashboard recomputes each row from these figures in the open.

/** One protocol entry: exactly the ten fields the sealed snapshot carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, printed in the dashboard so the judge can re-derive any row. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  age_weight: number;
  age_cap_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.32,
  growth_weight: 0.8,
  growth_floor: -50,
  growth_cap: 150,
  age_weight: 0.18,
  age_cap_days: 1460,
  unknown_age_days: 180,
};

/** The model's version label, shown on the dashboard. */
export const MODEL_VERSION = 'radar-2-compass';

/** Pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** Live-token protocols the "Already tokenized" tab carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    age_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A board row in the compact form data.js carries to the dashboard. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  age_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: the market's value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why a snapshot file is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; ageMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const ageYears = Math.min(Math.max(ageForModel, 0), model.age_cap_days) / 365;
  const ageMult = 1 + model.age_weight * Math.log(1 + ageYears);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * model.base_multiple * growthMult * ageMult));
  return { implied, growthPct, growthMult, ageMult, age };
}

/** Whether the snapshot records no token at all for a protocol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCLUDED_EARLY = new Set(['CEX', 'Bridge', 'Canonical Bridge']);

/** Whether a protocol may join the early radar: pre-token, not an exchange or
 *  a wrapped/bridged product of a token that already trades, and not a
 *  versioned pool of another protocol. Pre-token liquid-staking and restaking
 *  protocols stay in: a staking product with no token of its own is a genuine
 *  launch candidate, not a wrapper. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && (p.category === null || !EXCLUDED_EARLY.has(p.category)) && !VERSIONED.test(p.name);
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The protocols the board ranks, strongest implied value first, ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      age_multiplier: round4(s.ageMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols need a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * The category's main action, in words a farmer can follow: the action, the
 * asset and the chain come from the protocol's own record, never from a list
 * of names. Returns the action sentence plus a second, category-specific step.
 */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): [string, string] {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('dex')) {
    return [
      `Swap $${Math.round(capital / 2)} of USDC for the pool's other asset on ${n} (${chain}), then add $${capital} of liquidity to its deepest pool and keep the LP position open.`,
      `Swap back and forth through ${n} once a week so the wallet shows repeat trading volume, about $25 of swaps each time.`,
    ];
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return [
      `Supply $${capital} of USDC to ${n} on ${chain} as collateral and keep the supply position open.`,
      `Borrow $20 of a stablecoin against the collateral, hold it one week, then repay it in full so the wallet shows a complete borrow cycle.`,
    ];
  }
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options')) {
    return [
      `Deposit $${capital} of USDC as margin on ${n} (${chain}) and open a small long position of about $100 notional.`,
      `Close the position after 2 days, then open one opposite hedge of the same size so the wallet shows two settled trades.`,
    ];
  }
  if (c.includes('yield aggregator') || c.includes('yield')) {
    return [
      `Deposit $${capital} of USDC into ${n}'s highest-TVL vault on ${chain} and keep the vault shares.`,
      `Claim the vault's yield once a week and re-deposit it, so the wallet shows compounding activity.`,
    ];
  }
  if (c.includes('rwa') || c.includes('real world')) {
    return [
      `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} and hold it in the farming wallet.`,
      `Hold the asset through one full weekly yield distribution, then check the protocol's dashboard for the accrued amount.`,
    ];
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) {
    return [
      `Deposit $${capital} of USDC into a ${n} curated vault on ${chain} and keep the vault shares.`,
      `Move $25 of the deposit to a second vault run by a different curator after 2 weeks, so the wallet shows two vaults.`,
    ];
  }
  if (c.includes('bridge')) {
    return [
      `Bridge $${capital} of USDC to ${chain} through ${n} and keep the bridged funds in the farming wallet.`,
      `Use $25 of the bridged funds inside an app on ${chain} within 3 days, so the bridge is tied to real usage.`,
    ];
  }
  if (c.includes('staking') || c.includes('restak')) {
    return [
      `Stake $${capital} of the chain's staking asset through ${n} on ${chain} and keep the receipt token.`,
      `Deposit the receipt token into a lending market on ${chain} once, so the wallet shows the receipt in use.`,
    ];
  }
  if (c.includes('stable')) {
    return [
      `Mint $${capital} of the stable asset through ${n} on ${chain} and hold it in the farming wallet.`,
      `Swap $25 of the minted stable for USDC and back once a week, so the wallet shows the stable in circulation.`,
    ];
  }
  if (c.includes('prediction')) {
    return [
      `Fund the farming wallet with $${capital} and place one $25 position on a ${n} market that settles within 2 weeks.`,
      `Place a second $25 position on the opposite outcome after the first settles, so the wallet shows two settled markets.`,
    ];
  }
  if (c.includes('insurance')) {
    return [
      `Buy $${capital} of cover from ${n} on ${chain} and keep the policy active in the farming wallet.`,
      `Renew or extend the cover once before it lapses, so the wallet shows two cover periods.`,
    ];
  }
  return [
    `Deposit $${capital} of USDC into ${n} on ${chain} and keep the position open.`,
    `Repeat the deposit's core action once a week with $25, so the wallet shows steady weekly activity.`,
  ];
}

/**
 * A protocol's farm plan: seven steps, each an action with its cost and its
 * time. Every step is derived from the protocol's own record (category,
 * chains, TVL, age); the capital, the hold and the gas all scale with it.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const [main, second] = actionsFor(p, capital, chain);
  const gas = capital >= 150 ? 8 : 4;
  const steps = [
    `Set up a fresh wallet holding only the funds you plan to farm with, and keep its seed phrase offline on paper. Cost: under $3 of gas for the first transaction. Time: 5 minutes.`,
    `${main} Cost: $${capital} of capital and about $${gas} of gas. Time: 15 minutes to set up.`,
    `${second} Cost: about $2 of gas. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot. Cost: the $${capital} stays in the position. Time: ${hold} days.`,
    `Once a month, open ${p.name}'s own points or rewards page and check the wallet's standing; claim only from a link the protocol itself publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.`,
    `If the protocol announces a token, claim from its official page within the first week and sell half at once, keeping the rest for a month. Cost: about $3 of gas to claim. Time: 15 minutes.`,
    `Write the wallet address, the dates and every transaction hash in a farm log, so you can repeat the position or unwind it cleanly. Cost: nothing but the log. Time: 5 minutes.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

/** The live-token protocols, by market cap, for the dashboard's separate tab. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((row) => ({
      rank: row.rank,
      slug: row.slug,
      name: row.name,
      category: row.category,
      chains: row.chains,
      tvl_usd: row.tvl_usd,
      change_7d: row.change_7d,
      listed_at: row.listed_at,
      age_days: row.age_days,
      implied_value_usd: row.implied_value_usd,
      growth_multiplier: row.model.growth_multiplier,
      age_multiplier: row.model.age_multiplier,
      farm_steps: row.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
