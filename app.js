/* =========================================================
   Quantara – AI Stock Portfolio
   app.js — Main application logic
   ========================================================= */

'use strict';

// ── Constants ────────────────────────────────────────────────────────────────
const FINNHUB_BASE    = 'https://finnhub.io/api/v1';
const FINNHUB_DEFAULT = 'd6ep8bhr01qksaq9dcb0d6ep8bhr01qksaq9dcbg';
const STORAGE_KEY     = 'quantara_portfolio_v2';
const API_KEY_STORE   = 'quantara_fh_key';

const PALETTE = [
  '#4f9eff','#a855f7','#22d3ee','#34d399','#fb923c',
  '#f472b6','#facc15','#60a5fa','#818cf8','#2dd4bf'
];

const NAMES = {
  AAPL:'Apple Inc.', MSFT:'Microsoft', GOOGL:'Alphabet', AMZN:'Amazon',
  TSLA:'Tesla', NVDA:'NVIDIA', META:'Meta Platforms', JPM:'JPMorgan Chase',
  V:'Visa', WMT:'Walmart', JNJ:'Johnson & Johnson', XOM:'ExxonMobil',
  BRK_B:'Berkshire Hathaway', UNH:'UnitedHealth', MA:'Mastercard',
  PG:'Procter & Gamble', HD:'Home Depot', CVX:'Chevron', LLY:'Eli Lilly',
  ABBV:'AbbVie', MRK:'Merck', PEP:'PepsiCo', KO:'Coca-Cola', COST:'Costco',
  AVGO:'Broadcom', MCD:'McDonald\'s', DIS:'Disney', NFLX:'Netflix',
  ADBE:'Adobe', CRM:'Salesforce', INTC:'Intel', AMD:'AMD', QCOM:'Qualcomm',
  PYPL:'PayPal', SQ:'Block (Square)', SHOP:'Shopify', SNOW:'Snowflake',
  PLTR:'Palantir', COIN:'Coinbase', RBLX:'Roblox', HOOD:'Robinhood',
  SPY:'S&P 500 ETF', QQQ:'Nasdaq 100 ETF', GLD:'Gold ETF', TLT:'20yr Bond ETF',
};

// ── State ─────────────────────────────────────────────────────────────────────
let portfolio  = [];
let apiKey     = '';
let demoMode   = false;
let donutChart = null;
let perfChart  = null;
let miniSparklineChart = null;

// Detail modal state
let detailTicker = null;
let detailChart  = null;

// Candle cache: ticker -> { timestamps: [], closes: [], fetchedAt }
const candleCache = new Map();
const CACHE_TTL   = 5 * 60 * 1000; // 5 min

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  apiKey   = localStorage.getItem(API_KEY_STORE) || FINNHUB_DEFAULT;
  demoMode = false;
  localStorage.setItem(API_KEY_STORE, apiKey);

  loadPortfolio();
  updateApiIndicator();
  setMarketStatus();

  document.getElementById('api-modal').classList.add('hidden');

  if (portfolio.length > 0) refreshAll();
  else seedDefaultPortfolio();

  renderAll();
  setupAutocomplete();

  setInterval(() => { if (!demoMode && apiKey) refreshAll(); }, 60000);
});

// ── Persistence ───────────────────────────────────────────────────────────────
function loadPortfolio() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) portfolio = JSON.parse(raw);
  } catch { portfolio = []; }
}

function savePortfolio() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(portfolio));
}

// ── API Key Modal ─────────────────────────────────────────────────────────────
function saveApiKey() {
  const val = document.getElementById('api-key-input').value.trim();
  if (!val) { shake(document.getElementById('api-key-input')); return; }
  apiKey   = val;
  demoMode = false;
  localStorage.setItem(API_KEY_STORE, apiKey);
  document.getElementById('api-modal').classList.add('hidden');
  updateApiIndicator();
  candleCache.clear();
  if (portfolio.length === 0) seedDefaultPortfolio();
  else refreshAll();
}

function useDemoMode() {
  demoMode = true;
  apiKey   = '';
  document.getElementById('api-modal').classList.add('hidden');
  updateApiIndicator();
  if (portfolio.length === 0) seedDefaultPortfolio();
  else injectDemoPrices();
}

function openApiModal() {
  document.getElementById('api-key-input').value = apiKey;
  document.getElementById('api-modal').classList.remove('hidden');
}

function updateApiIndicator() {
  const dot   = document.getElementById('api-dot');
  const label = document.getElementById('api-label');
  if (apiKey) {
    dot.className     = 'dot api-connected';
    label.textContent = 'Live · Finnhub';
  } else {
    dot.className     = 'dot api-demo';
    label.textContent = 'Demo';
  }
}

// ── Default Portfolio Seed ────────────────────────────────────────────────────
function seedDefaultPortfolio() {
  portfolio = [
    { ticker:'AAPL',  shares:15,  cost:148.50 },
    { ticker:'MSFT',  shares:8,   cost:310.00 },
    { ticker:'NVDA',  shares:5,   cost:420.00 },
    { ticker:'TSLA',  shares:10,  cost:195.00 },
    { ticker:'GOOGL', shares:3,   cost:130.00 },
  ];
  savePortfolio();
  if (demoMode) injectDemoPrices();
  else if (apiKey) refreshAll();
  else renderAll();
}

