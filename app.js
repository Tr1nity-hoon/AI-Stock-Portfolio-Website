/* =========================================================
   Quantara – AI Stock Portfolio  ·  app.js
   ========================================================= */
'use strict';

// ── Constants ────────────────────────────────────────────────────────────────
const FINNHUB_BASE    = 'https://finnhub.io/api/v1';
const FINNHUB_DEFAULT = 'd6ep8bhr01qksaq9dcb0d6ep8bhr01qksaq9dcbg';
const PORTFOLIOS_KEY  = 'quantara_portfolios_v2';
const ACTIVE_PF_KEY   = 'quantara_active_pf';
const API_KEY_STORE   = 'quantara_fh_key';

const PF_COLORS = ['#20c9d4','#8b5cf6','#10b981','#f59e0b','#ef4444','#3b82f6'];

const PALETTE = [
  '#20c9d4','#8b5cf6','#3b82f6','#10b981','#f59e0b',
  '#f472b6','#a78bfa','#34d399','#fbbf24','#60a5fa'
];

const NAMES = {
  AAPL:'Apple Inc.', MSFT:'Microsoft', GOOGL:'Alphabet', AMZN:'Amazon',
  TSLA:'Tesla', NVDA:'NVIDIA', META:'Meta Platforms', JPM:'JPMorgan Chase',
  V:'Visa', WMT:'Walmart', JNJ:'Johnson & Johnson', XOM:'ExxonMobil',
  UNH:'UnitedHealth', MA:'Mastercard', PG:'Procter & Gamble', HD:'Home Depot',
  CVX:'Chevron', LLY:'Eli Lilly', ABBV:'AbbVie', MRK:'Merck', PEP:'PepsiCo',
  KO:'Coca-Cola', COST:'Costco', AVGO:'Broadcom', MCD:"McDonald's",
  DIS:'Disney', NFLX:'Netflix', ADBE:'Adobe', CRM:'Salesforce',
  INTC:'Intel', AMD:'AMD', QCOM:'Qualcomm', PYPL:'PayPal',
  SHOP:'Shopify', SNOW:'Snowflake', PLTR:'Palantir', COIN:'Coinbase',
  RBLX:'Roblox', SPY:'S&P 500 ETF', QQQ:'Nasdaq 100 ETF',
  GLD:'Gold ETF', TLT:'20yr Bond ETF',
};

// ── State ─────────────────────────────────────────────────────────────────────
let portfolios        = {};
let activePortfolioId = '';
let portfolio         = [];
let apiKey            = '';
let demoMode          = false;
let selectedPfColor   = PF_COLORS[0];

let donutChart   = null;
let perfChart    = null;
let barChart     = null;
let miniChart    = null;
let detailChart  = null;
let detailTicker = null;

// Candle cache: ticker → { closes, timestamps, fetchedAt }
const candleCache = new Map();
const CACHE_TTL   = 5 * 60 * 1000;

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  apiKey = localStorage.getItem(API_KEY_STORE) || FINNHUB_DEFAULT;
  localStorage.setItem(API_KEY_STORE, apiKey);

  initPortfolios();
  updateApiIndicator();
  setMarketStatus();
  renderPortfolioSwitcher();
  setupAutocomplete();
  initColorPicker();

  document.getElementById('api-modal').classList.add('hidden');

  refreshAll();
  loadNews();

  setInterval(() => { if (!demoMode && apiKey) refreshAll(); }, 60000);
});

// ── Portfolio Management ──────────────────────────────────────────────────────
function initPortfolios() {
  const raw = localStorage.getItem(PORTFOLIOS_KEY);
  if (raw) {
    portfolios        = JSON.parse(raw);
    activePortfolioId = localStorage.getItem(ACTIVE_PF_KEY) || Object.keys(portfolios)[0];
  } else {
    const old = localStorage.getItem('quantara_portfolio_v2');
    const id  = 'pf_' + Date.now();
    portfolios = { [id]: { id, name:'My Portfolio', color:PF_COLORS[0], stocks: old ? tryParse(old,[]) : [] } };
    activePortfolioId = id;
    savePortfolios();
  }
  portfolio = portfolios[activePortfolioId]?.stocks || [];
  if (!portfolio.length) seedDefaultPortfolio();
}

function tryParse(s, fb) { try { return JSON.parse(s); } catch { return fb; } }

function savePortfolios() {
  localStorage.setItem(PORTFOLIOS_KEY, JSON.stringify(portfolios));
  localStorage.setItem(ACTIVE_PF_KEY, activePortfolioId);
}

function switchPortfolio(id) {
  if (!portfolios[id]) return;
  activePortfolioId = id;
  portfolio = portfolios[id].stocks;
  savePortfolios();
  candleCache.clear();
  renderPortfolioSwitcher();
  renderAll();
  refreshAll();
}

function openNewPfModal() {
  document.getElementById('new-pf-name').value = '';
  document.getElementById('new-pf-modal').classList.remove('hidden');
  document.getElementById('new-pf-name').focus();
}
function closeNewPfModal() { document.getElementById('new-pf-modal').classList.add('hidden'); }

function confirmCreatePortfolio() {
  const name = document.getElementById('new-pf-name').value.trim();
  if (!name) { shake(document.getElementById('new-pf-name')); return; }
  const id = 'pf_' + Date.now();
  portfolios[id] = { id, name, color: selectedPfColor, stocks: [] };
  savePortfolios();
  closeNewPfModal();
  switchPortfolio(id);
}

function deletePortfolio(id, e) {
  e.stopPropagation();
  if (Object.keys(portfolios).length <= 1) return;
  delete portfolios[id];
  if (activePortfolioId === id) {
    activePortfolioId = Object.keys(portfolios)[0];
    portfolio = portfolios[activePortfolioId].stocks;
  }
  savePortfolios();
  renderPortfolioSwitcher();
  renderAll();
}

function renderPortfolioSwitcher() {
  document.getElementById('pf-switcher').innerHTML =
    Object.values(portfolios).map(pf => `
      <button class="pf-pill ${pf.id===activePortfolioId?'active':''}" onclick="switchPortfolio('${pf.id}')">
        <span class="pf-dot" style="background:${pf.color}"></span>
        ${escHtml(pf.name)}
        ${Object.keys(portfolios).length>1?`<button class="pf-del" onclick="deletePortfolio('${pf.id}',event)">✕</button>`:''}
      </button>`).join('');

  document.getElementById('add-modal-pf-name').textContent =
    portfolios[activePortfolioId]?.name || 'Portfolio';
}

function initColorPicker() {
  document.getElementById('pf-color-picker').innerHTML =
    PF_COLORS.map((c,i) => `
      <div class="pf-color-swatch ${i===0?'selected':''}" style="background:${c}" data-color="${c}"
           onclick="selectPfColor('${c}',this)"></div>`).join('');
}

function selectPfColor(color, el) {
  selectedPfColor = color;
  document.querySelectorAll('.pf-color-swatch').forEach(s => s.classList.remove('selected'));
  el.classList.add('selected');
}

function seedDefaultPortfolio() {
  portfolios[activePortfolioId].stocks = [
    { ticker:'AAPL', shares:15, cost:148.50 },
    { ticker:'MSFT', shares:8,  cost:310.00 },
    { ticker:'NVDA', shares:5,  cost:420.00 },
    { ticker:'TSLA', shares:10, cost:195.00 },
    { ticker:'GOOGL',shares:3,  cost:130.00 },
  ];
  portfolio = portfolios[activePortfolioId].stocks;
  savePortfolios();
}

// ── Demo Prices ───────────────────────────────────────────────────────────────
const DEMO_PRICES = {
  AAPL:182.63, MSFT:415.20, NVDA:875.40, TSLA:175.22, GOOGL:172.80,
  AMZN:188.40, META:505.10, JPM:195.30,  V:278.50,    WMT:63.40,
  NFLX:620.00, DIS:111.30,  ADBE:485.60, CRM:298.70,  AMD:163.80,
  INTC:30.20,  COIN:198.40, PLTR:24.50,  RBLX:42.10,  SNOW:158.20,
  SPY:522.00,  QQQ:448.00,  GLD:183.00,  JNJ:152.40,  KO:61.80,
};

function seededRand(seed) {
  let s = Math.abs(seed) || 1;
  return () => { s=(s*9301+49297)%233280; return s/233280; };
}

function getDemoPrice(ticker) {
  const base  = DEMO_PRICES[ticker] || 100 + seededRand(ticker.charCodeAt(0)*37)()*400;
  const rand  = seededRand(Date.now()%997 + ticker.charCodeAt(0));
  const pct   = (rand()-.46)*.04;
  const price = +(base*(1+pct)).toFixed(2);
  return { price, prevClose:+base.toFixed(2), change:+(price-base).toFixed(2), changePct:+(pct*100).toFixed(2) };
}

function injectDemoPrices() {
  portfolio.forEach(s => { Object.assign(s, getDemoPrice(s.ticker)); s.name = NAMES[s.ticker]||s.ticker; });
  savePortfolios();
  renderAll();
  updateLastUpdated();
  generateAiInsight();
}

