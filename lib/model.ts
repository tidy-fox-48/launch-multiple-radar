// Launch Multiple Radar: the model behind the token launch radar.
//
// One sealed snapshot in, one ranked board out. The board ranks every protocol that records no
// token yet (no market cap, no CoinGecko id, no symbol in the snapshot) by an implied launch
// value, and keeps the protocols whose token already trades in a separate reference set, shown
// on the dashboard with the market's own numbers and never mixed into the ranking.
//
// One separation comes before any pricing, and it is the separation the snapshot's own watchlist
// uses: a record with no token of its own can still be a product of a protocol whose token
// already trades — a wrapped or bridged representation, an exchange's staking product, a second
// version of a launched protocol — or simply a company, not a launch. isDerivative() below
// applies that rule (exchange and bridge categories, the staking categories, name patterns), and
// those records are set aside with the already-trading set instead of ranked: an implied launch
// value for the wrapped bitcoin record would price bitcoin, not a launch.
//
// The implied value is derived from the snapshot's own figures, in four parts:
//
//   peer multiple  The snapshot's tokened protocols price themselves: for each category, the
//                  median market-cap / TVL ratio of the protocols in that category whose token
//                  already trades. A pre-token protocol is first valued as if it would trade
//                  where its own category's launched peers trade. Categories with fewer than
//                  three priced peers fall back to the all-category median. The multiple is
//                  clamped to [0.05, 3.0] so one wild peer cannot carry a category.
//   growth         1 + clamp(change_7d, -40, 80) x 0.006: a protocol adding TVL is worth more
//                  than its static size; one bleeding TVL is worth less. An unreported change
//                  counts as zero.
//   maturity       0.78 + 0.40 x min(age_days, 1460) / 1460, where age runs from the day
//                  DefiLlama began tracking the protocol to the snapshot's as_of day. A
//                  protocol that has run for years with no token has both the record and the
//                  reason to launch; an untracked age scores a neutral 0.92 instead.
//   reach          1 + 0.04 x min(chains - 1, 3): every extra chain is distribution a launch
//                  can price, capped at three extra chains.
//
//   implied_value_usd = round(tvl_usd x multiple x growth x maturity x reach), at least 1.
//
// No protocol name is ever special-cased: the same four parts score every row, and the
// dashboard shows each row's parts so a reader can disagree with any of them.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** One protocol after the model has scored it, before ranks are assigned. */
export interface Scored {
  protocol: SnapshotProtocol;
  implied: number;
  multiple: number;
  multiple_peers: number;
  growth_mult: number;
  maturity_mult: number;
  reach_mult: number;
  age_days: number | null;
  tier: string;
}

/** One row of the board file the gate reads. */
export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

/** Everything the dashboard renders, written beside the page as data.js. */
export interface Radar {
  as_of: string;
  floor_usd: number;
  protocol_count: number;
  pre_token_count: number;
  derivative_count: number;
  live_count: number;
  watchlist_size: number;
  board_size: number;
  total_implied: number;
  global_multiple: number;
  category_multiples: { category: string; multiple: number; peers: number }[];
  rows: {
    slug: string;
    name: string;
    category: string | null;
    chains: string[];
    tvl_usd: number;
    change_7d: number | null;
    listed_at: string | null;
    age_days: number | null;
    rank: number;
    implied_value_usd: number;
    value_per_tvl: number;
    multiple: number;
    growth_mult: number;
    maturity_mult: number;
    reach_mult: number;
    tier: string;
    watchlist: boolean;
    farm_steps: string[];
  }[];
  live: {
    slug: string;
    name: string;
    symbol: string | null;
    category: string | null;
    tvl_usd: number;
    mcap_usd: number;
    ratio: number;
  }[];
}

