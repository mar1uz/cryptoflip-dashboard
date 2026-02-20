/**
 * memecoins.js — Solana Memecoins Dashboard
 * ==========================================
 * Data source: GeckoTerminal API (free, no key)
 * - Trending Solana pools: https://api.geckoterminal.com/api/v2/networks/solana/trending_pools
 * - OHLCV (1H): https://api.geckoterminal.com/api/v2/networks/solana/pools/{addr}/ohlcv/hour
 * Chart: DexScreener embedded iframe (https://dexscreener.com/solana/{pairAddress}?embed=1&theme=dark)
 */

/* ── CONSTANTS ─────────────────────────────────────────── */
const GT_BASE = 'https://api.geckoterminal.com/api/v2';
const EMA_FAST = 9;
const EMA_SLOW = 21;
const RSI_PERIOD = 14;
const RSI_BULL = 52;
const RSI_BEAR = 48;
const MAX_COINS = 20;   // top N trending pools to load

/* ── STATE ────────────────────────────────────────────── */
let allData = [];
let filtered = [];
let currentSignal = 'all';
let currentSearch = '';
let currentSort = 'trending'; // trending | volume | change | liq
let currentDSSymbol = '';

/* ── GECKO TERMINAL API ───────────────────────────────── */
async function fetchTrending() {
    // page=1 returns top ~20 trending pools on Solana
    const r = await fetch(`${GT_BASE}/networks/solana/trending_pools?page=1&duration=24h`);
    if (!r.ok) throw new Error(`GeckoTerminal ${r.status}`);
    const json = await r.json();
    return json.data || [];
}

async function fetchOHLCV(poolAddress) {
    // 1H candles, limit=100 (enough for EMA9/21 + RSI14 on 1H and approx 4H/1D)
    const url = `${GT_BASE}/networks/solana/pools/${poolAddress}/ohlcv/hour?aggregate=1&limit=100&currency=usd&token=base`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const json = await r.json();
    return json.data?.attributes?.ohlcv_list || null; // [[ts,o,h,l,c,v], ...]
}

/* ── INDICATORS ───────────────────────────────────────── */
function calcEMA(closes, period) {
    if (closes.length < period) return null;
    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
    for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
    return ema;
}

function calcRSI(closes, period = RSI_PERIOD) {
    if (closes.length < period + 1) return null;
    let ag = 0, al = 0;
    for (let i = 1; i <= period; i++) {
        const d = closes[i] - closes[i - 1];
        if (d > 0) ag += d; else al += Math.abs(d);
    }
    ag /= period; al /= period;
    for (let i = period + 1; i < closes.length; i++) {
        const d = closes[i] - closes[i - 1];
        ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period;
        al = (al * (period - 1) + (d < 0 ? Math.abs(d) : 0)) / period;
    }
    return al === 0 ? 100 : 100 - (100 / (1 + ag / al));
}

function getSignal(closes1h) {
    if (!closes1h || closes1h.length < EMA_SLOW + 1) {
        return { signal: 'neutral', confirmed: false, ema9: null, ema21: null, diff: null, rsi: null, reason: 'date insuficiente' };
    }
    const ema9 = calcEMA(closes1h, EMA_FAST);
    const ema21 = calcEMA(closes1h, EMA_SLOW);
    const rsi = calcRSI(closes1h, RSI_PERIOD);
    if (!ema9 || !ema21) return { signal: 'neutral', confirmed: false, ema9: null, ema21: null, diff: null, rsi, reason: 'date insuficiente' };
    const diff = ((ema9 - ema21) / ema21) * 100;
    const signal = ema9 > ema21 ? 'bullish' : 'bearish';
    let confirmed = false, reason = '';
    if (signal === 'bullish') {
        confirmed = rsi ? rsi > RSI_BULL : false;
        reason = rsi ? (confirmed ? `RSI ${rsi.toFixed(1)} > ${RSI_BULL}` : `RSI ${rsi.toFixed(1)} sub ${RSI_BULL} (fals?)`) : 'fără RSI';
    } else {
        confirmed = rsi ? rsi < RSI_BEAR : false;
        reason = rsi ? (confirmed ? `RSI ${rsi.toFixed(1)} < ${RSI_BEAR}` : `RSI ${rsi.toFixed(1)} peste ${RSI_BEAR} (fals?)`) : 'fără RSI';
    }
    return { signal, confirmed, ema9, ema21, diff, rsi, reason };
}

