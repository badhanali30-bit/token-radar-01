// Token Radar dashboard. Reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, filters, sort, and a per-protocol detail view.
// No network: every byte shown is in data.js. The detail view recomputes each
// row's implied value from the snapshot figures, so the page and board.json
// are visibly the same arithmetic (see impliedOf, below).
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;

  var state = { q: '', category: 'all', chain: 'all', sort: 'implied', dir: -1, tab: 'pre', selected: null };
  var boardEl = document.getElementById('board');
  var detailEl = document.getElementById('detail');
  var countEl = document.getElementById('count');

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + ' yrs';
    return Math.max(0, Math.round(days)) + ' days';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function chainsOf(p) {
    return p.chains && p.chains.length ? p.chains.slice(0, 2).join(', ') : 'an unnamed chain';
  }

  // The model in one function: the same formula lib/model.ts uses, recomputed here.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null ? model.unknown_age_days : row.age_days;
    var ageYears = Math.min(Math.max(age, 0), model.age_cap_days) / 365;
    var ageMult = 1 + model.age_weight * Math.log(1 + ageYears);
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * ageMult));
  }

  // The farm plan is the same derivation main.ts writes to board.json: the
  // plan travels inside data.js, so the detail view shows the exact steps
  // the board row carries, never a second copy.
  function farmStepsFor(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    return row && row.farm_steps ? row.farm_steps : [];
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('tab') === 'live') state.tab = 'live';
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.sort !== 'implied') params.set('sort', state.sort);
    if (state.tab === 'live') params.set('tab', 'live');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function sortButton(key, label) {
    var arrow = state.sort === key ? (state.dir < 0 ? ' ▼' : ' ▲') : '';
    return '<button type="button" data-sort="' + key + '">' + esc(label) + arrow + '</button>';
  }
  function growthCell(r) {
    if (r.change_7d === null) return '<td class="num">n/a</td>';
    return '<td class="num ' + (r.change_7d >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r.change_7d) + '</td>';
  }

  function renderBoard() {
    if (state.tab === 'live') {
      var live = DATA.live.slice().sort(function (a, b) { return (b.mcap_usd || 0) - (a.mcap_usd || 0); });
      var liveRows = live.map(function (r) {
        return '<tr><td class="num rank">—</td>' +
          '<td><div class="name"><b>' + esc(r.name) + '</b><span>' + esc(r.category || 'Other') + ' · ' + esc(chainsOf(r)) + '</span></div></td>' +
          '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' + growthCell(r) +
          '<td class="num">' + fmtUsd(r.mcap_usd) + '</td>' +
          '<td><span class="tag live">already trades</span></td></tr>';
      }).join('');
      boardEl.innerHTML = '<table><caption>Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.</caption>' +
        '<thead><tr><th>Rank</th><th>Protocol</th><th class="num">TVL</th><th class="num">7d</th><th class="num">Market cap</th><th>Token</th></tr></thead>' +
        '<tbody>' + liveRows + '</tbody></table>';
      countEl.textContent = live.length + ' live-token protocols, shown by market cap — not ranked as launch opportunities.';
      return;
    }
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      boardEl.innerHTML = '<div class="empty"><h2>No protocol matches that filter</h2>' +
        '<p>Clear the search or pick another category or chain to see the board again.</p>' +
        '<button type="button" id="clear-filters">Clear filters</button></div>';
      countEl.textContent = '0 rows shown.';
      var clear = document.getElementById('clear-filters');
      if (clear) clear.addEventListener('click', function () {
        state.q = ''; state.category = 'all'; state.chain = 'all';
        document.getElementById('q').value = '';
        document.getElementById('category').value = 'all';
        document.getElementById('chain').value = 'all';
        writeHash(); render();
      });
      return;
    }
    var max = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; })) || 1;
    var rowsHtml = list.map(function (r) {
      var pct = Math.max(3, Math.round((r.implied_value_usd / max) * 100));
      return '<tr data-slug="' + esc(r.slug) + '" tabindex="0" class="' + (state.selected === r.slug ? 'selected' : '') + '">' +
        '<td class="num rank">' + r.rank + '</td>' +
        '<td><div class="name"><b>' + esc(r.name) + '</b><span>' + esc(r.category || 'Other') + ' · ' + esc(chainsOf(r)) + '</span></div></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' + growthCell(r) +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td><div class="bar" aria-hidden="true"><i style="width:' + pct + '%"></i></div><span class="num">' + fmtUsd(r.implied_value_usd) + '</span></td>' +
        '<td><span class="tag">no token</span></td></tr>';
    }).join('');
    boardEl.innerHTML = '<table><caption>Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.</caption>' +
      '<thead><tr><th>Rank</th><th>' + sortButton('name', 'Protocol') + '</th>' +
      '<th class="num">' + sortButton('tvl', 'TVL') + '</th><th class="num">' + sortButton('growth', '7d') + '</th>' +
      '<th class="num">' + sortButton('age', 'Age') + '</th><th>' + sortButton('implied', 'Implied value') + '</th><th>Token</th></tr></thead>' +
      '<tbody>' + rowsHtml + '</tbody></table>';
    countEl.textContent = list.length + ' of ' + DATA.board_size + ' pre-token rows shown · ' +
      DATA.watchlist_size + ' watchlist protocols covered · snapshot ' + DATA.as_of;
  }

  function renderDetail() {
    if (!state.selected || state.tab === 'live') { detailEl.hidden = true; detailEl.innerHTML = ''; return; }
    var row = DATA.rows.filter(function (r) { return r.slug === state.selected; })[0];
    if (!row) { detailEl.hidden = true; detailEl.innerHTML = ''; return; }
    var chainList = (row.chains || []).slice(0, 4).join(', ') || 'an unnamed chain';
    if ((row.chains || []).length > 4) chainList += ' and ' + ((row.chains || []).length - 4) + ' more';
    var recomputed = impliedOf(row, DATA.model);
    var match = recomputed === row.implied_value_usd;
    var steps = farmStepsFor(row.slug);
    var stepsHtml = steps.map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return '<li><b>' + esc(action) + '</b><span class="cost">' + esc(tail) + '</span></li>';
    }).join('');
    detailEl.innerHTML =
      '<div class="detail-head"><div><p>Rank ' + row.rank + ' of ' + DATA.board_size + ' · ' + esc(row.category || 'Other') + ' · ' + esc(chainList) + '</p>' +
      '<h2>' + esc(row.name) + '</h2><p>First listed ' + esc(row.listed_at || 'unknown') + ' · ' + fmtAge(row.age_days) + ' with no token on record.</p></div>' +
      '<button type="button" class="close" id="detail-close">Close</button></div>' +
      '<h3>Implied value — the model, step by step</h3>' +
      '<dl class="grid">' +
      '<div><dt>TVL</dt><dd>' + fmtUsd(row.tvl_usd) + '</dd></div>' +
      '<div><dt>Seven-day growth</dt><dd>' + fmtPct(row.change_7d) + '</dd></div>' +
      '<div><dt>Age with no token</dt><dd>' + fmtAge(row.age_days) + '</dd></div>' +
      '<div><dt>Growth multiplier</dt><dd>' + row.growth_multiplier + '</dd></div>' +
      '<div><dt>Age multiplier</dt><dd>' + row.age_multiplier + '</dd></div>' +
      '<div><dt>Implied value</dt><dd>' + fmtUsd(row.implied_value_usd) + '</dd></div></dl>' +
      '<p>Recomputed in this page from the snapshot figures: <b>' + fmtUsd(recomputed) + '</b> — ' +
      (match ? '<span class="check">matches the board exactly.</span>' : '<span class="check">differs from the board; the data would be stale.</span>') +
      ' This is an estimate, not a price.</p>' +
      '<h3>Farm plan — seven steps</h3><ol class="steps">' + stepsHtml + '</ol>';
    detailEl.hidden = false;
    document.getElementById('detail-close').addEventListener('click', function () {
      state.selected = null; writeHash(); render();
    });
    detailEl.scrollIntoView({ block: 'nearest' });
  }

  function fillSelects() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    document.getElementById('category').innerHTML = '<option value="all">All categories</option>' +
      cats.map(function (c) { return '<option value="' + esc(c) + '"' + (c === state.category ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
    document.getElementById('chain').innerHTML = '<option value="all">All chains</option>' +
      chains.map(function (c) { return '<option value="' + esc(c) + '"' + (c === state.chain ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
  }

  function render() {
    document.getElementById('tab-pre').setAttribute('aria-selected', state.tab === 'pre' ? 'true' : 'false');
    document.getElementById('tab-live').setAttribute('aria-selected', state.tab === 'live' ? 'true' : 'false');
    renderBoard();
    renderDetail();
  }

  function init() {
    readHash();
    var top = DATA.rows[0];
    document.getElementById('mast-stats').innerHTML =
      '<div><dt>Watchlist covered</dt><dd>' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</dd></div>' +
      '<div><dt>Pre-token rows</dt><dd>' + DATA.board_size + '</dd></div>' +
      '<div><dt>Top implied value</dt><dd>' + fmtUsd(top ? top.implied_value_usd : 0) + '</dd></div>' +
      '<div><dt>Live tokens set aside</dt><dd>' + DATA.live_size + '</dd></div>';
    var m = DATA.model;
    document.getElementById('model-formula').textContent =
      'implied = round( tvl_usd × ' + m.base_multiple + ' × (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') ÷ 100 × ' + m.growth_weight + ') × (1 + ' + m.age_weight + ' × ln(1 + min(age_days, ' + m.age_cap_days + ') ÷ 365)) )';
    document.getElementById('source').textContent = DATA.source;
    document.getElementById('asof').textContent = DATA.as_of;
    fillSelects();
    var q = document.getElementById('q');
    q.value = state.q;
    document.getElementById('sort').value = state.sort;
    q.addEventListener('input', function () { state.q = q.value; writeHash(); render(); });
    document.getElementById('category').addEventListener('change', function (e) { state.category = e.target.value; writeHash(); render(); });
    document.getElementById('chain').addEventListener('change', function (e) { state.chain = e.target.value; writeHash(); render(); });
    document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; writeHash(); render(); });
    document.getElementById('tab-pre').addEventListener('click', function () { state.tab = 'pre'; writeHash(); render(); });
    document.getElementById('tab-live').addEventListener('click', function () { state.tab = 'live'; state.selected = null; writeHash(); render(); });
    boardEl.addEventListener('click', function (e) {
      var sortBtn = e.target.closest('[data-sort]');
      if (sortBtn) {
        var key = sortBtn.getAttribute('data-sort');
        if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; }
        document.getElementById('sort').value = state.sort;
        writeHash(); render(); return;
      }
      var tr = e.target.closest('tr[data-slug]');
      if (tr) { state.selected = tr.getAttribute('data-slug'); writeHash(); render(); }
    });
    boardEl.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-slug]')) {
        e.preventDefault(); state.selected = e.target.getAttribute('data-slug'); writeHash(); render();
      }
    });
    render();
  }

  init();
})();