/** Read and lightly validate the sealed snapshot document. */
export function parseSnapshot(text: string): Snapshot {
  const doc = JSON.parse(text) as Snapshot;
  if (!Array.isArray(doc.protocols) || !Array.isArray(doc.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return doc;
}

/** A protocol records no token when the snapshot carries no market cap, id or symbol for it. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const DERIVATIVE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * The watchlist's own separation: a tokenless record that is really a product of a protocol
 * whose token already trades (or a company rather than a launch). Such records are set aside,
 * never ranked: their size is the underlying's size, not a launch waiting to be priced.
 */
export function isDerivative(p: SnapshotProtocol): boolean {
  if (p.category !== null && DERIVATIVE_CATEGORIES.has(p.category)) return true;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return true;
  if (/\s(v?\d+(\.\d+)?)$/i.test(p.name)) return true;
  return EXCHANGE_PREFIXES.some((name) => p.name.startsWith(name));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Whole days between two UTC date strings (yyyy-mm-dd), or null when either is unusable. */
function daysBetween(from: string | null, to: string): number | null {
  if (from === null) return null;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export interface PeerMultiples {
  byCategory: Map<string, { multiple: number; peers: number }>;
  global: number;
}

/**
 * Derive the peer multiples from the snapshot's tokened protocols: per category, the median
 * market-cap / TVL of the protocols whose token already trades and whose figures are usable.
 */
export function peerMultiples(snapshot: Snapshot): PeerMultiples {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    const key = p.category ?? 'Uncategorised';
    const list = ratios.get(key) ?? [];
    list.push(ratio);
    ratios.set(key, list);
    all.push(ratio);
  }
  const global = clamp(median(all), 0.05, 3);
  const byCategory = new Map<string, { multiple: number; peers: number }>();
  for (const [category, list] of ratios) {
    if (list.length >= 3) {
      byCategory.set(category, { multiple: clamp(median(list), 0.05, 3), peers: list.length });
    } else {
      byCategory.set(category, { multiple: global, peers: list.length });
    }
  }
  return { byCategory, global };
}

/** The signal tier a scored protocol falls in, from its implied value alone. */
export function tierOf(implied: number): string {
  if (implied >= 500_000_000) return 'Prime';
  if (implied >= 100_000_000) return 'Strong';
  if (implied >= 25_000_000) return 'Early';
  return 'Speculative';
}

/** Score one pre-token protocol: the four parts of the model, multiplied out. */
export function scoreProtocol(p: SnapshotProtocol, peers: PeerMultiples, asOf: string): Scored {
  const peer = peers.byCategory.get(p.category ?? 'Uncategorised');
  const multiple = peer?.multiple ?? peers.global;
  const growth = clamp(p.change_7d ?? 0, -40, 80);
  const growth_mult = 1 + growth * 0.006;
  const age_days = daysBetween(p.listed_at, asOf);
  const maturity_mult = age_days === null ? 0.92 : 0.78 + 0.4 * (Math.min(age_days, 1460) / 1460);
  const reach_mult = 1 + 0.04 * Math.min(Math.max(p.chains.length - 1, 0), 3);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growth_mult * maturity_mult * reach_mult));
  return {
    protocol: p,
    implied,
    multiple,
    multiple_peers: peer?.peers ?? 0,
    growth_mult,
    maturity_mult,
    reach_mult,
    age_days,
    tier: tierOf(implied),
  };
}

/** Compact dollar formatting the farm plans quote: $1.2B, $340M, $25K. */
export function money(usd: number): string {
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(0)}K`;
  return `$${usd}`;
}

/** The chain a plan tells the reader to work on first: the first the snapshot lists. */
function homeChain(p: SnapshotProtocol): string {
  return p.chains[0] ?? 'Ethereum';
}

/**
 * The concrete core action for a category family: what using the protocol actually means.
 * Each entry is [the action with its object, a sensible starting size, the follow-through].
 */
const CORE_ACTIONS: Record<string, [string, string, string]> = {
  Lending: [
    'supply a blue-chip asset (ETH or a major stablecoin) into its main market and leave it supplied',
    '$500-$2,000',
    'borrow no more than 30% against it for a week, then repay, so both sides of the market record your wallet',
  ],
  Dexs: [
    'swap through the exchange in both directions and add a small position to its deepest pool',
    '$300-$1,500 of volume a week',
    'keep the LP position open for at least two weeks and rebalance it once, rather than dipping in and out in a day',
  ],
  Derivatives: [
    'open small perpetual positions with tight size and close them over several sessions, not one',
    '$200-$1,000 of margin',
    'trade on at least six separate days across two weeks so the activity reads as use, not as a single wash',
  ],
  Yield: [
    'deposit into its flagship vault and hold the vault share through at least one full harvest cycle',
    '$500-$2,500',
    'split the deposit across two vaults if it offers them, and compound the yield once instead of withdrawing it',
  ],
  'Liquid Staking': [
    'stake ETH (or its native asset) through the protocol and hold the liquid staking token it issues',
    '0.1-0.5 ETH',
    'use the staking token once in a second venue it names, so your wallet shows both the stake and the composability',
  ],
  Bridge: [
    'bridge funds to a chain it serves and bridge a smaller amount back a few days later',
    '$200-$800 per crossing',
    'cross on three separate weeks and vary the route, since one return trip is what every farmer does and it shows',
  ],
  CDP: [
    'open a collateralised position: deposit collateral and mint a modest amount of its stablecoin',
    '$500-$1,500 of collateral',
    'hold the position for two weeks, adjust the collateral once, and repay in full before you close it',
  ],
  'Risk Curators': [
    'allocate into one of its curated vaults on the chain where it holds most of its TVL',
    '$500-$2,000',
    'stay through one reallocation cycle (usually a few weeks) and add a second, smaller deposit a week later',
  ],
  'Onchain Capital Allocator': [
    'deposit into its main allocation vault and keep the position through a full reporting period',
    '$500-$2,000',
    'make a second deposit in a later week rather than one lump, so the wallet ages with the vault',
  ],
  RWA: [
    'buy or deposit into its flagship real-world-asset product after finishing its onboarding or KYC step',
    '$250-$1,000',
    'hold through one full yield or coupon period; RWA products reward duration far more than transaction count',
  ],
  'Leveraged Farming': [
    'open a small leveraged position on its main pair at no more than 2-3x and monitor it daily',
    '$300-$1,000 of equity',
    'close and reopen once after a week; leveraged farms are capital-hungry, so size for the drawdown, not the APY',
  ],
};

const DEFAULT_ACTION: [string, string, string] = [
  'use its core product the way a normal user would, in its main market, and keep the position open',
  '$300-$1,500',
  'come back in a second and third week for one more real action each, so the wallet builds a history, not a spike',
];

/**
 * A farm plan for one protocol: five concrete steps with sizes, costs and durations, built from
 * the protocol's own category, chains and size. Every step is 20 to 600 characters, as the gate
 * requires, and no two protocols in different categories share a plan.
 */
export function farmSteps(p: SnapshotProtocol, scored: Scored): string[] {
  const chain = homeChain(p);
  const [action, size, follow] = CORE_ACTIONS[p.category ?? ''] ?? DEFAULT_ACTION;
  const gas = chain === 'Ethereum' ? '$5-$25 of ETH gas per transaction at quiet times' : `a few cents to $2 of gas per transaction on ${chain}`;
  const multi = p.chains.length > 1 ? ` It also runs on ${p.chains.slice(1, 3).join(' and ')}, where fees are usually lower.` : '';
  return [
    `Set up on ${chain}: fund a fresh wallet with the asset ${p.name} trades in plus gas money (${gas}), and bookmark its official app and docs before you deposit anything anywhere.${multi}`,
    `Put ${size} to work: ${action}. ${p.name} holds ${money(p.tvl_usd)} of TVL, so this size is a normal user's footprint, not a whale's and not dust.`,
    `Deepen it over the next two weeks: ${follow}. Spread the actions across at least three separate days; one-day bursts are the pattern sybil filters are built to catch.`,
    `Spend 20 minutes a week on the non-transaction signals: vote in any governance or gauge it runs, join its points or season page if it has one, and keep screenshots of your positions with dates.`,
    `Review monthly against this radar: it is ranked on an implied ${money(scored.implied)} launch value (${scored.tier} tier). Exit or cut size if its TVL falls for two straight months or a token is announced with no allocation for users.`,
  ];
}

/** The whole build: score, rank, and lay out the board plus the dashboard's data. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const peers = peerMultiples(snapshot);
  const watch = new Set(snapshot.watchlist);
  const derivative_count = snapshot.protocols.filter((p) => isPreToken(p) && isDerivative(p)).length;
  const scored = snapshot.protocols
    .filter((p) => isPreToken(p) && !isDerivative(p))
    .map((p) => scoreProtocol(p, peers, snapshot.as_of))
    .sort((a, b) => b.implied - a.implied || b.protocol.tvl_usd - a.protocol.tvl_usd || (a.protocol.slug < b.protocol.slug ? -1 : 1));

  const board: BoardRow[] = [];
  const rows: Radar['rows'] = [];
  scored.forEach((s, i) => {
    const steps = farmSteps(s.protocol, s);
    board.push({ slug: s.protocol.slug, name: s.protocol.name, rank: i + 1, implied_value_usd: s.implied, farm_steps: steps });
    rows.push({
      slug: s.protocol.slug,
      name: s.protocol.name,
      category: s.protocol.category,
      chains: s.protocol.chains,
      tvl_usd: s.protocol.tvl_usd,
      change_7d: s.protocol.change_7d,
      listed_at: s.protocol.listed_at,
      age_days: s.age_days,
      rank: i + 1,
      implied_value_usd: s.implied,
      value_per_tvl: s.implied / s.protocol.tvl_usd,
      multiple: s.multiple,
      growth_mult: s.growth_mult,
      maturity_mult: s.maturity_mult,
      reach_mult: s.reach_mult,
      tier: s.tier,
      watchlist: watch.has(s.protocol.slug),
      farm_steps: steps,
    });
  });

  const live = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0)
    .map((p) => ({ slug: p.slug, name: p.name, symbol: p.symbol, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd!, ratio: p.tvl_usd > 0 ? p.mcap_usd! / p.tvl_usd : 0 }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd);

  const category_multiples = [...peers.byCategory.entries()]
    .map(([category, v]) => ({ category, multiple: v.multiple, peers: v.peers }))
    .sort((a, b) => b.multiple - a.multiple);

  return {
    board,
    radar: {
      as_of: snapshot.as_of,
      floor_usd: snapshot.floor_usd,
      protocol_count: snapshot.protocols.length,
      pre_token_count: scored.length,
      derivative_count,
      live_count: live.length,
      watchlist_size: snapshot.watchlist.length,
      board_size: board.length,
      total_implied: board.reduce((sum, r) => sum + r.implied_value_usd, 0),
      global_multiple: peers.global,
      category_multiples,
      rows,
      live,
    },
  };
}

/** The gate's board rules, checked locally so a bad board never reaches the scorer. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100-4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  let allSame = true;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (!slugs.has(row.slug)) return `row ${i + 1}: slug ${row.slug} is not in the snapshot`;
    if (seen.has(row.slug)) return `row ${i + 1}: slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.rank !== i + 1) return `row ${i + 1}: rank is ${row.rank}, expected ${i + 1}`;
    if (!(row.implied_value_usd > 0)) return `row ${i + 1}: implied value is not positive`;
    if (row.implied_value_usd > previous) return `row ${i + 1}: implied value rises as rank ascends`;
    if (row.implied_value_usd !== board[0]!.implied_value_usd) allSame = false;
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${i + 1}: ${row.farm_steps.length} farm steps, outside 3-12`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${i + 1}: a farm step is ${len} characters, outside 20-600`;
    }
  }
  if (allSame) return 'every implied value is the same: the board ranks nothing';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  return null;
}

/** The dashboard's data as a script the page loads: the same figures the board carries. */
export function dataScript(radar: Radar): string {
  return `window.RADAR_DATA = ${JSON.stringify(radar)};\n`;
}