/* ── ANALYZE POOL ─────────────────────────────────────── */
async function analyzePool(pool) {
    const attr = pool.attributes;
    const paddr = attr.address;
    const name = attr.name.split(' / ')[0]; // "BONK / SOL" → "BONK"

    // The pool relationships give us the base token id
    const baseTokenId = pool.relationships?.base_token?.data?.id?.replace('solana_', '') || '';

    let closes1h = null;
    try {
        const ohlcv = await fetchOHLCV(paddr);
        if (ohlcv && ohlcv.length > EMA_SLOW) {
            closes1h = ohlcv.map(c => c[4]); // index 4 = close
        }
    } catch { }

    const sig1h = getSignal(closes1h);

    // Approximate 4H: sample every 4th close
    let sig4h = { signal: 'neutral', confirmed: false, rsi: null };
    if (closes1h && closes1h.length >= EMA_SLOW * 4) {
        const c4h = closes1h.filter((_, i) => i % 4 === 3);
        sig4h = getSignal(c4h);
    }

    // Approximate 1D: sample every 24th close
    let sig1d = { signal: 'neutral', confirmed: false, rsi: null };
    if (closes1h && closes1h.length >= EMA_SLOW * 24) {
        const c1d = closes1h.filter((_, i) => i % 24 === 23);
        sig1d = getSignal(c1d);
    }

    // Determine overall signal based on 1H (primary for memes)
    let confirmedSignal = 'neutral';
    const isWeak = sig1h.signal !== 'neutral' && !sig1h.confirmed;
    if (sig1h.signal === 'bullish' && sig1h.confirmed) confirmedSignal = 'confirmed-bullish';
    else if (sig1h.signal === 'bearish' && sig1h.confirmed) confirmedSignal = 'confirmed-bearish';
    else if (sig1h.signal === 'bullish') confirmedSignal = 'weak-bullish';
    else if (sig1h.signal === 'bearish') confirmedSignal = 'weak-bearish';

    const priceUsd = parseFloat(attr.base_token_price_usd) || 0;
    const change24h = parseFloat(attr.price_change_percentage?.h24) || 0;
    const change1h = parseFloat(attr.price_change_percentage?.h1) || 0;
    const volume24h = parseFloat(attr.volume_usd?.h24) || 0;
    const liquidity = parseFloat(attr.reserve_in_usd) || 0;
    const fdv = parseFloat(attr.fdv_usd) || 0;
    const mcap = parseFloat(attr.market_cap_usd) || fdv;
    const createdAt = attr.pool_created_at ? new Date(attr.pool_created_at) : null;
    const ageHours = createdAt ? Math.round((Date.now() - createdAt.getTime()) / 3600000) : null;
    const dex = pool.relationships?.dex?.data?.id || 'DEX';
    const txns24h = attr.transactions?.h24;
    const buySell = txns24h ? `${txns24h.buys}B / ${txns24h.sells}S` : null;

    return {
        poolAddress: paddr,
        baseTokenId,
        name,
        symbol: name,
        priceUsd,
        change24h,
        change1h,
        volume24h,
        liquidity,
        fdv,
        mcap,
        ageHours,
        dex,
        buySell,
        sig1h,
        sig4h,
        sig1d,
        confirmedSignal,
        isWeak,
        closes1h,
    };
}

/* ── FORMAT HELPERS ───────────────────────────────────── */
function fmtPrice(p) {
    if (!p || p === 0) return '–';
    if (p >= 1) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 4 });
    if (p >= 0.001) return '$' + p.toFixed(6);
    if (p >= 0.000001) return '$' + p.toFixed(8);
    return '$' + p.toExponential(4);
}
function fmtUSD(v) {
    if (!v || v === 0) return '–';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + v.toFixed(0);
}
function fmtAge(h) {
    if (!h && h !== 0) return '–';
    if (h < 1) return '<1h';
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
}
function fmtChange(c) {
    const s = (c >= 0 ? '+' : '') + c.toFixed(2) + '%';
    return s;
}
function rsiColor(rsi, sig) {
    if (!rsi) return 'var(--text-muted)';
    if (sig === 'bullish' && rsi > RSI_BULL) return 'var(--bullish)';
    if (sig === 'bearish' && rsi < RSI_BEAR) return 'var(--bearish)';
    return '#f59e0b';
}
function sigEmoji(s, confirmed) {
    if (s === 'bullish') return confirmed ? '🟢' : '🟡';
    if (s === 'bearish') return confirmed ? '🔴' : '🟠';
    return '⚪';
}
function hashColor(str) {
    let h = 0;
    for (const c of str) h = c.charCodeAt(0) + ((h << 5) - h);
    return `hsl(${Math.abs(h) % 360}, 65%, 55%)`;
}
function initials(name) { return (name || '?').slice(0, 2).toUpperCase(); }