// ── Demo Prices ───────────────────────────────────────────────────────────────
const DEMO_PRICES = {
  AAPL:182.63,  MSFT:415.20, NVDA:875.40, TSLA:175.22, GOOGL:172.80,
  AMZN:188.40,  META:505.10, JPM:195.30,  V:278.50,    WMT:63.40,
  NFLX:620.00,  DIS:111.30,  ADBE:485.60, CRM:298.70,  AMD:163.80,
  INTC:30.20,   COIN:198.40, PLTR:24.50,  RBLX:42.10,  SNOW:158.20,
  SPY:522.00,   QQQ:448.00,  GLD:183.00,  JNJ:152.40,  KO:61.80,
};

function getDemoPrice(ticker) {
  const base     = DEMO_PRICES[ticker] || (50 + Math.random() * 450);
  const pct      = (Math.random() - 0.45) * 0.04;
  const price    = +(base * (1 + pct)).toFixed(2);
  const prev     = +(base).toFixed(2);
  return { price, prevClose: prev, change: +(price - prev).toFixed(2), changePct: +(pct * 100).toFixed(2) };
}

function injectDemoPrices() {
  portfolio.forEach(s => {
    Object.assign(s, getDemoPrice(s.ticker));
    s.name = NAMES[s.ticker] || s.ticker;
  });
  savePortfolio();
  renderAll();
  updateLastUpdated();
  generateAiInsight();
}

// ── Finnhub API ───────────────────────────────────────────────────────────────
async function fetchQuote(ticker) {
  const url = `${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const q = await res.json();
  if (!q || !q.c || q.c === 0) throw new Error('No data for ' + ticker);
  return {
    price:     +q.c.toFixed(2),
    prevClose: +q.pc.toFixed(2),
    change:    +q.d.toFixed(2),
    changePct: +q.dp.toFixed(2),
  };
}

async function fetchCandles(ticker, resolution, from, to) {
  const url = `${FINNHUB_BASE}/stock/candle?symbol=${encodeURIComponent(ticker)}&resolution=${resolution}&from=${from}&to=${to}&token=${apiKey}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.s !== 'ok' || !data.c || data.c.length === 0) throw new Error('No candle data');
  return data; // { c, h, l, o, t, v }
}