// ── Finnhub API ───────────────────────────────────────────────────────────────
async function fetchQuote(ticker) {
  const r = await fetch(`${FINNHUB_BASE}/quote?symbol=${enc(ticker)}&token=${apiKey}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const q = await r.json();
  if (!q?.c || q.c===0) throw new Error('No data');
  return { price:+q.c.toFixed(2), prevClose:+q.pc.toFixed(2), change:+q.d.toFixed(2), changePct:+q.dp.toFixed(2) };
}

async function fetchCandles(ticker, resolution, from, to) {
  const r = await fetch(`${FINNHUB_BASE}/stock/candle?symbol=${enc(ticker)}&resolution=${resolution}&from=${from}&to=${to}&token=${apiKey}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  if (d.s!=='ok' || !d.c?.length) throw new Error('No candles');
  return d; // { c, h, l, o, t, v }
}

async function fetchSearch(q) {
  const r = await fetch(`${FINNHUB_BASE}/search?q=${enc(q)}&token=${apiKey}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function fetchMetrics(ticker) {
  const r = await fetch(`${FINNHUB_BASE}/stock/metric?symbol=${enc(ticker)}&metric=all&token=${apiKey}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function fetchNewsFor(ticker) {
  const to   = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now()-7*864e5).toISOString().split('T')[0];
  const r    = await fetch(`${FINNHUB_BASE}/company-news?symbol=${enc(ticker)}&from=${from}&to=${to}&token=${apiKey}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function fetchMarketNews() {
  const r = await fetch(`${FINNHUB_BASE}/news?category=general&token=${apiKey}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ── Candle helpers ────────────────────────────────────────────────────────────
/*
  Range params — use DAILY resolution where possible; it always has data.
  For 1D we use hourly ('60') over the last 5 days so we always get real bars
  even on weekends or after-hours.
*/
function rangeParams(range) {
  const to  = Math.floor(Date.now()/1000);
  const day = 86400;
  switch (range) {
    case 'D':  return { resolution:'60', from: to-5*day,  to }; // hourly, last 5 days
    case 'W':  return { resolution:'60', from: to-8*day,  to }; // hourly, last 8 days
    case 'M':  return { resolution:'D',  from: to-35*day, to }; // daily,  last 35 days
    case '3M': return { resolution:'D',  from: to-95*day, to }; // daily,  last 95 days
    default:   return { resolution:'D',  from: to-35*day, to };
  }
}

// Sparkline candles: 30-day daily — most reliable, always present
async function refreshSparklineForCard(ticker) {
  const cached = candleCache.get(ticker);
  if (cached && Date.now()-cached.fetchedAt < CACHE_TTL) { applySparklineData(ticker, cached.closes); return; }
  try {
    const to   = Math.floor(Date.now()/1000);
    const from = to - 35*86400;
    const data = await fetchCandles(ticker, 'D', from, to);
    const closes = data.c.slice(-30);
    candleCache.set(ticker, { closes, timestamps: data.t.slice(-30), fetchedAt: Date.now() });
    applySparklineData(ticker, closes);
  } catch { /* keep simulated sparkline */ }
}

function applySparklineData(ticker, closes) {
  const canvas = document.getElementById(`spark-${ticker}`);
  if (!canvas) return;
  const ex = Chart.getChart(canvas); if (ex) ex.destroy();
  const up = closes[closes.length-1] >= closes[0];
  drawSparklineFromData(`spark-${ticker}`, closes, up?'#10b981':'#ef4444');
}

// ── Refresh All ───────────────────────────────────────────────────────────────
async function refreshAll() {
  if (!portfolio.length) return;
  if (demoMode) { injectDemoPrices(); return; }
  if (!apiKey)  { openApiModal(); return; }

  setRefreshSpinner(true);

  const results = await Promise.allSettled(
    portfolio.map(async s => {
      const q = await fetchQuote(s.ticker);
      Object.assign(s, q);
      s.name = NAMES[s.ticker] || s.ticker;
    })
  );

  if (results.every(r => r.status==='rejected')) { injectDemoPrices(); return; }

  setRefreshSpinner(false);
  savePortfolios();
  renderAll();
  updateLastUpdated();
  generateAiInsight();

  // Fire-and-forget sparklines (30-day daily)
  portfolio.forEach(s => refreshSparklineForCard(s.ticker));
}

function setRefreshSpinner(on) {
  document.querySelector('.btn-icon')?.classList.toggle('spinning', on);
}

// ── Add / Remove ──────────────────────────────────────────────────────────────
function openAddModal() {
  document.getElementById('add-stock-modal').classList.remove('hidden');
  document.getElementById('new-ticker').focus();
}
function closeAddModal() {
  document.getElementById('add-stock-modal').classList.add('hidden');
  document.getElementById('ticker-dropdown').classList.add('hidden');
  ['new-ticker','new-shares','new-cost'].forEach(id => document.getElementById(id).value='');
}

async function addStock() {
  const ticker = document.getElementById('new-ticker').value.trim().toUpperCase();
  const shares = parseFloat(document.getElementById('new-shares').value);
  const cost   = parseFloat(document.getElementById('new-cost').value);

  if (!ticker||isNaN(shares)||shares<=0||isNaN(cost)||cost<0) {
    ['new-ticker','new-shares','new-cost'].forEach(id=>shake(document.getElementById(id))); return;
  }
  if (portfolio.find(s=>s.ticker===ticker)) { shake(document.getElementById('new-ticker')); return; }

  const entry = { ticker, shares, cost, name:NAMES[ticker]||ticker };
  if (demoMode) Object.assign(entry, getDemoPrice(ticker));
  else if (apiKey) { try { Object.assign(entry, await fetchQuote(ticker)); } catch { Object.assign(entry, getDemoPrice(ticker)); } }

  portfolio.push(entry);
  savePortfolios();
  closeAddModal();
  renderAll();
  generateAiInsight();
  if (!demoMode && apiKey) refreshSparklineForCard(ticker);
}

function removeStock(ticker) {
  const i = portfolio.findIndex(s=>s.ticker===ticker);
  if (i>-1) portfolio.splice(i,1);
  candleCache.delete(ticker);
  savePortfolios();
  renderAll();
  generateAiInsight();
  renderCharts();
}

// ── Sort ──────────────────────────────────────────────────────────────────────
function sortHoldings() {
  const by = document.getElementById('sort-select').value;
  portfolio.sort((a,b) => {
    if (by==='value')    return stockValue(b)-stockValue(a);
    if (by==='gain_pct') return (b.changePct||0)-(a.changePct||0);
    if (by==='price')    return (b.price||0)-(a.price||0);
    if (by==='name')     return a.ticker.localeCompare(b.ticker);
    return 0;
  });
  renderHoldings();
}

// ── API Key Modal ─────────────────────────────────────────────────────────────
function saveApiKey() {
  const val = document.getElementById('api-key-input').value.trim();
  if (!val) { shake(document.getElementById('api-key-input')); return; }
  apiKey=val; demoMode=false;
  localStorage.setItem(API_KEY_STORE, apiKey);
  document.getElementById('api-modal').classList.add('hidden');
  updateApiIndicator(); candleCache.clear(); refreshAll();
}
function useDemoMode() {
  demoMode=true; apiKey='';
  document.getElementById('api-modal').classList.add('hidden');
  updateApiIndicator(); injectDemoPrices();
}
function openApiModal() {
  document.getElementById('api-key-input').value = apiKey;
  document.getElementById('api-modal').classList.remove('hidden');
}
function updateApiIndicator() {
  const dot=document.getElementById('api-dot'), lbl=document.getElementById('api-label');
  if (apiKey) { dot.className='dot api-on'; lbl.textContent='Live · Finnhub'; }
  else        { dot.className='dot api-demo'; lbl.textContent='Demo'; }
}

// ── Computed helpers ──────────────────────────────────────────────────────────
const stockValue   = s => (s.price||s.cost||0)*s.shares;
const stockCost    = s => s.cost*s.shares;
const stockGain    = s => stockValue(s)-stockCost(s);
const stockGainPct = s => { const c=stockCost(s); return c?(stockGain(s)/c)*100:0; };
const totalValue   = () => portfolio.reduce((t,s)=>t+stockValue(s),0);
const totalCost    = () => portfolio.reduce((t,s)=>t+stockCost(s),0);
const totalDayGain = () => portfolio.reduce((t,s)=>t+(s.change||0)*s.shares,0);

const fmt     = (n,dp=2) => n.toLocaleString('en-US',{minimumFractionDigits:dp,maximumFractionDigits:dp});
const fmtUSD  = n => (n<0?'-$':'$')+fmt(Math.abs(n));
const fmtPct  = n => (n>=0?'+':'')+fmt(n)+'%';
const signCls = n => n>0?'pos':n<0?'neg':'neu';
const bdgCls  = n => n>0?'up':n<0?'down':'flat';
const enc     = s => encodeURIComponent(s);

function fmtBig(n) {
  if (n>=1e12) return '$'+(n/1e12).toFixed(2)+'T';
  if (n>=1e9)  return '$'+(n/1e9).toFixed(2)+'B';
  if (n>=1e6)  return '$'+(n/1e6).toFixed(2)+'M';
  return '$'+fmt(n);
}
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Render All ────────────────────────────────────────────────────────────────
function renderAll() {
  renderSummary();
  renderHoldings();
  renderCharts();
}

// ── Summary ───────────────────────────────────────────────────────────────────
function renderSummary() {
  const tv=totalValue(), tc=totalCost(), gain=tv-tc;
  const pct=tc?(gain/tc)*100:0, dg=totalDayGain();

  const tvEl=document.getElementById('total-value');
  tvEl.textContent=fmtUSD(tv);
  tvEl.className='hero-value '+(gain>=0?'up':'down');

  const bdg=document.getElementById('total-change-badge');
  bdg.textContent=fmtPct(pct); bdg.className='change-badge '+bdgCls(gain);

  document.getElementById('total-change-dollar').textContent=fmtUSD(gain)+' all time';
  document.getElementById('day-gain').innerHTML=`<span class="${signCls(dg)}">${fmtUSD(dg)}</span>`;
  document.getElementById('total-invested').textContent=fmtUSD(tc);
  document.getElementById('positions-count').textContent=portfolio.length;

  const best=portfolio.reduce((b,s)=>(!b||stockGainPct(s)>stockGainPct(b)?s:b),null);
  document.getElementById('best-performer').innerHTML=best
    ?`${best.ticker} <span class="pos">${fmtPct(stockGainPct(best))}</span>`:'—';

  renderMiniSparkline();
}

// ── Holdings ──────────────────────────────────────────────────────────────────
function renderHoldings() {
  const grid=document.getElementById('holdings-grid');
  const empty=document.getElementById('empty-state');
  const tv=totalValue();

  if (!portfolio.length) {
    empty.style.display='flex';
    [...grid.querySelectorAll('.stock-card')].forEach(el=>el.remove());
    return;
  }
  empty.style.display='none';
  [...grid.querySelectorAll('.stock-card')].forEach(el=>el.remove());
  portfolio.forEach((s,i)=>grid.appendChild(buildStockCard(s,tv,i)));
}

function buildStockCard(s, totalVal, colorIdx) {
  const val=stockValue(s), gain=stockGain(s), gainPct=stockGainPct(s);
  const allocPct=totalVal?(val/totalVal)*100:0;
  const color=PALETTE[colorIdx%PALETTE.length];

  const card=document.createElement('div');
  card.className='stock-card glass-card';
  card.innerHTML=`
    <div class="stock-card-header">
      <div style="display:flex;align-items:center;gap:9px">
        <div class="stock-logo" style="background:${color}18;border:1px solid ${color}30;color:${color}">${s.ticker.slice(0,2)}</div>
        <div>
          <div class="stock-ticker">${s.ticker}</div>
          <div class="stock-name">${s.name||s.ticker}</div>
        </div>
      </div>
      <div class="stock-price-block">
        <div class="stock-price ${s.price?'':'loading'}">${s.price?'$'+fmt(s.price):'$—'}</div>
        <div class="stock-day-change ${signCls(s.changePct)}">${s.changePct!=null?fmtPct(s.changePct)+' today':''}</div>
      </div>
    </div>
    <div class="stock-sparkline"><canvas id="spark-${s.ticker}"></canvas></div>
    <div class="stock-stats">
      <div><div class="stock-stat-label">Value</div><div class="stock-stat-value">${fmtUSD(val)}</div></div>
      <div><div class="stock-stat-label">Shares</div><div class="stock-stat-value">${fmt(s.shares,4)}</div></div>
      <div><div class="stock-stat-label">Avg Cost</div><div class="stock-stat-value">$${fmt(s.cost)}</div></div>
      <div><div class="stock-stat-label">Total Gain</div><div class="stock-stat-value ${signCls(gain)}">${fmtUSD(gain)} (${fmtPct(gainPct)})</div></div>
    </div>
    <div class="stock-divider"></div>
    <div class="stock-card-footer">
      <div class="allocation-bar-wrap">
        <div class="allocation-bar-label">Allocation</div>
        <div class="allocation-bar-bg"><div class="allocation-bar-fill" style="width:${allocPct.toFixed(1)}%;background:linear-gradient(90deg,${color},${color}80)"></div></div>
      </div>
      <span style="font-size:0.64rem;color:var(--text-3);margin-right:7px">${allocPct.toFixed(1)}%</span>
      <button class="btn-remove js-remove" data-ticker="${s.ticker}">✕</button>
    </div>
    <div class="card-detail-hint">Click for details →</div>
  `;

  card.addEventListener('click', e => { if (!e.target.closest('.js-remove')) openDetailModal(s.ticker); });
  card.querySelector('.js-remove').addEventListener('click', e => { e.stopPropagation(); removeStock(s.ticker); });
  requestAnimationFrame(() => drawSparkline(`spark-${s.ticker}`, s));
  return card;
}

// ── Sparklines ────────────────────────────────────────────────────────────────
function generateSparkData(price, changePct, seed=42) {
  if (!price) return Array(20).fill(100);
  const rand=seededRand(seed), end=price, start=price/(1+(changePct||0)/100), pts=[];
  for (let i=0;i<20;i++) {
    const base=start+(end-start)*(i/19);
    pts.push(+(base+(rand()-.5)*Math.abs(end-start)*.35).toFixed(2));
  }
  pts[19]=end; return pts;
}

function drawSparkline(canvasId, stock) {
  const up=( stock.changePct||0)>=0;
  drawSparklineFromData(canvasId, generateSparkData(stock.price, stock.changePct, stock.cost||42), up?'#10b981':'#ef4444');
}

function drawSparklineFromData(canvasId, prices, lineColor) {
  const canvas=document.getElementById(canvasId); if (!canvas) return;
  const ex=Chart.getChart(canvas); if (ex) ex.destroy();
  new Chart(canvas, {
    type:'line',
    data:{ labels:prices.map((_,i)=>i), datasets:[{
      data:prices, borderColor:lineColor, borderWidth:1.7, fill:true,
      backgroundColor:ctx=>{ const g=ctx.chart.ctx.createLinearGradient(0,0,0,canvas.offsetHeight||40); g.addColorStop(0,lineColor+'35'); g.addColorStop(1,lineColor+'00'); return g; },
      tension:.4, pointRadius:0
    }]},
    options:{ responsive:true, maintainAspectRatio:false, animation:{duration:420},
      plugins:{legend:{display:false},tooltip:{enabled:false}},
      scales:{x:{display:false},y:{display:false}}, layout:{padding:0} }
  });
}

function renderMiniSparkline() {
  const canvas=document.getElementById('portfolio-sparkline'); if (!canvas) return;
  const tv=totalValue(), tc=totalCost();
  const pts=generateSparkData(tv, tc?(tv-tc)/tc*100:0, tc||1);
  const c=tv>=tc?'#10b981':'#ef4444';
  if (miniChart) miniChart.destroy();
  miniChart=new Chart(canvas,{
    type:'line',
    data:{ labels:pts.map((_,i)=>i), datasets:[{
      data:pts, borderColor:c, borderWidth:1.8, fill:true,
      backgroundColor:ctx=>{ const g=ctx.chart.ctx.createLinearGradient(0,0,0,36); g.addColorStop(0,c+'42'); g.addColorStop(1,c+'00'); return g; },
      tension:.45, pointRadius:0
    }]},
    options:{ responsive:true, maintainAspectRatio:false, animation:{duration:700},
      plugins:{legend:{display:false},tooltip:{enabled:false}},
      scales:{x:{display:false},y:{display:false}}, layout:{padding:0} }
  });
}

// ── Charts ────────────────────────────────────────────────────────────────────
function renderCharts() {
  renderPerfChart();
  renderDonut();
  renderBarChart();
}

function renderPerfChart() {
  const canvas=document.getElementById('perf-chart'); if (!canvas) return;
  if (perfChart) { perfChart.destroy(); perfChart=null; }
  if (!portfolio.length) return;

  const days=90;
  const labels=Array.from({length:days},(_,i)=>{ const d=new Date(); d.setDate(d.getDate()-(days-1-i)); return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); });

  const tc=totalCost(), tv=totalValue();
  const portEndPct=tc?(tv-tc)/tc*100:0;
  const pfSeed=(portfolio.reduce((s,x)=>s+x.cost*x.shares,0)|0)^0xbeef;
  const spxEndPct=2.8+(seededRand(pfSeed^0xdead)()*2-1)*0.6; // realistic 90-day SPY move

  perfChart=new Chart(canvas,{
    type:'line',
    data:{ labels, datasets:[
      { label:'Your Portfolio',
        data:buildCurve(days,portEndPct,pfSeed),
        borderColor:'#20c9d4',
        backgroundColor:ctx=>{ const g=ctx.chart.ctx.createLinearGradient(0,0,0,230); g.addColorStop(0,'#20c9d420'); g.addColorStop(1,'#20c9d400'); return g; },
        fill:true, tension:.4, pointRadius:0, borderWidth:2 },
      { label:'S&P 500',
        data:buildCurve(days,spxEndPct,pfSeed^0x1234),
        borderColor:'rgba(255,255,255,0.28)',
        backgroundColor:'transparent',
        tension:.4, pointRadius:0, borderWidth:1.5, borderDash:[5,5] }
    ]},
    options:{
      responsive:true, maintainAspectRatio:false, animation:{duration:700},
      interaction:{intersect:false,mode:'index'},
      plugins:{
        legend:{ display:true, labels:{ color:'rgba(255,255,255,0.40)', boxWidth:12, padding:16, font:{size:11} } },
        tooltip:{ backgroundColor:'rgba(13,13,16,.97)', borderColor:'rgba(255,255,255,.08)', borderWidth:1,
          callbacks:{ label:ctx=>` ${ctx.dataset.label}: ${ctx.raw>=0?'+':''}${fmt(ctx.raw)}%` } }
      },
      scales:{
        x:{ grid:{color:'rgba(255,255,255,0.03)'}, ticks:{color:'rgba(255,255,255,0.25)',maxTicksLimit:7,font:{size:10}} },
        y:{ grid:{color:'rgba(255,255,255,0.03)'}, ticks:{color:'rgba(255,255,255,0.25)',font:{size:10},callback:v=>(v>=0?'+':'')+v+'%'} }
      }
    }
  });
}

function buildCurve(len,endPct,seed=1) {
  const rand=seededRand(seed), pts=[0];
  for (let i=1;i<len;i++) {
    const t=endPct*(i/(len-1));
    pts.push(+(t+(rand()-.48)*Math.abs(endPct)*.26).toFixed(2));
  }
  pts[len-1]=+endPct.toFixed(2); return pts;
}

function renderDonut() {
  const canvas=document.getElementById('donut-chart');
  const legend=document.getElementById('donut-legend');
  if (!canvas||!portfolio.length) return;
  if (donutChart) { donutChart.destroy(); donutChart=null; }

  const tv=totalValue();
  const colors=portfolio.map((_,i)=>PALETTE[i%PALETTE.length]);

  donutChart=new Chart(canvas,{
    type:'doughnut',
    data:{ labels:portfolio.map(s=>s.ticker), datasets:[{
      data:portfolio.map(s=>stockValue(s)),
      backgroundColor:colors.map(c=>c+'bb'), borderColor:colors, borderWidth:1.5, hoverOffset:5
    }]},
    options:{ cutout:'68%', responsive:false, animation:{animateRotate:true,duration:700},
      plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:ctx=>` ${fmtUSD(ctx.raw)} (${((ctx.raw/tv)*100).toFixed(1)}%)` } } } }
  });

  legend.innerHTML=portfolio.map((s,i)=>`
    <div class="legend-item">
      <div class="legend-dot" style="background:${PALETTE[i%PALETTE.length]}"></div>
      <span class="legend-name">${s.ticker}</span>
      <span class="legend-pct">${((stockValue(s)/tv)*100).toFixed(1)}%</span>
    </div>`).join('');
}