/* ── BUILD CARD ───────────────────────────────────────── */
function buildCard(d, idx) {
    const delay = `animation-delay:${idx * 0.04}s`;
    const color = hashColor(d.name);

    let bcls, btxt;
    if (d.confirmedSignal === 'confirmed-bullish') { bcls = 'badge-confirmed-bullish'; btxt = '✅ Bullish'; }
    else if (d.confirmedSignal === 'confirmed-bearish') { bcls = 'badge-confirmed-bearish'; btxt = '⛔ Bearish'; }
    else if (d.confirmedSignal === 'weak-bullish') { bcls = 'badge-weak'; btxt = '⚠️ Bullish'; }
    else if (d.confirmedSignal === 'weak-bearish') { bcls = 'badge-weak'; btxt = '⚠️ Bearish'; }
    else { bcls = 'badge-neutral'; btxt = '⏸ Neutru'; }

    const cardCls = d.confirmedSignal.includes('bullish') ? 'bullish-card' : d.confirmedSignal.includes('bearish') ? 'bearish-card' : 'neutral-card';
    const chgCls1h = d.change1h >= 0 ? 'positive' : 'negative';
    const chgCls24 = d.change24h >= 0 ? 'positive' : 'negative';

    const sig1hRsiClr = rsiColor(d.sig1h.rsi, d.sig1h.signal);
    const sig4hRsiClr = rsiColor(d.sig4h.rsi, d.sig4h.signal);

    return `
  <div class="asset-card ${cardCls} ${d.isWeak ? 'weak-card' : ''}"
       style="${delay}"
       id="mc-${d.poolAddress}"
       onclick="openDSChart('${d.poolAddress}')">

    <div class="card-header">
      <div class="asset-info">
        <div class="asset-icon" style="color:${color};background:${color}22;font-size:14px;font-weight:800;">
          <span>${initials(d.name)}</span>
        </div>
        <div>
          <div class="asset-name">${d.name}</div>
          <div class="asset-symbol" style="font-size:9px;">${d.dex.toUpperCase()}</div>
        </div>
      </div>
      <div class="card-header-right">
        <span class="overall-badge ${bcls}">${btxt}</span>
      </div>
    </div>

    <div class="price-row">
      <span class="asset-price" style="font-size:16px;">${fmtPrice(d.priceUsd)}</span>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;">
        <span class="price-change ${chgCls1h}" style="font-size:10px;">1H ${fmtChange(d.change1h)}</span>
        <span class="price-change ${chgCls24}" style="font-size:10px;">24H ${fmtChange(d.change24h)}</span>
      </div>
    </div>

    <!-- EMA/RSI cells for 1H and approx 4H -->
    <div class="tf-grid" style="grid-template-columns: repeat(2, 1fr);">
      <div class="tf-cell ${d.sig1h.confirmed ? `cell-${d.sig1h.signal} cell-confirmed` : d.sig1h.signal !== 'neutral' ? `cell-${d.sig1h.signal} cell-weak` : ''}">
        <span class="tf-label">1H</span>
        <span class="tf-signal">${sigEmoji(d.sig1h.signal, d.sig1h.confirmed)}</span>
        <span class="tf-ema-diff">${d.sig1h.diff != null ? (d.sig1h.diff >= 0 ? '+' : '') + d.sig1h.diff.toFixed(2) + '%' : '–'}</span>
        <span class="tf-rsi" style="color:${sig1hRsiClr}">RSI ${d.sig1h.rsi ? d.sig1h.rsi.toFixed(1) : '–'}</span>
      </div>
      <div class="tf-cell ${d.sig4h.confirmed ? `cell-${d.sig4h.signal} cell-confirmed` : d.sig4h.signal !== 'neutral' ? `cell-${d.sig4h.signal} cell-weak` : ''}">
        <span class="tf-label">~4H</span>
        <span class="tf-signal">${sigEmoji(d.sig4h.signal, d.sig4h.confirmed)}</span>
        <span class="tf-ema-diff" style="font-size:8px;">aprox.</span>
        <span class="tf-rsi" style="color:${sig4hRsiClr}">RSI ${d.sig4h.rsi ? d.sig4h.rsi.toFixed(1) : '–'}</span>
      </div>
    </div>

    <!-- Memecoin metadata chips -->
    <div class="mc-meta">
      <span class="mc-chip vol" title="Volume 24h">📊 ${fmtUSD(d.volume24h)}</span>
      <span class="mc-chip liq" title="Lichiditate">💧 ${fmtUSD(d.liquidity)}</span>
      ${d.mcap > 0 ? `<span class="mc-chip mcap" title="Market Cap">💰 ${fmtUSD(d.mcap)}</span>` : ''}
      <span class="mc-chip age" title="Vârsta pool-ului">🕐 ${fmtAge(d.ageHours)}</span>
      ${d.buySell ? `<span class="mc-chip" style="font-size:9px;" title="Tranzacții 24h">${d.buySell}</span>` : ''}
    </div>

    <div class="card-tv-hint" style="opacity:0.6;font-size:10px;margin-top:8px;">📈 Click pentru DexScreener chart</div>
  </div>`;
}