async function fetchSearch(q) {
  const url = `${FINNHUB_BASE}/search?q=${encodeURIComponent(q)}&token=${apiKey}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchMetrics(ticker) {
  const url = `${FINNHUB_BASE}/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all&token=${apiKey}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchNews(ticker) {
  const toDate   = new Date().toISOString().split('T')[0];
  const fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const url = `${FINNHUB_BASE}/company-news?symbol=${encodeURIComponent(ticker)}&from=${fromDate}&to=${toDate}&token=${apiKey}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Candle helpers ────────────────────────────────────────────────────────────
function todayRange() {
  const now = new Date();
  const ny  = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const d   = ny.getDay();
  const marketDay = new Date(ny);
  if (d === 0) marketDay.setDate(marketDay.getDate() - 2);
  else if (d === 6) marketDay.setDate(marketDay.getDate() - 1);

  const open = new Date(marketDay);
  open.setHours(9, 30, 0, 0);
  return {
    from: Math.floor(open.getTime() / 1000),
    to:   Math.floor(Date.now() / 1000),
  };
}

function rangeParams(range) {
  const to  = Math.floor(Date.now() / 1000);
  const day = 86400;
  switch (range) {
    case 'D':  return { resolution: '5',  from: to - day,      to };
    case 'W':  return { resolution: '30', from: to - 7 * day,  to };
    case 'M':  return { resolution: 'D',  from: to - 30 * day, to };
    case '3M': return { resolution: 'D',  from: to - 90 * day, to };
    default:   return { resolution: 'D',  from: to - 30 * day, to };
  }
}

// Fetch intraday candles for a stock card's sparkline (with caching)
async function refreshSparklineForCard(ticker) {
  const cached = candleCache.get(ticker);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    applySparklineData(ticker, cached.closes);
    return;
  }
  try {
    const { from, to } = todayRange();
    const data = await fetchCandles(ticker, '5', from, to);
    candleCache.set(ticker, { closes: data.c, fetchedAt: Date.now() });
    applySparklineData(ticker, data.c);
  } catch { /* keep simulated sparkline */ }
}

function applySparklineData(ticker, closes) {
  const canvas = document.getElementById(`spark-${ticker}`);
  if (!canvas) return;
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
  const up = closes[closes.length - 1] >= closes[0];
  drawSparklineFromData(`spark-${ticker}`, closes, up ? '#34d399' : '#f87171');
}

// ── Refresh All ───────────────────────────────────────────────────────────────
async function refreshAll() {
  if (portfolio.length === 0) return;

  if (demoMode) { injectDemoPrices(); return; }
  if (!apiKey)  { openApiModal(); return; }

  setRefreshSpinner(true);

  const results = await Promise.allSettled(
    portfolio.map(async s => {
      const q = await fetchQuote(s.ticker);
      s.price     = q.price;
      s.prevClose = q.prevClose;
      s.change    = q.change;
      s.changePct = q.changePct;
      s.name      = NAMES[s.ticker] || s.ticker;
    })
  );

  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed === results.length) {
    console.warn('All quote calls failed — using demo prices.');
    injectDemoPrices();
    return;
  }

  setRefreshSpinner(false);
  savePortfolio();
  renderAll();
  updateLastUpdated();
  generateAiInsight();

  // Fetch real intraday candles for sparklines (fire-and-forget)
  portfolio.forEach(s => refreshSparklineForCard(s.ticker));
}

function setRefreshSpinner(on) {
  const btn = document.querySelector('.btn-icon');
  if (btn) btn.classList.toggle('spinning', on);
}

// ── Add / Remove ──────────────────────────────────────────────────────────────
function openAddModal() {
  document.getElementById('add-stock-modal').classList.remove('hidden');
  document.getElementById('new-ticker').focus();
}

function closeAddModal() {
  document.getElementById('add-stock-modal').classList.add('hidden');
  document.getElementById('ticker-dropdown').classList.add('hidden');
  ['new-ticker','new-shares','new-cost'].forEach(id => document.getElementById(id).value = '');
}

async function addStock() {
  const ticker = document.getElementById('new-ticker').value.trim().toUpperCase();
  const shares = parseFloat(document.getElementById('new-shares').value);
  const cost   = parseFloat(document.getElementById('new-cost').value);

  if (!ticker || isNaN(shares) || shares <= 0 || isNaN(cost) || cost < 0) {
    ['new-ticker','new-shares','new-cost'].forEach(id => shake(document.getElementById(id)));
    return;
  }

  if (portfolio.find(s => s.ticker === ticker)) {
    shake(document.getElementById('new-ticker'));
    return;
  }

  const entry = { ticker, shares, cost, name: NAMES[ticker] || ticker };

  if (demoMode) {
    Object.assign(entry, getDemoPrice(ticker));
  } else if (apiKey) {
    try {
      Object.assign(entry, await fetchQuote(ticker));
    } catch {
      Object.assign(entry, getDemoPrice(ticker));
    }
  }

  portfolio.push(entry);
  savePortfolio();
  closeAddModal();
  renderAll();
  generateAiInsight();

  // Fetch sparkline candles for the new card
  if (!demoMode && apiKey) refreshSparklineForCard(ticker);
}

function removeStock(ticker) {
  portfolio = portfolio.filter(s => s.ticker !== ticker);
  candleCache.delete(ticker);
  savePortfolio();
  renderAll();
  generateAiInsight();
}

// ── Ticker Autocomplete ───────────────────────────────────────────────────────
let searchTimeout = null;

function setupAutocomplete() {
  const input    = document.getElementById('new-ticker');
  const dropdown = document.getElementById('ticker-dropdown');

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(searchTimeout);
    if (q.length < 1) { dropdown.classList.add('hidden'); return; }

    searchTimeout = setTimeout(async () => {
      try {
        const data    = await fetchSearch(q);
        const results = (data.result || [])
          .filter(r => r.type === 'Common Stock' || r.type === 'ETP')
          .slice(0, 7);

        if (results.length === 0) { dropdown.classList.add('hidden'); return; }

        dropdown.innerHTML = results.map(r => `
          <div class="autocomplete-item" data-symbol="${r.symbol}" data-desc="${escHtml(r.description.slice(0,50))}">
            <span class="ac-symbol">${r.symbol}</span>
            <span class="ac-desc">${escHtml(r.description.slice(0,50))}</span>
          </div>
        `).join('');
        dropdown.classList.remove('hidden');
      } catch { dropdown.classList.add('hidden'); }
    }, 280);
  });

  dropdown.addEventListener('click', e => {
    const item = e.target.closest('.autocomplete-item');
    if (!item) return;
    selectTicker(item.dataset.symbol, item.dataset.desc);
  });

  // Close on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('.ticker-autocomplete-wrap')) {
      dropdown.classList.add('hidden');
    }
  });
}

function selectTicker(symbol, name) {
  document.getElementById('new-ticker').value = symbol;
  document.getElementById('ticker-dropdown').classList.add('hidden');
  if (!NAMES[symbol]) NAMES[symbol] = name;
  document.getElementById('new-shares').focus();
}

// ── Sorting ───────────────────────────────────────────────────────────────────
function sortHoldings() {
  const by = document.getElementById('sort-select').value;
  portfolio.sort((a, b) => {
    switch (by) {
      case 'value':    return stockValue(b) - stockValue(a);
      case 'gain_pct': return (b.changePct||0) - (a.changePct||0);
      case 'price':    return (b.price||0)     - (a.price||0);
      case 'name':     return a.ticker.localeCompare(b.ticker);
      default: return 0;
    }
  });
  renderHoldings();
}

// ── Computed helpers ──────────────────────────────────────────────────────────
function stockValue(s)   { return (s.price || s.cost || 0) * s.shares; }
function stockCost(s)    { return s.cost * s.shares; }
function stockGain(s)    { return stockValue(s) - stockCost(s); }
function stockGainPct(s) { const c = stockCost(s); return c ? (stockGain(s)/c)*100 : 0; }
function totalValue()    { return portfolio.reduce((t,s) => t + stockValue(s), 0); }
function totalCost()     { return portfolio.reduce((t,s) => t + stockCost(s), 0); }
function totalDayGain()  { return portfolio.reduce((t,s) => t + (s.change||0)*s.shares, 0); }

function fmt(n, dp=2)  { return n.toLocaleString('en-US', { minimumFractionDigits:dp, maximumFractionDigits:dp }); }
function fmtUSD(n)     { return (n < 0 ? '-$' : '$') + fmt(Math.abs(n)); }
function fmtPct(n)     { return (n >= 0 ? '+' : '') + fmt(n) + '%'; }
function signClass(n)  { return n > 0 ? 'pos' : n < 0 ? 'neg' : 'neu'; }
function badgeClass(n) { return n > 0 ? 'up'  : n < 0 ? 'down' : 'flat'; }

function fmtBig(n) {
  if (n >= 1e12) return '$' + (n/1e12).toFixed(2) + 'T';
  if (n >= 1e9)  return '$' + (n/1e9).toFixed(2)  + 'B';
  if (n >= 1e6)  return '$' + (n/1e6).toFixed(2)  + 'M';
  return '$' + fmt(n);
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderAll() {
  renderSummary();
  renderHoldings();
  renderCharts();
}

function renderSummary() {
  const tv   = totalValue();
  const tc   = totalCost();
  const gain = tv - tc;
  const pct  = tc ? (gain/tc)*100 : 0;
  const dg   = totalDayGain();

  const tvEl = document.getElementById('total-value');
  tvEl.textContent = fmtUSD(tv);
  tvEl.className   = 'hero-value ' + (gain >= 0 ? 'up' : 'down');

  const badge = document.getElementById('total-change-badge');
  badge.textContent = fmtPct(pct);
  badge.className   = 'change-badge ' + badgeClass(gain);

  document.getElementById('total-change-dollar').textContent = fmtUSD(gain) + ' all time';
  document.getElementById('day-gain').innerHTML   = `<span class="${signClass(dg)}">${fmtUSD(dg)}</span>`;
  document.getElementById('total-invested').textContent = fmtUSD(tc);
  document.getElementById('positions-count').textContent = portfolio.length;

  const best = portfolio.reduce((b,s) => (!b || stockGainPct(s) > stockGainPct(b) ? s : b), null);
  document.getElementById('best-performer').innerHTML = best
    ? `<span>${best.ticker}</span> <span class="pos">${fmtPct(stockGainPct(best))}</span>`
    : '—';

  renderMiniSparkline();
}

function renderHoldings() {
  const grid  = document.getElementById('holdings-grid');
  const empty = document.getElementById('empty-state');
  const tv    = totalValue();

  if (portfolio.length === 0) {
    empty.style.display = 'flex';
    [...grid.querySelectorAll('.stock-card')].forEach(el => el.remove());
    return;
  }

  empty.style.display = 'none';
  [...grid.querySelectorAll('.stock-card')].forEach(el => el.remove());

  portfolio.forEach((s, i) => {
    const card = buildStockCard(s, tv, i);
    grid.appendChild(card);
  });
}

function buildStockCard(s, totalVal, colorIdx) {
  const val      = stockValue(s);
  const gain     = stockGain(s);
  const gainPct  = stockGainPct(s);
  const allocPct = totalVal ? (val / totalVal) * 100 : 0;
  const color    = PALETTE[colorIdx % PALETTE.length];

  const card = document.createElement('div');
  card.className      = 'stock-card glass-card';
  card.dataset.ticker = s.ticker;
  card.style.cursor   = 'pointer';

  card.innerHTML = `
    <div class="stock-card-header">
      <div style="display:flex;align-items:center;gap:10px">
        <div class="stock-logo" style="background:${color}1a;border-color:${color}33;color:${color}">${s.ticker.slice(0,2)}</div>
        <div>
          <div class="stock-ticker">${s.ticker}</div>
          <div class="stock-name">${s.name || s.ticker}</div>
        </div>
      </div>
      <div class="stock-price-block">
        <div class="stock-price ${s.price ? '' : 'loading'}">${s.price ? '$'+fmt(s.price) : '$—'}</div>
        <div class="stock-day-change ${signClass(s.changePct)}">
          ${s.changePct != null ? fmtPct(s.changePct) + ' today' : ''}
        </div>
      </div>
    </div>

    <div class="stock-sparkline">
      <canvas id="spark-${s.ticker}"></canvas>
    </div>

    <div class="stock-stats">
      <div>
        <div class="stock-stat-label">Position Value</div>
        <div class="stock-stat-value">${fmtUSD(val)}</div>
      </div>
      <div>
        <div class="stock-stat-label">Shares</div>
        <div class="stock-stat-value">${fmt(s.shares, 4)}</div>
      </div>
      <div>
        <div class="stock-stat-label">Avg Cost</div>
        <div class="stock-stat-value">$${fmt(s.cost)}</div>
      </div>
      <div>
        <div class="stock-stat-label">Total Gain</div>
        <div class="stock-stat-value ${signClass(gain)}">${fmtUSD(gain)} (${fmtPct(gainPct)})</div>
      </div>
    </div>

    <div class="stock-divider"></div>

    <div class="stock-card-footer">
      <div class="allocation-bar-wrap">
        <div class="allocation-bar-label">Portfolio Allocation</div>
        <div class="allocation-bar-bg">
          <div class="allocation-bar-fill" style="width:${allocPct.toFixed(1)}%;background:linear-gradient(90deg,${color},${color}99)"></div>
        </div>
      </div>
      <span style="font-size:0.72rem;color:var(--text-muted);margin-right:10px">${allocPct.toFixed(1)}%</span>
      <button class="btn-remove js-remove" data-ticker="${s.ticker}">✕ Remove</button>
    </div>

    <div class="card-detail-hint">Tap for details →</div>
  `;

  // Click → detail modal (ignore remove button)
  card.addEventListener('click', e => {
    if (e.target.closest('.js-remove')) return;
    openDetailModal(s.ticker);
  });

  // Remove button
  card.querySelector('.js-remove').addEventListener('click', e => {
    e.stopPropagation();
    removeStock(s.ticker);
  });

  // Draw simulated sparkline immediately; real candle data arrives async
  requestAnimationFrame(() => drawSparkline(`spark-${s.ticker}`, s, color));

  return card;
}

// ── Sparklines ────────────────────────────────────────────────────────────────
function generateSparkData(price, changePct) {
  if (!price) return Array(20).fill(100);
  const end   = price;
  const start = price / (1 + (changePct||0)/100);
  const pts   = [];
  for (let i = 0; i < 20; i++) {
    const base  = start + (end - start) * (i/19);
    const noise = (Math.random() - 0.5) * Math.abs(end - start) * 0.4;
    pts.push(+(base + noise).toFixed(2));
  }
  pts[19] = end;
  return pts;
}

function drawSparkline(canvasId, stock, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const pts       = generateSparkData(stock.price, stock.changePct);
  const lineColor = (stock.changePct||0) >= 0 ? '#34d399' : '#f87171';
  drawSparklineFromData(canvasId, pts, lineColor);
}

function drawSparklineFromData(canvasId, prices, lineColor) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();

  new Chart(canvas, {
    type: 'line',
    data: {
      labels: prices.map((_,i) => i),
      datasets: [{
        data: prices,
        borderColor: lineColor,
        borderWidth: 1.8,
        fill: true,
        backgroundColor: ctx => {
          const g = ctx.chart.ctx.createLinearGradient(0,0,0,canvas.offsetHeight||44);
          g.addColorStop(0, lineColor + '40');
          g.addColorStop(1, lineColor + '00');
          return g;
        },
        tension: 0.4,
        pointRadius: 0,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500 },
      plugins: { legend: { display:false }, tooltip: { enabled:false } },
      scales: { x: { display:false }, y: { display:false } },
      layout: { padding: 0 }
    }
  });
}

function renderMiniSparkline() {
  const canvas = document.getElementById('portfolio-sparkline');
  if (!canvas) return;

  const tv  = totalValue();
  const tc  = totalCost();
  const pct = tc ? (tv - tc) / tc : 0;
  const pts = generateSparkData(tv, pct * 100);
  const c   = tv >= tc ? '#34d399' : '#f87171';

  if (miniSparklineChart) miniSparklineChart.destroy();

  miniSparklineChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: pts.map((_,i) => i),
      datasets: [{
        data: pts,
        borderColor: c,
        borderWidth: 2,
        fill: true,
        backgroundColor: ctx => {
          const g = ctx.chart.ctx.createLinearGradient(0,0,0,40);
          g.addColorStop(0, c+'50'); g.addColorStop(1, c+'00');
          return g;
        },
        tension: 0.45,
        pointRadius: 0,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 800 },
      plugins: { legend: { display:false }, tooltip: { enabled:false } },
      scales: { x: { display:false }, y: { display:false } },
      layout: { padding: 0 }
    }
  });
}

// ── Portfolio Charts ──────────────────────────────────────────────────────────
function renderCharts() {
  renderDonut();
  renderPerfChart();
}

function renderDonut() {
  const canvas = document.getElementById('donut-chart');
  const legend = document.getElementById('donut-legend');
  if (!canvas || portfolio.length === 0) return;

  const tv     = totalValue();
  const colors = portfolio.map((_, i) => PALETTE[i % PALETTE.length]);

  if (donutChart) donutChart.destroy();

  donutChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: portfolio.map(s => s.ticker),
      datasets: [{
        data: portfolio.map(s => stockValue(s)),
        backgroundColor: colors.map(c => c + 'cc'),
        borderColor: colors,
        borderWidth: 1.5,
        hoverOffset: 6,
      }]
    },
    options: {
      cutout: '68%',
      responsive: false,
      animation: { animateRotate: true, duration: 800 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${fmtUSD(ctx.raw)} (${((ctx.raw/tv)*100).toFixed(1)}%)`
          }
        }
      }
    }
  });

  legend.innerHTML = portfolio.map((s,i) => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${PALETTE[i % PALETTE.length]}"></div>
      <span class="legend-name">${s.ticker}</span>
      <span class="legend-pct">${((stockValue(s)/tv)*100).toFixed(1)}%</span>
    </div>
  `).join('');
}

function renderPerfChart() {
  const canvas = document.getElementById('perf-chart');
  if (!canvas || portfolio.length === 0) return;

  const days   = 30;
  const labels = Array.from({length:days}, (_,i) => {
    const d = new Date();
    d.setDate(d.getDate() - (days-1-i));
    return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  });

  const tc          = totalCost();
  const tv          = totalValue();
  const totalGainPct = tc ? (tv-tc)/tc*100 : 0;

  if (perfChart) perfChart.destroy();

  perfChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Your Portfolio',
          data: buildCurve(days, totalGainPct),
          borderColor: '#4f9eff',
          backgroundColor: '#4f9eff15',
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          borderWidth: 2,
        },
        {
          label: 'S&P 500',
          data: buildCurve(days, 6 + (Math.random()-0.5)*4),
          borderColor: '#a855f7',
          backgroundColor: 'transparent',
          tension: 0.4,
          pointRadius: 0,
          borderWidth: 1.5,
          borderDash: [4,4],
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 900 },
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: {
          display: true,
          labels: { color:'rgba(255,255,255,0.55)', boxWidth:12, padding:16, font:{size:11} }
        },
        tooltip: {
          backgroundColor: 'rgba(12,13,24,0.95)',
          borderColor: 'rgba(255,255,255,0.12)',
          borderWidth: 1,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.raw>=0?'+':''}${fmt(ctx.raw)}%`
          }
        }
      },
      scales: {
        x: {
          grid: { color:'rgba(255,255,255,0.04)' },
          ticks: { color:'rgba(255,255,255,0.35)', maxTicksLimit:6, font:{size:10} }
        },
        y: {
          grid: { color:'rgba(255,255,255,0.04)' },
          ticks: {
            color:'rgba(255,255,255,0.35)', font:{size:10},
            callback: v => (v>=0?'+':'')+v+'%'
          }
        }
      }
    }
  });
}