function renderBarChart() {
  const canvas=document.getElementById('bar-chart'); if (!canvas||!portfolio.length) return;
  if (barChart) { barChart.destroy(); barChart=null; }

  barChart=new Chart(canvas,{
    type:'bar',
    data:{ labels:portfolio.map(s=>s.ticker), datasets:[{
      label:'Gain / Loss ($)',
      data:portfolio.map(s=>+stockGain(s).toFixed(2)),
      backgroundColor:portfolio.map(s=>stockGain(s)>=0?'rgba(16,185,129,0.65)':'rgba(239,68,68,0.65)'),
      borderColor:portfolio.map(s=>stockGain(s)>=0?'#10b981':'#ef4444'),
      borderWidth:1.5, borderRadius:5
    }]},
    options:{
      responsive:true, maintainAspectRatio:false, animation:{duration:550},
      plugins:{ legend:{display:false}, tooltip:{ backgroundColor:'rgba(13,13,16,.97)', borderColor:'rgba(255,255,255,.08)', borderWidth:1,
        callbacks:{ label:ctx=>` ${fmtUSD(ctx.raw)}` } } },
      scales:{
        x:{ grid:{display:false}, ticks:{color:'rgba(255,255,255,0.30)',font:{size:10}} },
        y:{ grid:{color:'rgba(255,255,255,0.03)'}, ticks:{color:'rgba(255,255,255,0.25)',font:{size:10},callback:v=>fmtUSD(v)} }
      }
    }
  });
}

