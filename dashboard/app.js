// Launch Multiple Radar — the board's behaviour. Everything renders from window.RADAR_DATA,
// which main.ts wrote from the same figures as board.json: the page and the board cannot disagree.
'use strict';

const D = window.RADAR_DATA;
const state = { q: '', category: '', chain: '', tier: '', watchlist: false, sort: 'rank', dir: 1 };

const $ = (id) => document.getElementById(id);

function money(usd) {
  if (usd >= 1e9) return '$' + (usd / 1e9).toFixed(2) + 'B';
  if (usd >= 1e6) return '$' + (usd / 1e6).toFixed(1) + 'M';
  if (usd >= 1e3) return '$' + (usd / 1e3).toFixed(0) + 'K';
  return '$' + usd;
}
function pct(v) {
  if (v === null || v === undefined) return '<span class="slug">n/a</span>';
  const cls = v > 0 ? 'pos' : v < 0 ? 'neg' : '';
  return '<span class="' + cls + '">' + (v > 0 ? '+' : '') + v.toFixed(1) + '%</span>';
}
function ageText(days) {
  if (days === null || days === undefined) return 'untracked';
  if (days < 365) return Math.round(days / 30.4) + ' mo';
  return (days / 365).toFixed(1) + ' yr';
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderStats() {
  $('asof').innerHTML = 'Snapshot as of ' + esc(D.as_of) + '<br>sealed DefiLlama data · no live prices';
  const top = D.rows[0];
  $('stats').innerHTML = [
    [D.protocol_count, 'protocols scanned'],
    [D.pre_token_count, 'record no token'],
    [D.watchlist_size, 'on the watchlist'],
    [money(D.total_implied), 'total implied value'],
    [top ? esc(top.name) + ' · ' + money(top.implied_value_usd) : '—', 'top of the board'],
  ].map(([v, k]) => '<div class="stat"><div class="v">' + v + '</div><div class="k">' + k + '</div></div>').join('');
  $('multiples').innerHTML =
    '<span class="mult">Set aside: <b>' + D.live_count + '</b> already trading · <b>' + D.derivative_count + '</b> products of trading tokens</span>' +
    '<span class="mult">All categories <b>' + D.global_multiple.toFixed(2) + '×</b></span>' +
    D.category_multiples.slice(0, 14)
      .map((c) => '<span class="mult">' + esc(c.category) + ' <b>' + c.multiple.toFixed(2) + '×</b> · ' + c.peers + ' peers</span>')
      .join('');
}

function fillControls() {
  const cats = [...new Set(D.rows.map((r) => r.category).filter(Boolean))].sort();
  $('category').innerHTML = '<option value="">All categories</option>' + cats.map((c) => '<option>' + esc(c) + '</option>').join('');
  const chains = [...new Set(D.rows.flatMap((r) => r.chains))].sort();
  $('chain').innerHTML = '<option value="">All chains</option>' + chains.map((c) => '<option>' + esc(c) + '</option>').join('');
}

function visibleRows() {
  let rows = D.rows.filter((r) =>
    (!state.q || r.name.toLowerCase().includes(state.q) || r.slug.includes(state.q)) &&
    (!state.category || r.category === state.category) &&
    (!state.chain || r.chains.includes(state.chain)) &&
    (!state.tier || r.tier === state.tier) &&
    (!state.watchlist || r.watchlist));
  const key = state.sort;
  rows = [...rows].sort((a, b) => {
    const av = a[key], bv = b[key];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    return (typeof av === 'string' ? av.localeCompare(bv) : av - bv) * state.dir;
  });
  return rows;
}

function renderBoard() {
  const rows = visibleRows();
  $('count').textContent = rows.length + ' of ' + D.rows.length + ' protocols';
  $('rows').innerHTML = rows.map((r) =>
    '<tr data-slug="' + esc(r.slug) + '" class="' + (r.rank <= 3 ? 'top' + r.rank : '') + '">' +
    '<td class="num rank">' + r.rank + '</td>' +
    '<td><span class="name">' + esc(r.name) + '</span>' + (r.watchlist ? '<span class="wl">WATCHLIST</span>' : '') +
      '<br><span class="slug">' + esc(r.slug) + ' · ' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</span></td>' +
    '<td>' + esc(r.category || '—') + '</td>' +
    '<td class="num">' + money(r.tvl_usd) + '</td>' +
    '<td class="num">' + pct(r.change_7d) + '</td>' +
    '<td class="num">' + ageText(r.age_days) + '</td>' +
    '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
    '<td class="num">' + r.value_per_tvl.toFixed(2) + '×</td>' +
    '<td><span class="tier ' + r.tier + '">' + r.tier + '</span></td></tr>'
  ).join('');
  document.querySelectorAll('th[data-sort]').forEach((th) => {
    th.classList.toggle('sorted', th.dataset.sort === state.sort);
  });
}

function renderLive() {
  $('live-rows').innerHTML = D.live.slice(0, 30).map((p) =>
    '<tr><td><span class="name">' + esc(p.name) + '</span></td><td>' + esc(p.symbol || '—') + '</td>' +
    '<td>' + esc(p.category || '—') + '</td><td class="num">' + money(p.tvl_usd) + '</td>' +
    '<td class="num">' + money(p.mcap_usd) + '</td><td class="num">' + p.ratio.toFixed(2) + '×</td></tr>'
  ).join('');
}

function bindControls() {
  $('q').addEventListener('input', (e) => { state.q = e.target.value.trim().toLowerCase(); renderBoard(); });
  $('category').addEventListener('change', (e) => { state.category = e.target.value; renderBoard(); });
  $('chain').addEventListener('change', (e) => { state.chain = e.target.value; renderBoard(); });
  $('tier').addEventListener('change', (e) => { state.tier = e.target.value; renderBoard(); });
  $('watchlist').addEventListener('change', (e) => { state.watchlist = e.target.checked; renderBoard(); });
  document.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.sort === key) state.dir *= -1;
      else { state.sort = key; state.dir = key === 'name' || key === 'category' ? 1 : -1; }
      renderBoard();
    });
  });
  $('rows').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-slug]');
    if (tr) location.hash = 'detail=' + tr.dataset.slug;
  });
}