function buildCurve(len, endPct) {
  const pts = [0];
  for (let i = 1; i < len; i++) {
    const target = endPct * (i/(len-1));
    const noise  = (Math.random()-0.48) * Math.abs(endPct) * 0.3;
    pts.push(+(target+noise).toFixed(2));
  }
  pts[len-1] = +endPct.toFixed(2);
  return pts;
}

// ── Detail Modal ──────────────────────────────────────────────────────────────
async function openDetailModal(ticker) {
  detailTicker = ticker;
  const stock  = portfolio.find(s => s.ticker === ticker);
  if (!stock) return;

  document.getElementById('detail-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Reset tabs
  document.querySelectorAll('.range-btn').forEach(b => b.classList.toggle('active', b.dataset.range === 'D'));

  // Header
  renderDetailHeader(stock);

  // Show loading states
  document.getElementById('detail-chart-loading').style.display = 'flex';
  document.getElementById('detail-metrics').innerHTML = '<div class="detail-section-label">Key Metrics</div><div class="metrics-loading">Loading…</div>';
  document.getElementById('detail-news').innerHTML     = '<div class="news-loading">Loading news…</div>';

  // Load chart + metrics + news in parallel
  await Promise.allSettled([
    loadDetailChart('D'),
    loadDetailMetrics(ticker),
    loadDetailNews(ticker),
  ]);
}

function closeDetailModal() {
  document.getElementById('detail-modal').classList.add('hidden');
  document.body.style.overflow = '';
  if (detailChart) { detailChart.destroy(); detailChart = null; }
  detailTicker = null;
}

function handleDetailOverlayClick(e) {
  if (e.target === document.getElementById('detail-modal')) closeDetailModal();
}

function renderDetailHeader(stock) {
  const gain    = stockGain(stock);
  const gainPct = stockGainPct(stock);
  const color   = PALETTE[portfolio.indexOf(stock) % PALETTE.length];

  document.getElementById('detail-header').innerHTML = `
    <div class="detail-stock-info">
      <div class="detail-logo" style="background:${color}1a;border-color:${color}44;color:${color}">${stock.ticker.slice(0,2)}</div>
      <div class="detail-title">
        <div class="detail-ticker">${stock.ticker}</div>
        <div class="detail-name">${stock.name || stock.ticker}</div>
      </div>
      <div class="detail-price-block">
        <div class="detail-price">${stock.price ? '$'+fmt(stock.price) : '—'}</div>
        <div class="detail-day-change ${signClass(stock.changePct||0)}">
          ${stock.change != null ? (stock.change>=0?'+':'')+'$'+fmt(Math.abs(stock.change))+' ('+fmtPct(stock.changePct)+') today' : ''}
        </div>
      </div>
      <div class="detail-pnl-block">
        <div class="detail-pnl-label">Your P&amp;L</div>
        <div class="detail-pnl-value ${signClass(gain)}">${fmtUSD(gain)}&nbsp;(${fmtPct(gainPct)})</div>
      </div>
    </div>
  `;
}

async function loadDetailChart(range) {
  const loading = document.getElementById('detail-chart-loading');
  loading.style.display = 'flex';

  try {
    // Check sparkline cache for 1D first
    if (range === 'D' && candleCache.has(detailTicker)) {
      const cached = candleCache.get(detailTicker);
      if (Date.now() - cached.fetchedAt < CACHE_TTL) {
        renderDetailChartFromData(cached.closes, null, range);
        loading.style.display = 'none';
        return;
      }
    }

    const { resolution, from, to } = rangeParams(range);
    const data = await fetchCandles(detailTicker, resolution, from, to);

    if (range === 'D') {
      candleCache.set(detailTicker, { closes: data.c, fetchedAt: Date.now() });
      // Also refresh the card sparkline
      applySparklineData(detailTicker, data.c);
    }

    renderDetailChartFromData(data.c, data.t, range);
  } catch {
    // Fall back to simulated
    const stock = portfolio.find(s => s.ticker === detailTicker);
    renderDetailChartSimulated(stock, range);
  }

  loading.style.display = 'none';
}

function loadDetailRange(range, btn) {
  document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadDetailChart(range);
}

function renderDetailChartFromData(closes, timestamps, range) {
  const canvas = document.getElementById('detail-chart');
  if (!canvas) return;
  if (detailChart) detailChart.destroy();

  const labels = timestamps
    ? timestamps.map(t => {
        const d = new Date(t * 1000);
        return range === 'D'
          ? d.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' })
          : d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
      })
    : closes.map((_,i) => i);

  const up    = closes[closes.length-1] >= closes[0];
  const color = up ? '#34d399' : '#f87171';

  detailChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: closes,
        borderColor: color,
        backgroundColor: ctx => {
          const g = ctx.chart.ctx.createLinearGradient(0,0,0,220);
          g.addColorStop(0, color+'35'); g.addColorStop(1, color+'00');
          return g;
        },
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: color,
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600 },
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(12,13,24,0.95)',
          borderColor: 'rgba(255,255,255,0.12)',
          borderWidth: 1,
          callbacks: {
            title: items => items[0].label,
            label: ctx  => ` $${fmt(ctx.raw)}`
          }
        }
      },
      scales: {
        x: {
          grid: { color:'rgba(255,255,255,0.04)' },
          ticks: { color:'rgba(255,255,255,0.35)', maxTicksLimit:7, font:{size:10} }
        },
        y: {
          position: 'right',
          grid: { color:'rgba(255,255,255,0.04)' },
          ticks: { color:'rgba(255,255,255,0.35)', font:{size:10}, callback: v => '$'+fmt(v) }
        }
      }
    }
  });
}