// ── News ──────────────────────────────────────────────────────────────────────
async function loadNews() {
  loadMarketNews();
  loadPortfolioNews();
}

async function loadMarketNews() {
  const el=document.getElementById('market-news-feed');
  try {
    const articles=await fetchMarketNews();
    renderNewsFeed(el, articles.slice(0,10), null);
  } catch { el.innerHTML='<div class="data-unavailable">Market news unavailable</div>'; }
}

async function loadPortfolioNews() {
  const el=document.getElementById('portfolio-news-feed');
  if (!portfolio.length) { el.innerHTML='<div class="data-unavailable">Add stocks to see company news</div>'; return; }
  try {
    const results=await Promise.allSettled(portfolio.map(s=>fetchNewsFor(s.ticker).then(arr=>arr.map(a=>({...a,_ticker:s.ticker})))));
    const all=results.filter(r=>r.status==='fulfilled').flatMap(r=>r.value)
      .sort((a,b)=>b.datetime-a.datetime).slice(0,12);
    renderNewsFeed(el, all, '_ticker');
  } catch { el.innerHTML='<div class="data-unavailable">Portfolio news unavailable</div>'; }
}

function renderNewsFeed(el, articles, tickerProp) {
  if (!articles?.length) { el.innerHTML='<div class="data-unavailable">No recent news</div>'; return; }
  el.innerHTML=articles.map(a=>`
    <a class="news-card-item" href="${escHtml(a.url||'#')}" target="_blank" rel="noopener noreferrer">
      ${a.image
        ?`<img class="news-card-img" src="${escHtml(a.image)}" alt="" loading="lazy" onerror="this.style.display='none'">`
        :`<div class="news-card-img-ph">📰</div>`}
      <div class="news-card-body">
        <div class="news-card-meta">
          <span class="news-card-source">${escHtml(a.source||'')}</span>
          <span class="news-card-date">${a.datetime?new Date(a.datetime*1000).toLocaleDateString('en-US',{month:'short',day:'numeric'}):''}</span>
          ${tickerProp&&a[tickerProp]?`<span class="news-card-ticker">${escHtml(a[tickerProp])}</span>`:''}
        </div>
        <div class="news-card-headline">${escHtml(a.headline||a.summary||'')}</div>
      </div>
    </a>`).join('');
}

// ── Detail Modal ──────────────────────────────────────────────────────────────
async function openDetailModal(ticker) {
  detailTicker=ticker;
  const stock=portfolio.find(s=>s.ticker===ticker); if (!stock) return;

  document.getElementById('detail-modal').classList.remove('hidden');
  document.body.style.overflow='hidden';
  document.querySelectorAll('.range-btn').forEach(b=>b.classList.toggle('active',b.dataset.range==='D'));

  renderDetailHeader(stock);
  document.getElementById('detail-chart-loading').style.display='flex';
  document.getElementById('detail-metrics').innerHTML='<div class="detail-section-label">Key Metrics</div><div class="data-unavailable">Loading…</div>';
  document.getElementById('detail-news').innerHTML='<div class="news-loading">Loading…</div>';

  await Promise.allSettled([loadDetailChart('D'), loadDetailMetrics(ticker), loadDetailNews(ticker)]);
}

function closeDetailModal() {
  document.getElementById('detail-modal').classList.add('hidden');
  document.body.style.overflow='';
  if (detailChart) { detailChart.destroy(); detailChart=null; }
  detailTicker=null;
}

function handleDetailOverlayClick(e) {
  if (e.target===document.getElementById('detail-modal')) closeDetailModal();
}

function renderDetailHeader(stock) {
  const gain=stockGain(stock), gainPct=stockGainPct(stock);
  const color=PALETTE[portfolio.indexOf(stock)%PALETTE.length];
  document.getElementById('detail-header').innerHTML=`
    <div class="detail-stock-info">
      <div class="detail-logo" style="background:${color}18;border-color:${color}40;color:${color}">${stock.ticker.slice(0,2)}</div>
      <div><div class="detail-ticker">${stock.ticker}</div><div class="detail-name">${stock.name||stock.ticker}</div></div>
      <div class="detail-price-block">
        <div class="detail-price">${stock.price?'$'+fmt(stock.price):'—'}</div>
        <div class="detail-day-change ${signCls(stock.changePct||0)}">${stock.change!=null?(stock.change>=0?'+':'')+fmtUSD(stock.change)+' ('+fmtPct(stock.changePct||0)+') today':''}</div>
      </div>
      <div class="detail-pnl-block">
        <div class="detail-pnl-label">Your P&amp;L</div>
        <div class="detail-pnl-value ${signCls(gain)}">${fmtUSD(gain)} (${fmtPct(gainPct)})</div>
      </div>
    </div>`;
}

async function loadDetailChart(range) {
  const loading=document.getElementById('detail-chart-loading');
  loading.style.display='flex';
  try {
    const {resolution,from,to}=rangeParams(range);
    const data=await fetchCandles(detailTicker, resolution, from, to);
    renderDetailChartFromData(data.c, data.t, range);
  } catch {
    // Genuine fallback: simulate based on current price
    const s=portfolio.find(x=>x.ticker===detailTicker);
    const len={D:48,W:56,M:35,'3M':95}[range]||35;
    const pts=buildCurve(len,s?.changePct||0,s?.cost||42).map(p=>+((s?.price||100)*(1+p/100)).toFixed(2));
    renderDetailChartFromData(pts, null, range);
  }
  loading.style.display='none';
}

function loadDetailRange(range, btn) {
  document.querySelectorAll('.range-btn').forEach(b=>b.classList.remove('active'));
  btn?.classList.add('active');
  loadDetailChart(range);
}

function renderDetailChartFromData(closes, timestamps, range) {
  const canvas=document.getElementById('detail-chart'); if (!canvas) return;
  if (detailChart) { detailChart.destroy(); detailChart=null; }

  const labels=timestamps
    ?timestamps.map(t=>{ const d=new Date(t*1000); return range==='D'||range==='W'?d.toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); })
    :closes.map((_,i)=>i);

  const up=closes[closes.length-1]>=closes[0];
  const color=up?'#10b981':'#ef4444';

  detailChart=new Chart(canvas,{
    type:'line',
    data:{ labels, datasets:[{ data:closes, borderColor:color,
      backgroundColor:ctx=>{ const g=ctx.chart.ctx.createLinearGradient(0,0,0,215); g.addColorStop(0,color+'28'); g.addColorStop(1,color+'00'); return g; },
      fill:true, tension:.3, pointRadius:0, pointHoverRadius:4, pointHoverBackgroundColor:color, borderWidth:2 }]},
    options:{
      responsive:true, maintainAspectRatio:false, animation:{duration:500},
      interaction:{intersect:false,mode:'index'},
      plugins:{ legend:{display:false}, tooltip:{ backgroundColor:'rgba(13,13,16,.97)', borderColor:'rgba(255,255,255,.08)', borderWidth:1,
        callbacks:{ title:i=>i[0].label, label:ctx=>` $${fmt(ctx.raw)}` } } },
      scales:{
        x:{ grid:{color:'rgba(255,255,255,.025)'}, ticks:{color:'rgba(255,255,255,.24)',maxTicksLimit:6,font:{size:9.5}} },
        y:{ position:'right', grid:{color:'rgba(255,255,255,.025)'}, ticks:{color:'rgba(255,255,255,.24)',font:{size:9.5},callback:v=>'$'+fmt(v)} }
      }
    }
  });
}