/* ── DEXSCREENER CHART MODAL ──────────────────────────── */
function openDSChart(poolAddress) {
    const d = allData.find(x => x.poolAddress === poolAddress);
    if (!d) return;
    currentDSSymbol = poolAddress;

    // Header info
    const colorEl = document.getElementById('dsIcon');
    colorEl.textContent = initials(d.name);
    colorEl.style.background = hashColor(d.name) + '33';
    colorEl.style.color = hashColor(d.name);
    document.getElementById('dsName').textContent = d.name;
    document.getElementById('dsSym').textContent = `${d.name} / SOL · ${d.dex.toUpperCase()}`;
    document.getElementById('dsPrice').textContent = fmtPrice(d.priceUsd);

    const badgeEl = document.getElementById('dsBadge');
    if (d.confirmedSignal === 'confirmed-bullish') { badgeEl.textContent = '✅ Bullish'; badgeEl.className = 'tv-asset-badge badge-confirmed-bullish'; }
    else if (d.confirmedSignal === 'confirmed-bearish') { badgeEl.textContent = '⛔ Bearish'; badgeEl.className = 'tv-asset-badge badge-confirmed-bearish'; }
    else { badgeEl.textContent = '⚠️ Slab'; badgeEl.className = 'tv-asset-badge badge-weak'; }

    // External links
    document.getElementById('dsAxiomLink').href = `https://dexscreener.com/solana/${poolAddress}`;
    document.getElementById('dsAxiomTradeLink').href = `https://axiom.trade/meme/${poolAddress}`;

    // Show overlay & embed chart
    document.getElementById('dsOverlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    const wrap = document.getElementById('dsChartWrap');
    wrap.innerHTML = `
    <div class="ds-loading" id="dsLoading">
      <div class="loading-spinner"></div>
      <span>Se încarcă chart-ul DexScreener...</span>
    </div>
    <iframe
      id="dsIframe"
      src="https://dexscreener.com/solana/${poolAddress}?embed=1&theme=dark&trades=0&info=0"
      style="position:absolute;inset:0;width:100%;height:100%;border:0;opacity:0;transition:opacity 0.3s;"
      onload="this.style.opacity=1;document.getElementById('dsLoading').style.display='none';"
      allow="clipboard-write"
    ></iframe>`;
    wrap.style.position = 'relative';
}

function closeDSChart() {
    document.getElementById('dsOverlay').classList.add('hidden');
    document.getElementById('dsChartWrap').innerHTML = '';
    document.body.style.overflow = '';
}
function closeDSOnBg(e) {
    if (e.target === document.getElementById('dsOverlay')) closeDSChart();
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDSChart(); });

/* ── FILTERS & SORT ───────────────────────────────────── */
function filterSignal(s) {
    currentSignal = s;
    document.querySelectorAll('.signal-btn[data-signal]').forEach(b => b.classList.toggle('active', b.dataset.signal === s));
    renderDashboard();
}
function filterSearch(v) { currentSearch = v; renderDashboard(); }
function sortBy(s) {
    currentSort = s;
    document.querySelectorAll('.signal-btn[data-sort]').forEach(b => b.classList.toggle('active', b.dataset.sort === s));
    renderDashboard();
}