function renderDetailChartSimulated(stock, range) {
  const len    = { D:40, W:50, M:30, '3M':90 }[range] || 30;
  const base   = stock?.price || 100;
  const endPct = stock?.changePct || 2;
  const closes = buildCurve(len, endPct).map(p => +(base * (1 + p/100)).toFixed(2));
  renderDetailChartFromData(closes, null, range);
}

async function loadDetailMetrics(ticker) {
  const el = document.getElementById('detail-metrics');
  try {
    const data = await fetchMetrics(ticker);
    const m    = data.metric || {};

    const rows = [
      { label:'52W High',   value: m['52WeekHigh']     ? '$'+fmt(m['52WeekHigh'])  : '—' },
      { label:'52W Low',    value: m['52WeekLow']      ? '$'+fmt(m['52WeekLow'])   : '—' },
      { label:'P/E Ratio',  value: m['peAnnual']       ? fmt(m['peAnnual'])        : '—' },
      { label:'EPS',        value: m['epsAnnual']      ? '$'+fmt(m['epsAnnual'])   : '—' },
      { label:'Market Cap', value: m['marketCapitalization'] ? fmtBig(m['marketCapitalization']*1e6) : '—' },
      { label:'Beta',       value: m['beta']           ? fmt(m['beta'])            : '—' },
      { label:'Div. Yield', value: m['dividendYieldIndicatedAnnual'] ? fmt(m['dividendYieldIndicatedAnnual'])+'%' : '—' },
      { label:'Avg Volume', value: m['10DayAverageTradingVolume'] ? fmtBig(m['10DayAverageTradingVolume']*1e6) : '—' },
    ];

    el.innerHTML = `
      <div class="detail-section-label">Key Metrics</div>
      <div class="metrics-grid">
        ${rows.map(r => `
          <div class="metric-item">
            <div class="metric-label">${r.label}</div>
            <div class="metric-value">${r.value}</div>
          </div>
        `).join('')}
      </div>
    `;
  } catch {
    el.innerHTML = '<div class="detail-section-label">Key Metrics</div><div class="data-unavailable">Metrics unavailable</div>';
  }
}