async function loadDetailMetrics(ticker) {
  const el=document.getElementById('detail-metrics');
  try {
    const {metric:m={}}=await fetchMetrics(ticker);
    const rows=[
      {label:'52W High',  value:m['52WeekHigh']?'$'+fmt(m['52WeekHigh']):'—'},
      {label:'52W Low',   value:m['52WeekLow']?'$'+fmt(m['52WeekLow']):'—'},
      {label:'P/E',       value:m['peAnnual']?fmt(m['peAnnual']):'—'},
      {label:'EPS',       value:m['epsAnnual']?'$'+fmt(m['epsAnnual']):'—'},
      {label:'Mkt Cap',   value:m['marketCapitalization']?fmtBig(m['marketCapitalization']*1e6):'—'},
      {label:'Beta',      value:m['beta']?fmt(m['beta']):'—'},
      {label:'Div Yield', value:m['dividendYieldIndicatedAnnual']?fmt(m['dividendYieldIndicatedAnnual'])+'%':'—'},
      {label:'Avg Vol',   value:m['10DayAverageTradingVolume']?fmtBig(m['10DayAverageTradingVolume']*1e6):'—'},
    ];
    el.innerHTML=`<div class="detail-section-label">Key Metrics</div><div class="metrics-grid">${rows.map(r=>`<div class="metric-item"><div class="metric-label">${r.label}</div><div class="metric-value">${r.value}</div></div>`).join('')}</div>`;
  } catch { el.innerHTML='<div class="detail-section-label">Key Metrics</div><div class="data-unavailable">Unavailable</div>'; }
}

async function loadDetailNews(ticker) {
  const el=document.getElementById('detail-news');
  try {
    const articles=await fetchNewsFor(ticker);
    if (!articles?.length) { el.innerHTML='<div class="data-unavailable">No recent news</div>'; return; }
    el.innerHTML=articles.slice(0,6).map(a=>`
      <a class="news-item" href="${escHtml(a.url)}" target="_blank" rel="noopener noreferrer">
        <div class="news-meta"><span class="news-source">${escHtml(a.source)}</span><span class="news-date">${new Date(a.datetime*1000).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span></div>
        <div class="news-headline">${escHtml(a.headline)}</div>
      </a>`).join('');
  } catch { el.innerHTML='<div class="data-unavailable">News unavailable</div>'; }
}

// ── Autocomplete ──────────────────────────────────────────────────────────────
let searchTimeout=null;
function setupAutocomplete() {
  const input=document.getElementById('new-ticker');
  const dd   =document.getElementById('ticker-dropdown');

  input.addEventListener('input',()=>{
    const q=input.value.trim(); clearTimeout(searchTimeout);
    if (!q) { dd.classList.add('hidden'); return; }
    searchTimeout=setTimeout(async()=>{
      try {
        const {result=[]}=await fetchSearch(q);
        const hits=result.filter(r=>r.type==='Common Stock'||r.type==='ETP').slice(0,7);
        if (!hits.length) { dd.classList.add('hidden'); return; }
        dd.innerHTML=hits.map(r=>`<div class="autocomplete-item" data-symbol="${r.symbol}" data-desc="${escHtml(r.description.slice(0,50))}"><span class="ac-symbol">${r.symbol}</span><span class="ac-desc">${escHtml(r.description.slice(0,50))}</span></div>`).join('');
        dd.classList.remove('hidden');
      } catch { dd.classList.add('hidden'); }
    },280);
  });

  dd.addEventListener('click',e=>{ const it=e.target.closest('.autocomplete-item'); if(it) selectTicker(it.dataset.symbol,it.dataset.desc); });
  document.addEventListener('click',e=>{ if(!e.target.closest('.ticker-autocomplete-wrap')) dd.classList.add('hidden'); });
}

function selectTicker(symbol,name) {
  document.getElementById('new-ticker').value=symbol;
  document.getElementById('ticker-dropdown').classList.add('hidden');
  if (!NAMES[symbol]) NAMES[symbol]=name;
  document.getElementById('new-shares').focus();
}

// ── AI Chat Engine ────────────────────────────────────────────────────────────
let chatExpanded = false;
let chatHistory = [];
let newsCache = new Map(); // ticker → { articles, fetchedAt }
const NEWS_CACHE_TTL = 10 * 60 * 1000;

// Sector classifications
const SECTORS = {
  Tech:     ['AAPL','MSFT','NVDA','GOOGL','AMZN','META','ADBE','CRM','AMD','INTC','NFLX','AVGO','QCOM','SHOP','SNOW','PLTR'],
  Finance:  ['JPM','V','MA','PYPL','COIN','GS','BAC','C','WFC','AXP','BLK','SCHW'],
  Health:   ['JNJ','UNH','LLY','ABBV','MRK','PFE','TMO','ABT','DHR','BMY'],
  Consumer: ['WMT','PG','KO','PEP','COST','MCD','HD','NKE','SBUX','TGT'],
  Energy:   ['XOM','CVX','COP','SLB','EOG','MPC','PSX','VLO','OXY','HAL'],
  EV:       ['TSLA','RIVN','LCID','NIO','LI','XPEV'],
  Gaming:   ['RBLX','EA','TTWO','ATVI','U'],
  ETF:      ['SPY','QQQ','GLD','TLT','IWM','VTI','VOO','DIA'],
};

function getSector(ticker) {
  for (const [sector, tickers] of Object.entries(SECTORS)) {
    if (tickers.includes(ticker)) return sector;
  }
  return 'Other';
}

// Sentiment keywords for news analysis
const POSITIVE_WORDS = ['surge','soar','rally','gain','beat','record','strong','growth','upgrade','outperform','bullish','positive','profit','revenue beat','raise','optimistic','breakthrough','innovation','expand','acquisition','approval'];
const NEGATIVE_WORDS = ['crash','plunge','drop','fall','miss','weak','decline','downgrade','underperform','bearish','negative','loss','layoff','lawsuit','investigation','warning','risk','recession','concern','sell-off','cut','slowdown'];

function analyzeSentiment(text) {
  if (!text) return { score: 0, label: 'Neutral' };
  const lower = text.toLowerCase();
  let pos = 0, neg = 0;
  POSITIVE_WORDS.forEach(w => { if (lower.includes(w)) pos++; });
  NEGATIVE_WORDS.forEach(w => { if (lower.includes(w)) neg++; });
  const total = pos + neg;
  if (total === 0) return { score: 0, label: 'Neutral', color: 'var(--text-2)' };
  const score = ((pos - neg) / total * 100);
  if (score > 25) return { score: +score.toFixed(0), label: 'Bullish', color: 'var(--green)' };
  if (score < -25) return { score: +score.toFixed(0), label: 'Bearish', color: 'var(--red)' };
  return { score: +score.toFixed(0), label: 'Mixed', color: 'var(--amber)' };
}

async function getCachedNews(ticker) {
  const cached = newsCache.get(ticker);
  if (cached && Date.now() - cached.fetchedAt < NEWS_CACHE_TTL) return cached.articles;
  try {
    const articles = await fetchNewsFor(ticker);
    newsCache.set(ticker, { articles, fetchedAt: Date.now() });
    return articles;
  } catch { return []; }
}

function toggleChatExpand() {
  chatExpanded = !chatExpanded;
  document.getElementById('ai-chat-panel').classList.toggle('expanded', chatExpanded);
  const btn = document.getElementById('ai-chat-toggle');
  btn.innerHTML = chatExpanded
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 7L7 17M7 17H17M7 17V7"/></svg>'
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17L17 7M17 7H7M17 7V17"/></svg>';
}

function clearChat() {
  chatHistory = [];
  const el = document.getElementById('ai-chat-messages');
  el.innerHTML = `
    <div class="ai-welcome-msg">
      <div class="ai-welcome-icon">✦</div>
      <div class="ai-welcome-title">Ask me anything about your portfolio</div>
      <div class="ai-welcome-sub">I analyze your holdings, market sentiment, and financial metrics in real-time.</div>
    </div>`;
  document.getElementById('ai-suggestions').style.display = '';
}

function askSuggestion(btn) {
  const q = btn.dataset.q;
  document.getElementById('ai-chat-input').value = q;
  sendChatMessage();
}

function addUserMessage(text) {
  const el = document.getElementById('ai-chat-messages');
  document.getElementById('ai-suggestions').style.display = 'none';
  const welcome = el.querySelector('.ai-welcome-msg');
  if (welcome) welcome.remove();

  const msg = document.createElement('div');
  msg.className = 'ai-msg ai-msg-user';
  msg.innerHTML = `<div class="ai-msg-bubble user">${escHtml(text)}</div>`;
  el.appendChild(msg);
  el.scrollTop = el.scrollHeight;
}

function addAiMessage(html, sources) {
  const el = document.getElementById('ai-chat-messages');
  const msg = document.createElement('div');
  msg.className = 'ai-msg ai-msg-ai';

  let srcHtml = '';
  if (sources && sources.length) {
    srcHtml = `<div class="ai-sources"><div class="ai-sources-label">Sources</div>${sources.map(s =>
      `<a class="ai-source-chip" href="${escHtml(s.url)}" target="_blank" rel="noopener noreferrer"><span class="ai-source-icon">📄</span>${escHtml(s.name)}</a>`
    ).join('')}</div>`;
  }

  msg.innerHTML = `
    <div class="ai-msg-avatar">✦</div>
    <div class="ai-msg-bubble ai">
      <div class="ai-msg-content">${html}</div>
      ${srcHtml}
    </div>`;
  el.appendChild(msg);

  // Animate typing effect
  const content = msg.querySelector('.ai-msg-content');
  content.style.opacity = '0';
  requestAnimationFrame(() => {
    content.style.transition = 'opacity 0.3s ease';
    content.style.opacity = '1';
  });

  el.scrollTop = el.scrollHeight;
}

function addLoadingMessage() {
  const el = document.getElementById('ai-chat-messages');
  const msg = document.createElement('div');
  msg.className = 'ai-msg ai-msg-ai ai-loading-msg';
  msg.innerHTML = `
    <div class="ai-msg-avatar">✦</div>
    <div class="ai-msg-bubble ai">
      <div class="ai-typing">
        <span></span><span></span><span></span>
        <span class="ai-typing-text">Analyzing...</span>
      </div>
    </div>`;
  el.appendChild(msg);
  el.scrollTop = el.scrollHeight;
  return msg;
}