function partRow(label, mult, note, widthPct) {
  return '<div class="part"><div class="lbl"><span>' + label + '</span><b>×' + mult.toFixed(2) + '</b></div>' +
    '<div class="bar"><div class="fill" style="width:' + Math.max(3, Math.min(100, widthPct)) + '%"></div></div>' +
    '<div class="slug">' + note + '</div></div>';
}

function showDetail(slug) {
  const r = D.rows.find((x) => x.slug === slug);
  if (!r) { showBoard(); return; }
  $('board-view').hidden = true;
  const v = $('detail-view');
  v.hidden = false;
  const cat = D.category_multiples.find((c) => c.category === r.category);
  v.innerHTML =
    '<button class="back" id="back">← Back to the board</button>' +
    '<h2>' + esc(r.name) + (r.watchlist ? '<span class="wl">WATCHLIST</span>' : '') + '</h2>' +
    '<div class="slug">' + esc(r.slug) + ' · ' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ')) +
      ' · ranked #' + r.rank + ' of ' + D.rows.length + ' pre-token protocols</div>' +
    '<div class="detail-grid"><div>' +
      '<h3>The figures</h3>' +
      '<div class="kv"><span>TVL (snapshot)</span><b>' + money(r.tvl_usd) + '</b></div>' +
      '<div class="kv"><span>TVL change, 7 days</span><b>' + (r.change_7d === null ? 'unreported' : r.change_7d.toFixed(1) + '%') + '</b></div>' +
      '<div class="kv"><span>Tracked since</span><b>' + (r.listed_at || 'untracked') + (r.age_days !== null ? ' (' + ageText(r.age_days) + ')' : '') + '</b></div>' +
      '<div class="kv"><span>Chains</span><b>' + r.chains.length + '</b></div>' +
      '<div class="kv"><span>Tier</span><b>' + r.tier + '</b></div>' +
      '<h3 style="margin-top:18px">The price, in parts</h3>' +
      '<div class="implied-big">' + money(r.implied_value_usd) + '</div>' +
      '<div class="slug">implied launch value · ' + r.value_per_tvl.toFixed(2) + '× its TVL</div>' +
      partRow('Peer multiple — ' + esc(r.category || 'all categories'), r.multiple,
        cat ? 'median of ' + cat.peers + ' launched peers in this category' : 'the all-category median; too few priced peers', r.multiple / 3 * 100) +
      partRow('Growth', r.growth_mult, 'seven-day TVL change, clamped and weighted', (r.growth_mult - 0.7) / 0.8 * 100) +
      partRow('Maturity', r.maturity_mult, 'years tracked with no token, capped at four', (r.maturity_mult - 0.7) / 0.5 * 100) +
      partRow('Reach', r.reach_mult, 'one step per extra chain, capped at three', (r.reach_mult - 1) / 0.12 * 100) +
    '</div><div>' +
      '<h3>The farm plan</h3>' +
      '<ol class="steps">' + r.farm_steps.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>' +
    '</div></div>';
  $('back').addEventListener('click', () => { location.hash = ''; });
  window.scrollTo(0, 0);
}

function showBoard() {
  $('detail-view').hidden = true;
  $('board-view').hidden = false;
}

function applyHash() {
  const h = location.hash.replace(/^#/, '');
  const params = new URLSearchParams(h);
  if (params.has('detail')) { showDetail(params.get('detail')); return; }
  if (params.has('category')) { state.category = params.get('category'); $('category').value = state.category; }
  if (params.has('watchlist')) { state.watchlist = params.get('watchlist') === '1'; $('watchlist').checked = state.watchlist; }
  if (params.has('tier')) { state.tier = params.get('tier'); $('tier').value = state.tier; }
  showBoard();
  renderBoard();
}

renderStats();
fillControls();
renderLive();
bindControls();
applyHash();
window.addEventListener('hashchange', applyHash);