async function loadDetailNews(ticker) {
  const el = document.getElementById('detail-news');
  try {
    const articles = await fetchNews(ticker);
    if (!articles || articles.length === 0) {
      el.innerHTML = '<div class="data-unavailable">No recent news found</div>';
      return;
    }

    el.innerHTML = articles.slice(0, 6).map(a => `
      <a class="news-item" href="${escHtml(a.url)}" target="_blank" rel="noopener noreferrer">
        <div class="news-meta">
          <span class="news-source">${escHtml(a.source)}</span>
          <span class="news-date">${new Date(a.datetime*1000).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span>
        </div>
        <div class="news-headline">${escHtml(a.headline)}</div>
      </a>
    `).join('');
  } catch {
    el.innerHTML = '<div class="data-unavailable">News unavailable</div>';
  }
}

// ── AI Insight ────────────────────────────────────────────────────────────────
function generateAiInsight() {
  if (portfolio.length === 0) {
    document.getElementById('ai-insight').textContent = 'Add stocks to your portfolio to receive AI insights.';
    return;
  }

  const tv      = totalValue();
  const tc      = totalCost();
  const gain    = tv - tc;
  const gainPct = tc ? (gain/tc)*100 : 0;
  const dg      = totalDayGain();
  const sorted  = [...portfolio].sort((a,b) => stockGainPct(b) - stockGainPct(a));
  const best    = sorted[0];
  const worst   = sorted[sorted.length-1];

  const techTickers = ['AAPL','MSFT','NVDA','TSLA','GOOGL','AMZN','META','ADBE','CRM','AMD','INTC','NFLX'];
  const techPct     = (portfolio.filter(s => techTickers.includes(s.ticker)).length / portfolio.length) * 100;

  const insights = [];

  if (gainPct > 15)      insights.push(`Your portfolio is up ${fmtPct(gainPct)} overall — strong performance above typical market returns.`);
  else if (gainPct > 5)  insights.push(`Solid portfolio gain of ${fmtPct(gainPct)} — tracking ahead of conservative benchmarks.`);
  else if (gainPct < -10) insights.push(`Portfolio is down ${fmtPct(Math.abs(gainPct))} — consider reviewing underperforming positions.`);
  else                   insights.push(`Portfolio gain of ${fmtPct(gainPct)} — broadly in line with market conditions.`);

  if (best && stockGainPct(best) > 0)
    insights.push(`${best.ticker} is your top performer at ${fmtPct(stockGainPct(best))}.`);

  if (worst && stockGainPct(worst) < -5)
    insights.push(`${worst.ticker} is lagging at ${fmtPct(stockGainPct(worst))} — monitor for continued weakness.`);

  if (techPct > 60)         insights.push(`${techPct.toFixed(0)}% tech concentration — consider diversifying into other sectors.`);
  else if (portfolio.length < 4) insights.push(`Only ${portfolio.length} positions — adding more could reduce concentration risk.`);

  if (dg > 0)       insights.push(`Up ${fmtUSD(dg)} on the day.`);
  else if (dg < 0)  insights.push(`Down ${fmtUSD(Math.abs(dg))} today.`);

  document.getElementById('ai-insight').textContent = insights.slice(0,3).join(' ');
}