function removeLoadingMessage() {
  const msg = document.querySelector('.ai-loading-msg');
  if (msg) msg.remove();
}

async function sendChatMessage() {
  const input = document.getElementById('ai-chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  addUserMessage(text);

  if (!chatExpanded) {
    chatExpanded = true;
    document.getElementById('ai-chat-panel').classList.add('expanded');
    document.getElementById('ai-chat-toggle').innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 7L7 17M7 17H17M7 17V7"/></svg>';
  }

  const loading = addLoadingMessage();
  await new Promise(r => setTimeout(r, 600 + Math.random() * 800));

  const response = await generateAiResponse(text);
  removeLoadingMessage();
  addAiMessage(response.html, response.sources);

  chatHistory.push({ role: 'user', text });
  chatHistory.push({ role: 'ai', text: response.html });
}

// Main AI response router
async function generateAiResponse(query) {
  const q = query.toLowerCase();

  if (q.includes('portfolio') && (q.includes('perform') || q.includes('how') || q.includes('doing') || q.includes('summary') || q.includes('overview')))
    return generatePortfolioAnalysis();

  if (q.includes('sentiment') || q.includes('feeling') || q.includes('mood') || q.includes('outlook'))
    return await generateSentimentAnalysis(q);

  if (q.includes('diversif') || q.includes('risk') || q.includes('allocation') || q.includes('concentrate'))
    return generateDiversificationAnalysis();

  if (q.includes('top mover') || q.includes('best') || q.includes('worst') || q.includes('winner') || q.includes('loser'))
    return generateTopMovers();

  if (q.includes('compare') || q.includes(' vs ') || q.includes('versus'))
    return generateComparison(q);

  if (q.includes('news') || q.includes('headline') || q.includes('latest'))
    return await generateNewsDigest(q);

  // Check if asking about a specific stock
  const tickerMatch = findTickerInQuery(q);
  if (tickerMatch) return await generateStockAnalysis(tickerMatch);

  if (q.includes('buy') || q.includes('sell') || q.includes('hold') || q.includes('recommend'))
    return generateDisclaimer();

  if (q.includes('sector') || q.includes('industry') || q.includes('exposure'))
    return generateSectorAnalysis();

  if (q.includes('gain') || q.includes('loss') || q.includes('profit') || q.includes('return'))
    return generateGainLossReport();

  // Default: general portfolio analysis
  return generatePortfolioAnalysis();
}

function findTickerInQuery(q) {
  // Check portfolio tickers first
  for (const s of portfolio) {
    if (q.includes(s.ticker.toLowerCase()) || q.includes((s.name || '').toLowerCase())) return s.ticker;
  }
  // Check known tickers
  for (const [ticker, name] of Object.entries(NAMES)) {
    if (q.includes(ticker.toLowerCase()) || q.includes(name.toLowerCase())) return ticker;
  }
  return null;
}

function generatePortfolioAnalysis() {
  if (!portfolio.length) return { html: '<p>Your portfolio is empty. Add stocks to get personalized analysis.</p>', sources: [] };

  const tv = totalValue(), tc = totalCost(), gain = tv - tc, gainPct = tc ? (gain / tc) * 100 : 0;
  const dg = totalDayGain();
  const sorted = [...portfolio].sort((a, b) => stockGainPct(b) - stockGainPct(a));
  const best = sorted[0], worst = sorted[sorted.length - 1];

  // Sector breakdown
  const sectorMap = {};
  portfolio.forEach(s => { const sec = getSector(s.ticker); sectorMap[sec] = (sectorMap[sec] || 0) + stockValue(s); });
  const topSector = Object.entries(sectorMap).sort((a, b) => b[1] - a[1])[0];

  let verdict = '';
  if (gainPct > 20) verdict = 'Your portfolio is significantly outperforming. Consider taking some profits on your biggest winners.';
  else if (gainPct > 10) verdict = 'Strong performance across your holdings. The portfolio is well-positioned.';
  else if (gainPct > 0) verdict = 'Moderate positive returns. Consider adding to positions that align with your thesis.';
  else if (gainPct > -5) verdict = 'Slightly negative returns. Typical market fluctuation — stay the course if your thesis is intact.';
  else verdict = 'Portfolio under pressure. Review individual positions for any fundamental changes.';

  const html = `
    <div class="ai-response-section">
      <div class="ai-section-title">Portfolio Overview</div>
      <div class="ai-metrics-row">
        <div class="ai-metric">
          <div class="ai-metric-label">Total Value</div>
          <div class="ai-metric-value">${fmtUSD(tv)}</div>
        </div>
        <div class="ai-metric">
          <div class="ai-metric-label">Total Return</div>
          <div class="ai-metric-value ${signCls(gain)}">${fmtUSD(gain)} (${fmtPct(gainPct)})</div>
        </div>
        <div class="ai-metric">
          <div class="ai-metric-label">Today</div>
          <div class="ai-metric-value ${signCls(dg)}">${fmtUSD(dg)}</div>
        </div>
      </div>
    </div>
    <div class="ai-response-section">
      <div class="ai-section-title">Key Findings</div>
      <div class="ai-finding"><span class="ai-finding-icon ${signCls(stockGainPct(best))}">▲</span> <strong>${best.ticker}</strong> is your top performer at <span class="${signCls(stockGainPct(best))}">${fmtPct(stockGainPct(best))}</span></div>
      <div class="ai-finding"><span class="ai-finding-icon ${signCls(stockGainPct(worst))}">▼</span> <strong>${worst.ticker}</strong> is lagging at <span class="${signCls(stockGainPct(worst))}">${fmtPct(stockGainPct(worst))}</span></div>
      <div class="ai-finding"><span class="ai-finding-icon neu">◆</span> Heaviest sector: <strong>${topSector[0]}</strong> at ${((topSector[1] / tv) * 100).toFixed(1)}% allocation</div>
      <div class="ai-finding"><span class="ai-finding-icon neu">◆</span> ${portfolio.length} position${portfolio.length > 1 ? 's' : ''} across ${Object.keys(sectorMap).length} sector${Object.keys(sectorMap).length > 1 ? 's' : ''}</div>
    </div>
    <div class="ai-response-section">
      <div class="ai-verdict">${verdict}</div>
    </div>`;

  return { html, sources: [] };
}

async function generateSentimentAnalysis(q) {
  if (!portfolio.length) return { html: '<p>Add stocks to get sentiment analysis.</p>', sources: [] };

  const tickerMatch = findTickerInQuery(q);
  const tickers = tickerMatch ? [tickerMatch] : portfolio.map(s => s.ticker);

  const results = [];
  const sources = [];

  for (const ticker of tickers.slice(0, 5)) {
    const articles = await getCachedNews(ticker);
    const headlines = articles.slice(0, 8);
    const sentiments = headlines.map(a => analyzeSentiment(a.headline + ' ' + (a.summary || '')));
    const avgScore = sentiments.length ? sentiments.reduce((s, x) => s + x.score, 0) / sentiments.length : 0;
    const overall = avgScore > 20 ? { label: 'Bullish', color: 'var(--green)' }
      : avgScore < -20 ? { label: 'Bearish', color: 'var(--red)' }
      : { label: 'Neutral', color: 'var(--amber)' };

    results.push({ ticker, score: avgScore, label: overall.label, color: overall.color, count: headlines.length, articles: headlines.slice(0, 3) });
    headlines.slice(0, 2).forEach(a => { if (a.url) sources.push({ name: a.source || ticker, url: a.url }); });
  }

  const html = `
    <div class="ai-response-section">
      <div class="ai-section-title">Sentiment Analysis</div>
      <p class="ai-response-text">Based on ${results.reduce((s, r) => s + r.count, 0)} recent news articles across ${results.length} stock${results.length > 1 ? 's' : ''}:</p>
      <div class="ai-sentiment-grid">
        ${results.map(r => `
          <div class="ai-sentiment-card">
            <div class="ai-sentiment-header">
              <strong>${r.ticker}</strong>
              <span class="ai-sentiment-badge" style="color:${r.color};border-color:${r.color}30;background:${r.color}12">${r.label}</span>
            </div>
            <div class="ai-sentiment-bar-wrap">
              <div class="ai-sentiment-bar">
                <div class="ai-sentiment-fill" style="width:${Math.min(100, Math.max(5, 50 + r.score / 2))}%;background:${r.color}"></div>
              </div>
              <span class="ai-sentiment-score">${r.score > 0 ? '+' : ''}${r.score.toFixed(0)}</span>
            </div>
            ${r.articles.length ? `<div class="ai-sentiment-headlines">${r.articles.map(a =>
              `<div class="ai-headline-item">
                <span class="ai-headline-dot" style="background:${analyzeSentiment(a.headline).color}"></span>
                ${escHtml((a.headline || '').slice(0, 80))}${(a.headline || '').length > 80 ? '…' : ''}
              </div>`).join('')}</div>` : ''}
          </div>`).join('')}
      </div>
    </div>`;

  return { html, sources: sources.slice(0, 6) };
}

function generateDiversificationAnalysis() {
  if (!portfolio.length) return { html: '<p>Add stocks to analyze diversification.</p>', sources: [] };

  const tv = totalValue();
  const sectorMap = {};
  portfolio.forEach(s => {
    const sec = getSector(s.ticker);
    if (!sectorMap[sec]) sectorMap[sec] = { value: 0, stocks: [] };
    sectorMap[sec].value += stockValue(s);
    sectorMap[sec].stocks.push(s.ticker);
  });

  const sortedSectors = Object.entries(sectorMap).sort((a, b) => b[1].value - a[1].value);
  const topPct = (sortedSectors[0][1].value / tv * 100);
  const hhi = sortedSectors.reduce((s, [, d]) => s + Math.pow(d.value / tv * 100, 2), 0);

  let riskLevel, riskColor, advice;
  if (hhi > 5000) { riskLevel = 'High Concentration'; riskColor = 'var(--red)'; advice = 'Your portfolio is heavily concentrated. Consider adding positions in underrepresented sectors to reduce idiosyncratic risk.'; }
  else if (hhi > 2500) { riskLevel = 'Moderate'; riskColor = 'var(--amber)'; advice = 'Decent diversification but room for improvement. Consider adding exposure to sectors you\'re missing.'; }
  else { riskLevel = 'Well Diversified'; riskColor = 'var(--green)'; advice = 'Good sector spread. Your portfolio is reasonably protected against sector-specific downturns.'; }

  const missingSectors = Object.keys(SECTORS).filter(s => !sectorMap[s] && s !== 'ETF');

  const html = `
    <div class="ai-response-section">
      <div class="ai-section-title">Diversification Analysis</div>
      <div class="ai-metrics-row">
        <div class="ai-metric">
          <div class="ai-metric-label">Risk Level</div>
          <div class="ai-metric-value" style="color:${riskColor}">${riskLevel}</div>
        </div>
        <div class="ai-metric">
          <div class="ai-metric-label">Positions</div>
          <div class="ai-metric-value">${portfolio.length}</div>
        </div>
        <div class="ai-metric">
          <div class="ai-metric-label">Sectors</div>
          <div class="ai-metric-value">${sortedSectors.length}</div>
        </div>
      </div>
    </div>
    <div class="ai-response-section">
      <div class="ai-section-title">Sector Breakdown</div>
      ${sortedSectors.map(([sector, data]) => `
        <div class="ai-alloc-row">
          <span class="ai-alloc-name">${sector}</span>
          <span class="ai-alloc-tickers">${data.stocks.join(', ')}</span>
          <div class="ai-alloc-bar"><div class="ai-alloc-fill" style="width:${(data.value / tv * 100).toFixed(1)}%;background:${topPct > 60 && sector === sortedSectors[0][0] ? 'var(--red)' : 'var(--teal)'}"></div></div>
          <span class="ai-alloc-pct">${(data.value / tv * 100).toFixed(1)}%</span>
        </div>`).join('')}
    </div>
    ${missingSectors.length ? `<div class="ai-response-section"><div class="ai-section-title">Missing Exposure</div><p class="ai-response-text">No exposure to: <strong>${missingSectors.join(', ')}</strong></p></div>` : ''}
    <div class="ai-response-section">
      <div class="ai-verdict">${advice}</div>
    </div>`;

  return { html, sources: [] };
}

function generateTopMovers() {
  if (!portfolio.length) return { html: '<p>Add stocks to see movers.</p>', sources: [] };

  const sorted = [...portfolio].filter(s => s.changePct != null).sort((a, b) => (b.changePct || 0) - (a.changePct || 0));
  const gainers = sorted.filter(s => (s.changePct || 0) > 0);
  const losers = [...sorted].reverse().filter(s => (s.changePct || 0) < 0);
  const dg = totalDayGain();

  const html = `
    <div class="ai-response-section">
      <div class="ai-section-title">Today's Movers</div>
      <div class="ai-metrics-row">
        <div class="ai-metric">
          <div class="ai-metric-label">Day's P&L</div>
          <div class="ai-metric-value ${signCls(dg)}">${fmtUSD(dg)}</div>
        </div>
        <div class="ai-metric">
          <div class="ai-metric-label">Gainers</div>
          <div class="ai-metric-value pos">${gainers.length}</div>
        </div>
        <div class="ai-metric">
          <div class="ai-metric-label">Losers</div>
          <div class="ai-metric-value neg">${losers.length}</div>
        </div>
      </div>
    </div>
    ${gainers.length ? `<div class="ai-response-section">
      <div class="ai-section-title">Top Gainers</div>
      ${gainers.slice(0, 5).map(s => `
        <div class="ai-mover-row">
          <strong>${s.ticker}</strong>
          <span class="ai-mover-name">${s.name || s.ticker}</span>
          <span class="ai-mover-price">$${fmt(s.price)}</span>
          <span class="ai-mover-change pos">${fmtPct(s.changePct)}</span>
        </div>`).join('')}
    </div>` : ''}
    ${losers.length ? `<div class="ai-response-section">
      <div class="ai-section-title">Top Losers</div>
      ${losers.slice(0, 5).map(s => `
        <div class="ai-mover-row">
          <strong>${s.ticker}</strong>
          <span class="ai-mover-name">${s.name || s.ticker}</span>
          <span class="ai-mover-price">$${fmt(s.price)}</span>
          <span class="ai-mover-change neg">${fmtPct(s.changePct)}</span>
        </div>`).join('')}
    </div>` : ''}`;

  return { html, sources: [] };
}

async function generateStockAnalysis(ticker) {
  const stock = portfolio.find(s => s.ticker === ticker);
  const articles = await getCachedNews(ticker);
  const sentiments = articles.slice(0, 10).map(a => analyzeSentiment(a.headline + ' ' + (a.summary || '')));
  const avgSent = sentiments.length ? sentiments.reduce((s, x) => s + x.score, 0) / sentiments.length : 0;
  const sentLabel = avgSent > 20 ? 'Bullish' : avgSent < -20 ? 'Bearish' : 'Neutral';
  const sentColor = avgSent > 20 ? 'var(--green)' : avgSent < -20 ? 'var(--red)' : 'var(--amber)';

  const sources = articles.slice(0, 4).filter(a => a.url).map(a => ({ name: a.source || ticker, url: a.url }));

  let metricsHtml = '';
  try {
    const { metric: m = {} } = await fetchMetrics(ticker);
    metricsHtml = `
      <div class="ai-response-section">
        <div class="ai-section-title">Key Metrics</div>
        <div class="ai-metrics-row">
          ${m['peAnnual'] ? `<div class="ai-metric"><div class="ai-metric-label">P/E Ratio</div><div class="ai-metric-value">${fmt(m['peAnnual'])}</div></div>` : ''}
          ${m['epsAnnual'] ? `<div class="ai-metric"><div class="ai-metric-label">EPS</div><div class="ai-metric-value">$${fmt(m['epsAnnual'])}</div></div>` : ''}
          ${m['marketCapitalization'] ? `<div class="ai-metric"><div class="ai-metric-label">Market Cap</div><div class="ai-metric-value">${fmtBig(m['marketCapitalization'] * 1e6)}</div></div>` : ''}
          ${m['beta'] ? `<div class="ai-metric"><div class="ai-metric-label">Beta</div><div class="ai-metric-value">${fmt(m['beta'])}</div></div>` : ''}
          ${m['52WeekHigh'] ? `<div class="ai-metric"><div class="ai-metric-label">52W High</div><div class="ai-metric-value">$${fmt(m['52WeekHigh'])}</div></div>` : ''}
          ${m['52WeekLow'] ? `<div class="ai-metric"><div class="ai-metric-label">52W Low</div><div class="ai-metric-value">$${fmt(m['52WeekLow'])}</div></div>` : ''}
        </div>
      </div>`;
  } catch {}

  const html = `
    <div class="ai-response-section">
      <div class="ai-section-title">${ticker} — ${NAMES[ticker] || ticker}</div>
      <div class="ai-metrics-row">
        ${stock ? `<div class="ai-metric"><div class="ai-metric-label">Price</div><div class="ai-metric-value">$${fmt(stock.price)}</div></div>` : ''}
        ${stock ? `<div class="ai-metric"><div class="ai-metric-label">Today</div><div class="ai-metric-value ${signCls(stock.changePct)}">${fmtPct(stock.changePct || 0)}</div></div>` : ''}
        ${stock ? `<div class="ai-metric"><div class="ai-metric-label">Your P&L</div><div class="ai-metric-value ${signCls(stockGain(stock))}">${fmtUSD(stockGain(stock))}</div></div>` : ''}
        <div class="ai-metric">
          <div class="ai-metric-label">Sentiment</div>
          <div class="ai-metric-value" style="color:${sentColor}">${sentLabel}</div>
        </div>
      </div>
    </div>
    ${metricsHtml}
    ${articles.length ? `
    <div class="ai-response-section">
      <div class="ai-section-title">Recent Headlines</div>
      ${articles.slice(0, 5).map(a => {
        const s = analyzeSentiment(a.headline);
        return `<div class="ai-headline-item">
          <span class="ai-headline-dot" style="background:${s.color}"></span>
          ${escHtml((a.headline || '').slice(0, 100))}
        </div>`;
      }).join('')}
    </div>` : ''}
    ${stock ? `<div class="ai-response-section"><div class="ai-verdict">
      ${stockGainPct(stock) > 15 ? `${ticker} is a strong performer in your portfolio at ${fmtPct(stockGainPct(stock))}. News sentiment is ${sentLabel.toLowerCase()}.`
        : stockGainPct(stock) < -10 ? `${ticker} is underperforming at ${fmtPct(stockGainPct(stock))}. News sentiment is ${sentLabel.toLowerCase()}. Monitor for fundamental changes.`
        : `${ticker} shows moderate returns at ${fmtPct(stockGainPct(stock))}. News sentiment is ${sentLabel.toLowerCase()}.`}
    </div></div>` : ''}`;

  return { html, sources };
}

function generateSectorAnalysis() {
  if (!portfolio.length) return { html: '<p>Add stocks to see sector analysis.</p>', sources: [] };

  const tv = totalValue();
  const sectorMap = {};
  portfolio.forEach(s => {
    const sec = getSector(s.ticker);
    if (!sectorMap[sec]) sectorMap[sec] = { value: 0, dayGain: 0, stocks: [] };
    sectorMap[sec].value += stockValue(s);
    sectorMap[sec].dayGain += (s.change || 0) * s.shares;
    sectorMap[sec].stocks.push(s);
  });

  const sortedSectors = Object.entries(sectorMap).sort((a, b) => b[1].value - a[1].value);

  const html = `
    <div class="ai-response-section">
      <div class="ai-section-title">Sector Exposure</div>
      ${sortedSectors.map(([sector, data]) => `
        <div class="ai-sector-card">
          <div class="ai-sector-header">
            <strong>${sector}</strong>
            <span>${(data.value / tv * 100).toFixed(1)}% · ${fmtUSD(data.value)}</span>
          </div>
          <div class="ai-alloc-bar"><div class="ai-alloc-fill" style="width:${(data.value / tv * 100)}%;background:var(--teal)"></div></div>
          <div class="ai-sector-stocks">${data.stocks.map(s => `<span class="ai-sector-tag">${s.ticker} <span class="${signCls(s.changePct)}">${s.changePct != null ? fmtPct(s.changePct) : ''}</span></span>`).join('')}</div>
        </div>`).join('')}
    </div>`;

  return { html, sources: [] };
}

function generateGainLossReport() {
  if (!portfolio.length) return { html: '<p>Add stocks to see gain/loss report.</p>', sources: [] };

  const sorted = [...portfolio].sort((a, b) => stockGain(b) - stockGain(a));
  const totalG = totalValue() - totalCost();

  const html = `
    <div class="ai-response-section">
      <div class="ai-section-title">Gain / Loss Report</div>
      <div class="ai-metrics-row">
        <div class="ai-metric"><div class="ai-metric-label">Total Return</div><div class="ai-metric-value ${signCls(totalG)}">${fmtUSD(totalG)}</div></div>
        <div class="ai-metric"><div class="ai-metric-label">Invested</div><div class="ai-metric-value">${fmtUSD(totalCost())}</div></div>
      </div>
    </div>
    <div class="ai-response-section">
      <div class="ai-section-title">By Position</div>
      ${sorted.map(s => `
        <div class="ai-mover-row">
          <strong>${s.ticker}</strong>
          <span class="ai-mover-name">${fmtUSD(stockCost(s))} → ${fmtUSD(stockValue(s))}</span>
          <span class="ai-mover-change ${signCls(stockGain(s))}">${fmtUSD(stockGain(s))} (${fmtPct(stockGainPct(s))})</span>
        </div>`).join('')}
    </div>`;

  return { html, sources: [] };
}

function generateComparison(q) {
  // Try to find two tickers in the query
  const tickers = portfolio.map(s => s.ticker).filter(t => q.includes(t.toLowerCase()));
  if (tickers.length < 2) return { html: '<p>Mention two stocks from your portfolio to compare, e.g. "Compare AAPL vs MSFT".</p>', sources: [] };

  const [s1, s2] = [portfolio.find(s => s.ticker === tickers[0]), portfolio.find(s => s.ticker === tickers[1])];

  const html = `
    <div class="ai-response-section">
      <div class="ai-section-title">${s1.ticker} vs ${s2.ticker}</div>
      <table class="ai-compare-table">
        <tr><th></th><th>${s1.ticker}</th><th>${s2.ticker}</th></tr>
        <tr><td>Price</td><td>$${fmt(s1.price)}</td><td>$${fmt(s2.price)}</td></tr>
        <tr><td>Day Change</td><td class="${signCls(s1.changePct)}">${fmtPct(s1.changePct || 0)}</td><td class="${signCls(s2.changePct)}">${fmtPct(s2.changePct || 0)}</td></tr>
        <tr><td>Your Return</td><td class="${signCls(stockGainPct(s1))}">${fmtPct(stockGainPct(s1))}</td><td class="${signCls(stockGainPct(s2))}">${fmtPct(stockGainPct(s2))}</td></tr>
        <tr><td>Position Value</td><td>${fmtUSD(stockValue(s1))}</td><td>${fmtUSD(stockValue(s2))}</td></tr>
        <tr><td>P&L</td><td class="${signCls(stockGain(s1))}">${fmtUSD(stockGain(s1))}</td><td class="${signCls(stockGain(s2))}">${fmtUSD(stockGain(s2))}</td></tr>
        <tr><td>Allocation</td><td>${(stockValue(s1) / totalValue() * 100).toFixed(1)}%</td><td>${(stockValue(s2) / totalValue() * 100).toFixed(1)}%</td></tr>
      </table>
    </div>`;

  return { html, sources: [] };
}

async function generateNewsDigest(q) {
  const tickerMatch = findTickerInQuery(q);
  const tickers = tickerMatch ? [tickerMatch] : portfolio.map(s => s.ticker).slice(0, 3);

  let allArticles = [];
  for (const t of tickers) {
    const arts = await getCachedNews(t);
    allArticles.push(...arts.slice(0, 5).map(a => ({ ...a, _ticker: t })));
  }
  allArticles.sort((a, b) => (b.datetime || 0) - (a.datetime || 0));
  allArticles = allArticles.slice(0, 8);

  const sources = allArticles.filter(a => a.url).slice(0, 4).map(a => ({ name: a.source || 'News', url: a.url }));

  const html = `
    <div class="ai-response-section">
      <div class="ai-section-title">Latest News ${tickerMatch ? `for ${tickerMatch}` : 'for Your Portfolio'}</div>
      ${allArticles.map(a => {
        const s = analyzeSentiment(a.headline + ' ' + (a.summary || ''));
        return `
          <a class="ai-news-item" href="${escHtml(a.url || '#')}" target="_blank" rel="noopener noreferrer">
            <span class="ai-headline-dot" style="background:${s.color}"></span>
            <div class="ai-news-body">
              <div class="ai-news-meta">
                <span class="ai-news-source">${escHtml(a.source || '')}</span>
                <span class="ai-news-ticker">${a._ticker}</span>
                <span class="ai-sentiment-tag" style="color:${s.color}">${s.label}</span>
              </div>
              <div class="ai-news-headline">${escHtml(a.headline || '')}</div>
            </div>
          </a>`;
      }).join('')}
    </div>`;

  return { html, sources };
}

function generateDisclaimer() {
  return {
    html: `
      <div class="ai-response-section">
        <div class="ai-section-title">Important Disclaimer</div>
        <p class="ai-response-text">I provide data-driven analysis and sentiment scoring, but <strong>I cannot give buy, sell, or hold recommendations</strong>. Always do your own research and consult a licensed financial advisor before making investment decisions.</p>
        <p class="ai-response-text">Here's what I can help with:</p>
        <div class="ai-finding"><span class="ai-finding-icon neu">◆</span> Portfolio performance analysis</div>
        <div class="ai-finding"><span class="ai-finding-icon neu">◆</span> News sentiment scoring</div>
        <div class="ai-finding"><span class="ai-finding-icon neu">◆</span> Diversification insights</div>
        <div class="ai-finding"><span class="ai-finding-icon neu">◆</span> Stock comparisons & sector analysis</div>
      </div>`,
    sources: []
  };
}

// Legacy function — now auto-sends a welcome analysis
function generateAiInsight() {
  // Auto-generate initial insight as first chat message if chat is empty
  if (chatHistory.length === 0 && portfolio.length > 0) {
    const msgs = document.getElementById('ai-chat-messages');
    if (msgs && msgs.querySelector('.ai-welcome-msg')) {
      // Update welcome subtitle with live data
      const sub = msgs.querySelector('.ai-welcome-sub');
      if (sub) {
        const tv = totalValue(), tc = totalCost(), gain = tv - tc, gainPct = tc ? (gain / tc) * 100 : 0;
        sub.innerHTML = `Portfolio: <strong>${fmtUSD(tv)}</strong> · Return: <strong class="${signCls(gain)}">${fmtPct(gainPct)}</strong> · ${portfolio.length} position${portfolio.length > 1 ? 's' : ''}`;
      }
    }
  }
}

// Chat input enter key
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const input = document.getElementById('ai-chat-input');
    if (input) {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') sendChatMessage();
      });
    }
  }, 100);
});