function getFiltered() {
    let data = [...allData];

    // Signal filter based on 1H
    if (currentSignal !== 'all') {
        data = data.filter(d => {
            if (currentSignal === 'confirmed-bullish') return d.confirmedSignal === 'confirmed-bullish';
            if (currentSignal === 'confirmed-bearish') return d.confirmedSignal === 'confirmed-bearish';
            if (currentSignal === 'weak') return d.isWeak;
            return true;
        });
    }

    // Search
    if (currentSearch) {
        const q = currentSearch.toLowerCase();
        data = data.filter(d => d.name.toLowerCase().includes(q));
    }

    // Sort
    data.sort((a, b) => {
        if (currentSort === 'volume') return b.volume24h - a.volume24h;
        if (currentSort === 'change') return b.change24h - a.change24h;
        if (currentSort === 'liq') return b.liquidity - a.liquidity;
        return 0; // trending = original order from API
    });

    return data;
}

/* ── STATS BAR ────────────────────────────────────────── */
function updateStats() {
    document.getElementById('bullishCount').textContent = allData.filter(d => d.confirmedSignal === 'confirmed-bullish').length;
    document.getElementById('bearishCount').textContent = allData.filter(d => d.confirmedSignal === 'confirmed-bearish').length;
    document.getElementById('weakCount').textContent = allData.filter(d => d.isWeak).length;
    document.getElementById('totalAssets').textContent = allData.length;
}

/* ── RENDER ───────────────────────────────────────────── */
function renderDashboard() {
    const grid = document.getElementById('dashboardGrid');
    const data = getFiltered();
    if (!data.length) {
        grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px 0;color:var(--text-muted);">
      <div style="font-size:40px;margin-bottom:12px;">🔍</div>
      <p>Niciun memecoin nu corespunde filtrelor.</p></div>`;
        return;
    }
    grid.innerHTML = data.map((d, i) => buildCard(d, i)).join('');
}

/* ── REFRESH ──────────────────────────────────────────── */
async function refreshData() {
    const btn = document.getElementById('refreshBtn');
    btn.classList.add('spinning'); btn.disabled = true;

    try {
        if (!allData.length) {
            document.getElementById('loadingState').classList.remove('hidden');
            document.getElementById('errorState').classList.add('hidden');
            document.getElementById('dashboardGrid').classList.add('hidden');
        }

        // Fetch trending pools
        const pools = await fetchTrending();

        // Filter: exclude SOL/USDC and other non-memecoin pairs, take top MAX_COINS
        const memePoolsRaw = pools
            .filter(p => {
                const name = p.attributes?.name || '';
                // exclude boring pairs
                if (name === 'SOL / USDC' || name === 'SOL / USDT') return false;
                // require reasonable liquidity (>5k USD)
                if ((parseFloat(p.attributes?.reserve_in_usd) || 0) < 5000) return false;
                return true;
            })
            .slice(0, MAX_COINS);

        // Analyze each pool in parallel
        // To avoid rate-limiting GeckoTerminal (30 req/min), we throttle slightly
        const analyzed = [];
        for (let i = 0; i < memePoolsRaw.length; i++) {
            try {
                const result = await analyzePool(memePoolsRaw[i]);
                analyzed.push(result);
                // Small throttle: 200ms between pools to avoid rate limit
                if (i < memePoolsRaw.length - 1) await new Promise(r => setTimeout(r, 200));
            } catch { }
        }

        allData = analyzed;

        document.getElementById('loadingState').classList.add('hidden');
        document.getElementById('errorState').classList.add('hidden');
        document.getElementById('dashboardGrid').classList.remove('hidden');

        updateStats();
        renderDashboard();

        const t = new Date().toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        document.getElementById('lastUpdate').querySelector('span').textContent = `Actualizat: ${t}`;

    } catch (err) {
        document.getElementById('loadingState').classList.add('hidden');
        document.getElementById('errorState').classList.remove('hidden');
        document.getElementById('dashboardGrid').classList.add('hidden');
        document.getElementById('errorMessage').textContent = err.message || 'Eroare GeckoTerminal API.';
        console.error(err);
    } finally {
        btn.classList.remove('spinning'); btn.disabled = false;
    }
}

// Auto-refresh every 3 minutes (memecoins move fast!)
setInterval(refreshData, 3 * 60 * 1000);
refreshData();