// ── Market Status ─────────────────────────────────────────────────────────────
function setMarketStatus() {
  const ny   = new Date(new Date().toLocaleString('en-US', { timeZone:'America/New_York' }));
  const mins = ny.getHours() * 60 + ny.getMinutes();
  const day  = ny.getDay();

  const el  = document.getElementById('market-status');
  const dot = document.querySelector('.market-badge .dot');

  if (day === 0 || day === 6) {
    el.textContent = 'Market Closed'; dot.classList.remove('live'); return;
  }
  if (mins >= 570 && mins < 960) {
    el.textContent = 'Market Open'; dot.classList.add('live');
  } else if (mins >= 240 && mins < 570) {
    el.textContent = 'Pre-Market'; dot.style.background = 'var(--accent-orange)';
  } else if (mins >= 960 && mins < 1200) {
    el.textContent = 'After Hours'; dot.style.background = 'var(--accent-orange)';
  } else {
    el.textContent = 'Market Closed'; dot.classList.remove('live');
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function updateLastUpdated() {
  const el = document.getElementById('last-updated');
  if (el) el.textContent = 'Prices updated ' + new Date().toLocaleTimeString();
}

function shake(el) {
  el.style.animation = 'none';
  el.offsetHeight;
  el.style.animation = 'shake 0.4s ease';
  el.addEventListener('animationend', () => el.style.animation = '', { once:true });
}

const shakeStyle = document.createElement('style');
shakeStyle.textContent = `@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}`;
document.head.appendChild(shakeStyle);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeDetailModal();
    document.getElementById('add-stock-modal').classList.add('hidden');
    document.getElementById('api-modal').classList.add('hidden');
  }
  if (e.key === 'Enter' && !document.getElementById('api-modal').classList.contains('hidden'))
    saveApiKey();
});

document.addEventListener('input', e => {
  if (e.target.id === 'new-ticker') e.target.value = e.target.value.toUpperCase();
});
