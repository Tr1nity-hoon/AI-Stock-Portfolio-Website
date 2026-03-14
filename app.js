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

// Company names for known tickers
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
let portfolio  = [];   // [{ ticker, shares, cost, price, prevClose, change, changePct, name }]
let apiKey     = '';
let demoMode   = false;
let donutChart = null;
let perfChart  = null;
let miniSparklineChart = null;

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Use stored key, or fall back to the bundled Finnhub key
  apiKey   = localStorage.getItem(API_KEY_STORE) || FINNHUB_DEFAULT;
  demoMode = false;
  localStorage.setItem(API_KEY_STORE, apiKey);

  loadPortfolio();
  updateApiIndicator();
  setMarketStatus();

  // Always start connected — hide the modal
  document.getElementById('api-modal').classList.add('hidden');

  if (portfolio.length > 0) refreshAll();
  else seedDefaultPortfolio();

  renderAll();

  // Auto-refresh every 60s during market hours
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
    dot.className   = 'dot api-connected';
    label.textContent = 'Live API';
  } else {
    dot.className   = 'dot api-demo';
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

// ── Demo Price Injection ──────────────────────────────────────────────────────
// Realistic-ish prices with random daily movement
const DEMO_PRICES = {
  AAPL:182.63,  MSFT:415.20, NVDA:875.40, TSLA:175.22, GOOGL:172.80,
  AMZN:188.40,  META:505.10, JPM:195.30,  V:278.50,    WMT:63.40,
  NFLX:620.00,  DIS:111.30,  ADBE:485.60, CRM:298.70,  AMD:163.80,
  INTC:30.20,   COIN:198.40, PLTR:24.50,  RBLX:42.10,  SNOW:158.20,
  SPY:522.00,   QQQ:448.00,  GLD:183.00,  JNJ:152.40,  KO:61.80,
};

function getDemoPrice(ticker) {
  const base  = DEMO_PRICES[ticker] || (50 + Math.random() * 450);
  const pct   = (Math.random() - 0.45) * 0.04;      // -2% to +2.2%
  const price = +(base * (1 + pct)).toFixed(2);
  const prev  = +(base).toFixed(2);
  return { price, prevClose: prev, change: +(price - prev).toFixed(2), changePct: +(pct * 100).toFixed(2) };
}

function injectDemoPrices() {
  portfolio.forEach(s => {
    const d = getDemoPrice(s.ticker);
    Object.assign(s, d);
    s.name = NAMES[s.ticker] || s.ticker;
  });
  savePortfolio();
  renderAll();
  updateLastUpdated();
  generateAiInsight();
}

// ── Finnhub API Fetch ─────────────────────────────────────────────────────────
async function fetchQuote(ticker) {
  const url = `${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const q = await res.json();
  // Finnhub returns: c=current, d=change, dp=changePct, pc=prevClose
  if (!q || !q.c || q.c === 0) throw new Error('No data for ' + ticker);
  return {
    price:     +q.c.toFixed(2),
    prevClose: +q.pc.toFixed(2),
    change:    +q.d.toFixed(2),
    changePct: +q.dp.toFixed(2),
  };
}

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

  // If ALL failed, likely rate-limit → fallback to demo prices
  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed === results.length) {
    console.warn('All API calls failed. Using demo prices.');
    injectDemoPrices();
    return;
  }

  setRefreshSpinner(false);
  savePortfolio();
  renderAll();
  updateLastUpdated();
  generateAiInsight();
}

function setRefreshSpinner(on) {
  const btn = document.querySelector('.btn-icon');
  if (btn) btn.classList.toggle('spinning', on);
}

// ── Add / Remove Stocks ───────────────────────────────────────────────────────
function openAddModal() {
  document.getElementById('add-stock-modal').classList.remove('hidden');
  document.getElementById('new-ticker').focus();
}

function closeAddModal() {
  document.getElementById('add-stock-modal').classList.add('hidden');
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
    const d = getDemoPrice(ticker);
    Object.assign(entry, d);
  } else if (apiKey) {
    try {
      const q = await fetchQuote(ticker);
      Object.assign(entry, q);
    } catch {
      const d = getDemoPrice(ticker);
      Object.assign(entry, d);
    }
  }

  portfolio.push(entry);
  savePortfolio();
  closeAddModal();
  renderAll();
  generateAiInsight();
}

function removeStock(ticker) {
  portfolio = portfolio.filter(s => s.ticker !== ticker);
  savePortfolio();
  renderAll();
  generateAiInsight();
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
function stockValue(s)    { return (s.price || s.cost || 0) * s.shares; }
function stockCost(s)     { return s.cost * s.shares; }
function stockGain(s)     { return stockValue(s) - stockCost(s); }
function stockGainPct(s)  { const c = stockCost(s); return c ? (stockGain(s)/c)*100 : 0; }
function totalValue()     { return portfolio.reduce((t,s) => t + stockValue(s), 0); }
function totalCost()      { return portfolio.reduce((t,s) => t + stockCost(s), 0); }
function totalDayGain()   { return portfolio.reduce((t,s) => t + (s.change||0)*s.shares, 0); }

function fmt(n, dp=2)  { return n.toLocaleString('en-US', { minimumFractionDigits:dp, maximumFractionDigits:dp }); }
function fmtUSD(n)     { return (n < 0 ? '-$' : '$') + fmt(Math.abs(n)); }
function fmtPct(n)     { return (n >= 0 ? '+' : '') + fmt(n) + '%'; }
function signClass(n)  { return n > 0 ? 'pos' : n < 0 ? 'neg' : 'neu'; }
function badgeClass(n) { return n > 0 ? 'up'  : n < 0 ? 'down' : 'flat'; }

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
  document.getElementById('day-gain').innerHTML = `<span class="${signClass(dg)}">${fmtUSD(dg)}</span>`;
  document.getElementById('total-invested').textContent = fmtUSD(tc);
  document.getElementById('positions-count').textContent = portfolio.length;

  const best = portfolio.reduce((b, s) => (!b || stockGainPct(s) > stockGainPct(b) ? s : b), null);
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
    // Clear all cards
    [...grid.querySelectorAll('.stock-card')].forEach(el => el.remove());
    return;
  }

  empty.style.display = 'none';

  // Rebuild cards
  [...grid.querySelectorAll('.stock-card')].forEach(el => el.remove());

  portfolio.forEach((s, i) => {
    const card = buildStockCard(s, tv, i);
    grid.appendChild(card);
  });
}

function buildStockCard(s, totalVal, colorIdx) {
  const val       = stockValue(s);
  const gain      = stockGain(s);
  const gainPct   = stockGainPct(s);
  const allocPct  = totalVal ? (val / totalVal) * 100 : 0;
  const color     = PALETTE[colorIdx % PALETTE.length];
  const initials  = s.ticker.slice(0,2);

  const card = document.createElement('div');
  card.className   = 'stock-card glass-card';
  card.dataset.ticker = s.ticker;

  card.innerHTML = `
    <div class="stock-card-header">
      <div style="display:flex;align-items:center;gap:10px">
        <div class="stock-logo" style="background:${color}1a;border-color:${color}33;color:${color}">${initials}</div>
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
      <button class="btn-remove" onclick="removeStock('${s.ticker}')">✕ Remove</button>
    </div>
  `;

  // Draw sparkline after insertion
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
    const base  = start + (end - start) * (i / 19);
    const noise = (Math.random() - 0.5) * Math.abs(end - start) * 0.4;
    pts.push(+(base + noise).toFixed(2));
  }
  pts[19] = end;
  return pts;
}

function drawSparkline(canvasId, stock, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const pts   = generateSparkData(stock.price, stock.changePct);
  const up    = (stock.changePct || 0) >= 0;
  const lineColor = up ? '#34d399' : '#f87171';

  new Chart(canvas, {
    type: 'line',
    data: {
      labels: pts.map((_,i) => i),
      datasets: [{
        data: pts,
        borderColor: lineColor,
        borderWidth: 1.8,
        fill: true,
        backgroundColor: ctx => {
          const g = ctx.chart.ctx.createLinearGradient(0,0,0,canvas.offsetHeight||44);
          g.addColorStop(0, lineColor + '40');
          g.addColorStop(1, lineColor + '00');
          return g;
        },
        tension: 0.45,
        pointRadius: 0,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600 },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { display: false },
        y: { display: false }
      },
      layout: { padding: 0 }
    }
  });
}

function renderMiniSparkline() {
  const canvas = document.getElementById('portfolio-sparkline');
  if (!canvas) return;

  // Generate a cumulative portfolio value sparkline
  const tv   = totalValue();
  const tc   = totalCost();
  const pct  = tc ? (tv - tc) / tc : 0;
  const pts  = generateSparkData(tv, pct * 100);

  if (miniSparklineChart) { miniSparklineChart.destroy(); }

  miniSparklineChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: pts.map((_,i) => i),
      datasets: [{
        data: pts,
        borderColor: tv >= tc ? '#34d399' : '#f87171',
        borderWidth: 2,
        fill: true,
        backgroundColor: ctx => {
          const c = tv >= tc ? '#34d399' : '#f87171';
          const g = ctx.chart.ctx.createLinearGradient(0,0,0,40);
          g.addColorStop(0, c+'50');
          g.addColorStop(1, c+'00');
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
      scales: { x:{display:false}, y:{display:false} },
      layout: { padding: 0 }
    }
  });
}

// ── Charts ────────────────────────────────────────────────────────────────────
function renderCharts() {
  renderDonut();
  renderPerfChart();
}

function renderDonut() {
  const canvas = document.getElementById('donut-chart');
  const legend = document.getElementById('donut-legend');
  if (!canvas || portfolio.length === 0) return;

  const tv     = totalValue();
  const labels = portfolio.map(s => s.ticker);
  const values = portfolio.map(s => stockValue(s));
  const colors = portfolio.map((_, i) => PALETTE[i % PALETTE.length]);

  if (donutChart) donutChart.destroy();

  donutChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
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

  // Legend
  legend.innerHTML = portfolio.map((s, i) => `
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

  // Simulate 30-day portfolio performance vs S&P
  const days     = 30;
  const labels   = Array.from({length:days}, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  });

  const tc    = totalCost();
  const tv    = totalValue();
  const totalGainPct = tc ? (tv - tc) / tc * 100 : 0;

  // Build portfolio curve (ends at totalGainPct %)
  const portCurve  = buildCurve(days, totalGainPct);
  // Build S&P curve (simulated moderate growth ~6%)
  const spxCurve   = buildCurve(days, 6 + (Math.random() - 0.5) * 4);

  if (perfChart) perfChart.destroy();

  perfChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Your Portfolio',
          data: portCurve,
          borderColor: '#4f9eff',
          backgroundColor: '#4f9eff15',
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          borderWidth: 2,
        },
        {
          label: 'S&P 500',
          data: spxCurve,
          borderColor: '#a855f7',
          backgroundColor: 'transparent',
          tension: 0.4,
          pointRadius: 0,
          borderWidth: 1.5,
          borderDash: [4, 4],
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
          labels: {
            color: 'rgba(255,255,255,0.55)',
            boxWidth: 12,
            padding: 16,
            font: { size: 11 }
          }
        },
        tooltip: {
          backgroundColor: 'rgba(12,13,24,0.95)',
          borderColor: 'rgba(255,255,255,0.12)',
          borderWidth: 1,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.raw >= 0 ? '+' : ''}${fmt(ctx.raw)}%`
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: 'rgba(255,255,255,0.35)', maxTicksLimit:6, font:{size:10} }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: {
            color: 'rgba(255,255,255,0.35)',
            font: {size:10},
            callback: v => (v>=0?'+':'') + v + '%'
          }
        }
      }
    }
  });
}

function buildCurve(len, endPct) {
  const pts = [0];
  for (let i = 1; i < len; i++) {
    const target = endPct * (i / (len-1));
    const noise  = (Math.random() - 0.48) * Math.abs(endPct) * 0.3;
    pts.push(+(target + noise).toFixed(2));
  }
  pts[len-1] = +endPct.toFixed(2);
  return pts;
}

// ── AI Insight Generator ──────────────────────────────────────────────────────
function generateAiInsight() {
  if (portfolio.length === 0) {
    document.getElementById('ai-insight').textContent = 'Add stocks to your portfolio to receive AI insights.';
    return;
  }

  const tv       = totalValue();
  const tc       = totalCost();
  const gain     = tv - tc;
  const gainPct  = tc ? (gain/tc)*100 : 0;
  const dg       = totalDayGain();

  const sorted   = [...portfolio].sort((a,b) => stockGainPct(b) - stockGainPct(a));
  const best     = sorted[0];
  const worst    = sorted[sorted.length-1];

  const techTickers = ['AAPL','MSFT','NVDA','TSLA','GOOGL','AMZN','META','ADBE','CRM','AMD','INTC','NFLX'];
  const techCount   = portfolio.filter(s => techTickers.includes(s.ticker)).length;
  const techPct     = (techCount / portfolio.length) * 100;

  const insights = [];

  if (gainPct > 15) insights.push(`Your portfolio is up ${fmtPct(gainPct)} overall — strong performance above typical market returns.`);
  else if (gainPct > 5) insights.push(`Solid portfolio gain of ${fmtPct(gainPct)} — tracking ahead of conservative benchmarks.`);
  else if (gainPct < -10) insights.push(`Portfolio is down ${fmtPct(Math.abs(gainPct))} — consider reviewing underperforming positions.`);
  else insights.push(`Portfolio gain of ${fmtPct(gainPct)} — broadly in line with market conditions.`);

  if (best && stockGainPct(best) > 0)
    insights.push(`${best.ticker} is your top performer at ${fmtPct(stockGainPct(best))} gain.`);

  if (worst && stockGainPct(worst) < -5)
    insights.push(`${worst.ticker} is lagging at ${fmtPct(stockGainPct(worst))} — monitor for continued weakness.`);

  if (techPct > 60) insights.push(`${techPct.toFixed(0)}% tech concentration detected — consider diversifying into other sectors.`);
  else if (portfolio.length < 4) insights.push(`With only ${portfolio.length} positions, consider adding more stocks to reduce concentration risk.`);

  if (dg > 0) insights.push(`Up ${fmtUSD(dg)} on the day.`);
  else if (dg < 0) insights.push(`Down ${fmtUSD(Math.abs(dg))} today.`);

  document.getElementById('ai-insight').textContent = insights.slice(0,3).join(' ');
}

// ── Market Status ─────────────────────────────────────────────────────────────
function setMarketStatus() {
  const now   = new Date();
  const ny    = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const h     = ny.getHours(), m = ny.getMinutes(), d = ny.getDay();
  const mins  = h * 60 + m;

  const el   = document.getElementById('market-status');
  const dot  = document.querySelector('.market-badge .dot');

  if (d === 0 || d === 6) {
    el.textContent = 'Market Closed';
    dot.classList.remove('live');
    return;
  }
  if (mins >= 570 && mins < 960) {
    el.textContent = 'Market Open';
    dot.classList.add('live');
  } else if (mins >= 240 && mins < 570) {
    el.textContent = 'Pre-Market';
    dot.style.background = 'var(--accent-orange)';
  } else if (mins >= 960 && mins < 1200) {
    el.textContent = 'After Hours';
    dot.style.background = 'var(--accent-orange)';
  } else {
    el.textContent = 'Market Closed';
    dot.classList.remove('live');
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function updateLastUpdated() {
  const el = document.getElementById('last-updated');
  if (el) el.textContent = 'Prices updated ' + new Date().toLocaleTimeString();
}

function shake(el) {
  el.style.animation = 'none';
  el.offsetHeight;                      // reflow
  el.style.animation = 'shake 0.4s ease';
  el.addEventListener('animationend', () => el.style.animation = '', { once: true });
}

// Inject shake keyframes dynamically
const shakeStyle = document.createElement('style');
shakeStyle.textContent = `@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}`;
document.head.appendChild(shakeStyle);

// Allow Enter key in API modal
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.getElementById('add-stock-modal').classList.add('hidden');
    document.getElementById('api-modal').classList.add('hidden');
  }
  if (e.key === 'Enter' && !document.getElementById('api-modal').classList.contains('hidden'))
    saveApiKey();
});

// Ticker input auto-uppercase
document.addEventListener('input', e => {
  if (e.target.id === 'new-ticker')
    e.target.value = e.target.value.toUpperCase();
});