// ── Market Status ─────────────────────────────────────────────────────────────
function setMarketStatus() {
  const ny=new Date(new Date().toLocaleString('en-US',{timeZone:'America/New_York'}));
  const m=ny.getHours()*60+ny.getMinutes(), d=ny.getDay();
  const el=document.getElementById('market-status'), dot=document.getElementById('market-dot');
  if (d===0||d===6) { el.textContent='Market Closed'; return; }
  if (m>=570&&m<960)    { el.textContent='Market Open';  dot.classList.add('live'); }
  else if (m>=240&&m<570){ el.textContent='Pre-Market';  dot.style.background='var(--amber)'; }
  else if (m>=960&&m<1200){ el.textContent='After Hours'; dot.style.background='var(--amber)'; }
  else { el.textContent='Market Closed'; }
}

function updateLastUpdated() {
  const el=document.getElementById('last-updated'); if(el) el.textContent='Updated '+new Date().toLocaleTimeString();
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function shake(el) {
  el.style.animation='none'; el.offsetHeight;
  el.style.animation='shake .36s ease';
  el.addEventListener('animationend',()=>el.style.animation='',{once:true});
}
const _kf=document.createElement('style');
_kf.textContent='@keyframes shake{0%,100%{transform:translateX(0)}25%,75%{transform:translateX(-5px)}50%{transform:translateX(5px)}}';
document.head.appendChild(_kf);

document.addEventListener('keydown',e=>{
  if (e.key==='Escape') { closeDetailModal(); ['add-stock-modal','api-modal','new-pf-modal'].forEach(id=>document.getElementById(id).classList.add('hidden')); }
  if (e.key==='Enter') {
    if (!document.getElementById('api-modal').classList.contains('hidden'))    saveApiKey();
    if (!document.getElementById('new-pf-modal').classList.contains('hidden')) confirmCreatePortfolio();
  }
});
document.addEventListener('input',e=>{ if(e.target.id==='new-ticker') e.target.value=e.target.value.toUpperCase(); });
