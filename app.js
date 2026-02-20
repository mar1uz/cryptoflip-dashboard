/**
 * CryptoFlip Dashboard — app.js v3
 * =====================================
 * NOU în v3:
 * 1. Add/Remove assets cu persistare în localStorage
 * 2. Validare simbol contra Binance API înainte de adăugare
 * 3. Chart TradingView embeded la click pe card (cu EMA+RSI pre-adăugate)
 * 4. Click card → TV Chart; buton 📊 pe card → Modal EMA/RSI detalii
 */

/* ─── CONFIGURARE ─────────────────────────────────────────── */
const DEFAULT_ASSETS = [
    { symbol: 'BTCUSDT', name: 'Bitcoin', icon: '₿', color: '#f59e0b' },
    { symbol: 'ETHUSDT', name: 'Ethereum', icon: 'Ξ', color: '#6366f1' },
    { symbol: 'SOLUSDT', name: 'Solana', icon: '◎', color: '#9945ff' },
    { symbol: 'BNBUSDT', name: 'BNB', icon: '⬡', color: '#f0b90b' },
    { symbol: 'XRPUSDT', name: 'XRP', icon: '✕', color: '#00aae4' },
    { symbol: 'ADAUSDT', name: 'Cardano', icon: '₳', color: '#0033ad' },
    { symbol: 'AVAXUSDT', name: 'Avalanche', icon: '▲', color: '#e84142' },
    { symbol: 'DOGEUSDT', name: 'Dogecoin', icon: 'Ð', color: '#c2a633' },
    { symbol: 'DOTUSDT', name: 'Polkadot', icon: '●', color: '#e6007a' },
    { symbol: 'MATICUSDT', name: 'Polygon', icon: '⬟', color: '#8247e5' },
    { symbol: 'LINKUSDT', name: 'Chainlink', icon: '⬡', color: '#375bd2' },
    { symbol: 'UNIUSDT', name: 'Uniswap', icon: '🦄', color: '#ff007a' },
];

const TIMEFRAMES = [
    { key: '1h', label: '1H', binanceInterval: '1h', limit: 60 },
    { key: '4h', label: '4H', binanceInterval: '4h', limit: 60 },
    { key: '1d', label: '1D', binanceInterval: '1d', limit: 60 },
    { key: '1w', label: '1W', binanceInterval: '1w', limit: 60 },
];

const EMA_FAST = 9;
const EMA_SLOW = 21;
const RSI_PERIOD = 14;
const RSI_BULL = 52;
const RSI_BEAR = 48;

/* ─── STATE ───────────────────────────────────────────────── */
let allData = [];
let customAssets = [];       // assets adăugate de user, din localStorage
let removedSymbols = new Set();// assets default șterse de user
let currentTf = '1h';
let currentSignal = 'all';
let currentSearch = '';
let currentTVSymbol = '';
let tvInterval = '60';
let tvScriptLoaded = false;

/* ─── localStorage keys ───────────────────────────────────── */
const LS_CUSTOM = 'cryptoflip_custom_assets_v3';
const LS_REMOVED = 'cryptoflip_removed_defaults_v3';
const LS_SIGNALS = 'cryptoflip_signals_v2';
const LS_NOTIF_DIS = 'cryptoflip_notif_dismissed';

/* ─── ASSETS MANAGEMENT ───────────────────────────────────── */
function initAssets() {
    try {
        const c = localStorage.getItem(LS_CUSTOM);
        if (c) customAssets = JSON.parse(c);
        const r = localStorage.getItem(LS_REMOVED);
        if (r) removedSymbols = new Set(JSON.parse(r));
    } catch { }
}

function getActiveAssets() {
    const defaults = DEFAULT_ASSETS.filter(a => !removedSymbols.has(a.symbol));
    return [...defaults, ...customAssets];
}

function saveCustomAssets() {
    localStorage.setItem(LS_CUSTOM, JSON.stringify(customAssets));
}

function saveRemovedSymbols() {
    localStorage.setItem(LS_REMOVED, JSON.stringify([...removedSymbols]));
}

/* Generează culoare și icon pentru assets custom */
function symbolColor(sym) {
    let h = 0;
    for (const c of sym) h = c.charCodeAt(0) + ((h << 5) - h);
    return `hsl(${Math.abs(h) % 360}, 65%, 55%)`;
}

function symbolIcon(sym) {
    return sym.replace('USDT', '').replace('BTC', '').replace('ETH', '').slice(0, 2);
}

/* ─── ADD ASSET PANEL ─────────────────────────────────────── */
let addPanelOpen = false;

function toggleAddPanel() {
    addPanelOpen = !addPanelOpen;
    const panel = document.getElementById('addPanel');
    const btn = document.getElementById('addAssetToggleBtn');
    panel.classList.toggle('hidden', !addPanelOpen);
    btn.classList.toggle('add-asset-btn-active', addPanelOpen);
    if (addPanelOpen) {
        document.getElementById('addSymbolInput').focus();
        setAddStatus('', '');
    }
}

function onAddInput(value) {
    setAddStatus('', '');
    const sug = document.getElementById('addSuggestions');
    // Sugestii simple bazate pe input (completă cu USDT dacă lipsește)
    if (value.length < 2) { sug.innerHTML = ''; return; }
    const v = value.toUpperCase().trim();
    const candidates = v.endsWith('USDT') ? [v] : [`${v}USDT`, `${v}BTC`, `${v}ETH`];
    sug.innerHTML = candidates.map(s =>
        `<button class="add-sug-btn" onclick="pickSuggestion('${s}')">${s}</button>`
    ).join('');
}

function pickSuggestion(sym) {
    document.getElementById('addSymbolInput').value = sym;
    document.getElementById('addSuggestions').innerHTML = '';
}

function onAddKeydown(e) {
    if (e.key === 'Enter') confirmAddAsset();
}

async function confirmAddAsset() {
    const raw = document.getElementById('addSymbolInput').value.trim().toUpperCase();
    if (!raw) return;

    // Normalizare: dacă nu are pereche, adaugăm USDT
    const symbol = raw.includes('USDT') || raw.includes('BTC') || raw.includes('ETH')
        ? raw : `${raw}USDT`;

    // Verifică dacă există deja
    const all = getActiveAssets();
    if (all.find(a => a.symbol === symbol)) {
        setAddStatus('error', `⚠️ ${symbol} este deja în dashboard.`); return;
    }

    setAddStatus('loading', '⏳ Verificare simbol pe Binance...');
    setBtnLoading(true);

    try {
        const valid = await validateSymbol(symbol);
        if (!valid) {
            setAddStatus('error', `❌ Simbolul <strong>${symbol}</strong> nu există pe Binance.`); return;
        }

        // Adaugă asset
        const base = symbol.replace('USDT', '').replace('BTC', '').replace('ETH', '');
        const newAsset = {
            symbol,
            name: base,
            icon: symbolIcon(symbol),
            color: symbolColor(symbol),
            custom: true,
        };
        customAssets.push(newAsset);
        saveCustomAssets();

        setAddStatus('success', `✅ <strong>${symbol}</strong> adăugat! Se analizează...`);
        document.getElementById('addSymbolInput').value = '';
        document.getElementById('addSuggestions').innerHTML = '';

        // Analizăm noul asset și îl adăugăm la dashboard
        const analyzed = await analyzeAsset(newAsset);
        allData.push(analyzed);
        updateStatsBar();
        renderDashboard();

        setTimeout(() => setAddStatus('', ''), 3000);

    } catch (err) {
        setAddStatus('error', `❌ Eroare: ${err.message}`);
    } finally {
        setBtnLoading(false);
    }
}

function setAddStatus(type, html) {
    const el = document.getElementById('addStatus');
    el.className = `add-status ${type ? 'add-status-' + type : ''}`;
    el.innerHTML = html;
}

function setBtnLoading(loading) {
    const btn = document.getElementById('addConfirmBtn');
    document.getElementById('addConfirmLabel').textContent = loading ? '...' : 'Adaugă';
    btn.disabled = loading;
}

async function validateSymbol(symbol) {
    try {
        const r = await fetch(`${BINANCE_BASE}/ticker/price?symbol=${symbol}`);
        return r.ok;
    } catch { return false; }
}

/* Elimină un asset din dashboard */
function removeAsset(symbol, event) {
    event.stopPropagation(); // nu trigera click pe card
    const isDefault = DEFAULT_ASSETS.find(a => a.symbol === symbol);
    if (isDefault) {
        removedSymbols.add(symbol);
        saveRemovedSymbols();
    } else {
        customAssets = customAssets.filter(a => a.symbol !== symbol);
        saveCustomAssets();
    }
    allData = allData.filter(d => d.symbol !== symbol);
    updateStatsBar();
    renderDashboard();
}

/* ─── INDICATORI ──────────────────────────────────────────── */
function calculateEMA(closes, period) {
    if (closes.length < period) return null;
    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
    for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
    return ema;
}

function calculateRSI(closes, period = RSI_PERIOD) {
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
    if (al === 0) return 100;
    return 100 - (100 / (1 + ag / al));
}

function getConfirmation(emaSignal, rsi) {
    if (!rsi) return { confirmed: false, reason: 'date insuficiente' };
    if (emaSignal === 'bullish')
        return rsi > RSI_BULL
            ? { confirmed: true, reason: `RSI ${rsi.toFixed(1)} > ${RSI_BULL}` }
            : { confirmed: false, reason: `RSI ${rsi.toFixed(1)} sub ${RSI_BULL} (fals?)` };
    if (emaSignal === 'bearish')
        return rsi < RSI_BEAR
            ? { confirmed: true, reason: `RSI ${rsi.toFixed(1)} < ${RSI_BEAR}` }
            : { confirmed: false, reason: `RSI ${rsi.toFixed(1)} peste ${RSI_BEAR} (fals?)` };
    return { confirmed: false, reason: 'neutru' };
}

/* ─── BINANCE API ─────────────────────────────────────────── */
const BINANCE_BASE = 'https://api.binance.com/api/v3';

async function fetchKlines(symbol, interval, limit = 60) {
    const r = await fetch(`${BINANCE_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    if (!r.ok) throw new Error(`Binance ${r.status}`);
    return (await r.json()).map(c => parseFloat(c[4]));
}

async function fetchPrice(symbol) {
    const r = await fetch(`${BINANCE_BASE}/ticker/24hr?symbol=${symbol}`);
    if (!r.ok) return { price: 0, change: 0 };
    const d = await r.json();
    return { price: parseFloat(d.lastPrice), change: parseFloat(d.priceChangePercent) };
}

/* ─── ANALIZĂ ASSET ───────────────────────────────────────── */
async function analyzeAsset(asset) {
    const { price, change } = await fetchPrice(asset.symbol);
    const tfResults = {};

    for (const tf of TIMEFRAMES) {
        try {
            const closes = await fetchKlines(asset.symbol, tf.binanceInterval, tf.limit);
            const ema9 = calculateEMA(closes, EMA_FAST);
            const ema21 = calculateEMA(closes, EMA_SLOW);
            const rsi = calculateRSI(closes, RSI_PERIOD);
            if (!ema9 || !ema21) {
                tfResults[tf.key] = { signal: 'neutral', confirmed: false, reason: 'date insuficiente', ema9: null, ema21: null, diff: null, rsi: null };
                continue;
            }
            const diff = ((ema9 - ema21) / ema21) * 100;
            const emaSignal = ema9 > ema21 ? 'bullish' : 'bearish';
            const { confirmed, reason } = getConfirmation(emaSignal, rsi);
            tfResults[tf.key] = { signal: emaSignal, confirmed, reason, ema9, ema21, diff, rsi };
        } catch {
            tfResults[tf.key] = { signal: 'neutral', confirmed: false, reason: 'eroare', ema9: null, ema21: null, diff: null, rsi: null };
        }
    }

    const cb = Object.values(tfResults).filter(t => t.signal === 'bullish' && t.confirmed).length;
    const cr = Object.values(tfResults).filter(t => t.signal === 'bearish' && t.confirmed).length;
    const eb = Object.values(tfResults).filter(t => t.signal === 'bullish').length;
    const er = Object.values(tfResults).filter(t => t.signal === 'bearish').length;

    let confirmedSignal = 'neutral', overallSignal = 'neutral', score = 0;
    if (cb > cr) { confirmedSignal = 'confirmed-bullish'; overallSignal = 'bullish'; score = cb / TIMEFRAMES.length; }
    else if (cr > cb) { confirmedSignal = 'confirmed-bearish'; overallSignal = 'bearish'; score = cr / TIMEFRAMES.length; }
    else if (eb > er) { confirmedSignal = 'weak-bullish'; overallSignal = 'bullish'; score = eb / TIMEFRAMES.length * 0.5; }
    else if (er > eb) { confirmedSignal = 'weak-bearish'; overallSignal = 'bearish'; score = er / TIMEFRAMES.length * 0.5; }

    return { ...asset, price, change, tfResults, overallSignal, confirmedSignal, isWeak: confirmedSignal.startsWith('weak'), score, confirmedBullish: cb, confirmedBearish: cr };
}

/* ─── FORMAT ──────────────────────────────────────────────── */
function formatPrice(p) {
    if (!p) return '–';
    if (p >= 1000) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (p >= 1) return '$' + p.toFixed(4);
    return '$' + p.toFixed(6);
}
function formatDiff(d) {
    if (d == null) return '–';
    return (d >= 0 ? '+' : '') + d.toFixed(3) + '%';
}
function formatRSI(r) { return r ? r.toFixed(1) : '–'; }
function rsiColor(rsi, sig) {
    if (!rsi) return 'var(--text-muted)';
    if (sig === 'bullish' && rsi > RSI_BULL) return 'var(--bullish)';
    if (sig === 'bearish' && rsi < RSI_BEAR) return 'var(--bearish)';
    return '#f59e0b';
}
function signalEmoji(sig, conf) {
    if (sig === 'bullish') return conf ? '🟢' : '🟡';
    if (sig === 'bearish') return conf ? '🔴' : '🟠';
    return '⚪';
}

/* ─── TRADINGVIEW CHART ───────────────────────────────────── */
/*
 * TradingView Advanced Chart Widget — gratuit, fără cont
 * Documentație: https://www.tradingview.com/widget/advanced-chart/
 * Scriptul este încărcat o singură dată și reutilizat.
 * La fiecare deschidere a modalului, ștergem conținutul și creăm un widget nou.
 */

function openTVChart(symbol) {
    const data = allData.find(d => d.symbol === symbol);
    if (!data) return;

    currentTVSymbol = symbol;

    // Populăm header-ul modalului TV
    document.getElementById('tvIcon').textContent = data.icon;
    document.getElementById('tvIcon').style.color = data.color;
    document.getElementById('tvIcon').style.background = `${data.color}22`;
    document.getElementById('tvName').textContent = data.name;
    document.getElementById('tvSym').textContent = data.symbol;
    document.getElementById('tvPrice').textContent = formatPrice(data.price);

    const badgeEl = document.getElementById('tvBadge');
    if (data.confirmedSignal === 'confirmed-bullish') { badgeEl.textContent = '✅ Bullish'; badgeEl.className = 'tv-asset-badge badge-confirmed-bullish'; }
    else if (data.confirmedSignal === 'confirmed-bearish') { badgeEl.textContent = '⛔ Bearish'; badgeEl.className = 'tv-asset-badge badge-confirmed-bearish'; }
    else { badgeEl.textContent = '⚠️ Slab'; badgeEl.className = 'tv-asset-badge badge-weak'; }

    // Reset interval buttons
    document.querySelectorAll('.tv-itf').forEach(b => b.classList.remove('active'));
    document.querySelector(`.tv-itf[data-iv="${tvInterval}"]`)?.classList.add('active');

    document.getElementById('tvOverlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    initTVChart(symbol, tvInterval);
}

function initTVChart(symbol, interval) {
    const wrap = document.getElementById('tvChartWrap');
    const uid = 'tv_' + Date.now();
    wrap.innerHTML = `<div id="${uid}" style="height:100%;"></div>`;

    const doCreate = () => {
        // Adăugăm automat EMA 9, EMA 21 și RSI ca studii pe chart
        new window.TradingView.widget({
            container_id: uid,
            autosize: true,
            symbol: `BINANCE:${symbol}`,
            interval: interval,
            timezone: 'Europe/Bucharest',
            theme: 'dark',
            style: '1',
            locale: 'ro',
            toolbar_bg: '#0d1220',
            enable_publishing: false,
            hide_top_toolbar: false,
            withdateranges: true,
            save_image: false,
            studies: [
                'RSI@tv-basicstudies',
                'MASimple@tv-basicstudies',
                'MASimple@tv-basicstudies',
            ],
        });
    };

    if (window.TradingView) {
        doCreate();
    } else {
        const script = document.createElement('script');
        script.src = 'https://s3.tradingview.com/tv.js';
        script.async = true;
        script.onload = doCreate;
        document.head.appendChild(script);
        tvScriptLoaded = true;
    }
}

function changeTVInterval(iv, btn) {
    tvInterval = iv;
    document.querySelectorAll('.tv-itf').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // Recreăm widget-ul cu noul interval
    initTVChart(currentTVSymbol, iv);
}

function closeTVChart() {
    document.getElementById('tvOverlay').classList.add('hidden');
    document.getElementById('tvChartWrap').innerHTML = ''; // distrugem iframe-ul
    document.body.style.overflow = '';
}

function closeTVOnBg(e) {
    if (e.target === document.getElementById('tvOverlay')) closeTVChart();
}

// Butonul "📊 EMA/RSI" din TV modal deschide modalul de semnale
function openSignalFromTV() {
    openSignalModal(currentTVSymbol, null);
}

/* ─── EMA/RSI SIGNAL MODAL ────────────────────────────────── */
function openSignalModal(symbol, event) {
    if (event) event.stopPropagation();
    const data = allData.find(d => d.symbol === symbol);
    if (!data) return;

    document.getElementById('modalTitle').textContent = data.name;
    document.getElementById('modalSymbol').textContent = data.symbol;
    document.getElementById('modalPrice').textContent = formatPrice(data.price);
    document.getElementById('modalIcon').textContent = data.icon;
    document.getElementById('modalIcon').style.background = `${data.color}22`;
    document.getElementById('modalIcon').style.color = data.color;

    document.getElementById('modalTimeframes').innerHTML = TIMEFRAMES.map(tf => {
        const t = data.tfResults[tf.key];
        const cardClass = t.confirmed ? `modal-${t.signal}` : t.signal !== 'neutral' ? 'modal-weak' : '';
        const sigLabel = t.confirmed
            ? (t.signal === 'bullish' ? '✅ Confirmat Bullish' : '⛔ Confirmat Bearish')
            : t.signal !== 'neutral' ? '⚠️ Semnal Slab' : '⏸ Neutru';
        const rc = rsiColor(t.rsi, t.signal);
        const rsiPct = t.rsi ? Math.min(100, t.rsi) : 0;
        return `
      <div class="modal-tf-card ${cardClass}">
        <div class="modal-tf-header">
          <span class="modal-tf-name">${tf.label}</span>
          <span class="modal-tf-signal">${signalEmoji(t.signal, t.confirmed)}</span>
        </div>
        <div class="modal-signal-label">${sigLabel}</div>
        <div class="modal-ema-row">
          <div class="modal-ema-item"><span class="modal-ema-label">EMA ${EMA_FAST}</span><span class="modal-ema-value">${t.ema9 ? formatPrice(t.ema9) : '–'}</span></div>
          <div class="modal-ema-item"><span class="modal-ema-label">EMA ${EMA_SLOW}</span><span class="modal-ema-value">${t.ema21 ? formatPrice(t.ema21) : '–'}</span></div>
          <div class="modal-ema-item" style="margin-top:4px;">
            <span class="modal-ema-label">Δ EMA</span>
            <span class="modal-ema-diff ${t.signal === 'bullish' ? 'diff-bullish' : 'diff-bearish'}">${formatDiff(t.diff)}</span>
          </div>
        </div>
        <div class="rsi-block">
          <div class="rsi-row"><span class="rsi-label">RSI ${RSI_PERIOD}</span><span class="rsi-value" style="color:${rc}">${formatRSI(t.rsi)}</span></div>
          <div class="rsi-track">
            <div class="rsi-zone rsi-zone-bear"></div>
            <div class="rsi-zone rsi-zone-mid"></div>
            <div class="rsi-zone rsi-zone-bull"></div>
            <div class="rsi-pointer" style="left:${rsiPct}%;background:${rc};"></div>
          </div>
          <div class="rsi-labels"><span>0</span><span style="margin-left:30%">30</span><span style="margin-left:18%">50</span><span style="margin-left:18%">70</span><span style="margin-left:auto">100</span></div>
          <div class="rsi-reason">${t.reason}</div>
        </div>
      </div>`;
    }).join('');

    document.getElementById('modalOverlay').classList.remove('hidden');
}

function closeModal(e) { if (e.target === document.getElementById('modalOverlay')) closeModalDirect(); }
function closeModalDirect() { document.getElementById('modalOverlay').classList.add('hidden'); }
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeTVChart(); closeModalDirect(); }
});

/* ─── BUILD CARD ──────────────────────────────────────────── */
function buildCard(data, index) {
    const delay = `animation-delay:${index * 0.05}s`;

    const tfCells = TIMEFRAMES.map(tf => {
        const t = data.tfResults[tf.key];
        const cls = t.confirmed ? `cell-${t.signal} cell-confirmed` : t.signal !== 'neutral' ? `cell-${t.signal} cell-weak` : '';
        const rc = rsiColor(t.rsi, t.signal);
        return `
      <div class="tf-cell ${cls}">
        <span class="tf-label">${tf.label}</span>
        <span class="tf-signal">${signalEmoji(t.signal, t.confirmed)}</span>
        <span class="tf-ema-diff">${formatDiff(t.diff)}</span>
        <span class="tf-rsi" style="color:${rc}">RSI ${formatRSI(t.rsi)}</span>
      </div>`;
    }).join('');

    let bcls, btxt;
    if (data.confirmedSignal === 'confirmed-bullish') { bcls = 'badge-confirmed-bullish'; btxt = '✅ Bullish'; }
    else if (data.confirmedSignal === 'confirmed-bearish') { bcls = 'badge-confirmed-bearish'; btxt = '⛔ Bearish'; }
    else if (data.confirmedSignal === 'weak-bullish') { bcls = 'badge-weak'; btxt = '⚠️ Bullish'; }
    else if (data.confirmedSignal === 'weak-bearish') { bcls = 'badge-weak'; btxt = '⚠️ Bearish'; }
    else { bcls = 'badge-neutral'; btxt = '⏸ Neutru'; }

    const cardCls = data.confirmedSignal.includes('bullish') ? 'bullish-card' : data.confirmedSignal.includes('bearish') ? 'bearish-card' : 'neutral-card';
    const fillCls = data.overallSignal === 'bullish' ? 'fill-bullish' : data.overallSignal === 'bearish' ? 'fill-bearish' : 'fill-neutral';
    const chgCls = data.change >= 0 ? 'positive' : 'negative';
    const chgStr = (data.change >= 0 ? '+' : '') + data.change.toFixed(2) + '%';
    const pfCount = Math.max(data.confirmedBullish, data.confirmedBearish);
    const scoreTx = data.confirmedSignal === 'neutral' ? 'Mix' : `${pfCount}/4 conf.`;

    return `
    <div class="asset-card ${cardCls} ${data.isWeak ? 'weak-card' : ''}"
         style="${delay}"
         id="card-${data.symbol}"
         data-signal="${data.confirmedSignal}"
         data-name="${data.name.toLowerCase()}"
         data-symbol="${data.symbol.toLowerCase()}"
         onclick="openTVChart('${data.symbol}')">

      <!-- Buton Remove (apare la hover) -->
      <button class="card-remove-btn" onclick="removeAsset('${data.symbol}', event)" title="Elimină din dashboard">×</button>

      <div class="card-header">
        <div class="asset-info">
          <div class="asset-icon" style="color:${data.color};background:${data.color}22;">
            <span>${data.icon}</span>
          </div>
          <div>
            <div class="asset-name">${data.name}${data.custom ? ' <span class="custom-tag">custom</span>' : ''}</div>
            <div class="asset-symbol">${data.symbol}</div>
          </div>
        </div>
        <div class="card-header-right">
          <span class="overall-badge ${bcls}">${btxt}</span>
          <!-- Buton detalii EMA/RSI (stopPropagation, nu deschide TV) -->
          <button class="card-info-btn" onclick="openSignalModal('${data.symbol}', event)" title="Detalii EMA/RSI">📊</button>
        </div>
      </div>

      <div class="price-row">
        <span class="asset-price">${formatPrice(data.price)}</span>
        <span class="price-change ${chgCls}">${chgStr}</span>
      </div>

      <div class="tf-grid">${tfCells}</div>

      <div class="score-bar-wrap">
        <div class="score-bar-track">
          <div class="score-bar-fill ${fillCls}" style="width:${Math.round(data.score * 100)}%"></div>
        </div>
        <span class="score-label">${scoreTx}</span>
      </div>

      <div class="card-tv-hint">📈 Click pentru chart TradingView</div>
    </div>`;
}

/* ─── STATS & RENDER ──────────────────────────────────────── */
function updateStatsBar() {
    document.getElementById('bullishCount').textContent = allData.filter(d => d.confirmedSignal === 'confirmed-bullish').length;
    document.getElementById('bearishCount').textContent = allData.filter(d => d.confirmedSignal === 'confirmed-bearish').length;
    document.getElementById('weakCount').textContent = allData.filter(d => d.isWeak).length;
    document.getElementById('neutralCount').textContent = allData.filter(d => d.confirmedSignal === 'neutral').length;
    document.getElementById('totalAssets').textContent = allData.length;
}

function getFilteredData() {
    return allData.filter(d => {
        let sig = d.confirmedSignal;
        if (currentTf !== 'all') {
            const t = d.tfResults[currentTf];
            if (t) {
                if (t.confirmed && t.signal === 'bullish') sig = 'confirmed-bullish';
                else if (t.confirmed && t.signal === 'bearish') sig = 'confirmed-bearish';
                else if (!t.confirmed && t.signal !== 'neutral') sig = `weak-${t.signal}`;
                else sig = 'neutral';
            }
        }
        const ms = currentSignal === 'all' ? true
            : currentSignal === 'confirmed-bullish' ? sig === 'confirmed-bullish'
                : currentSignal === 'confirmed-bearish' ? sig === 'confirmed-bearish'
                    : currentSignal === 'weak' ? sig.startsWith('weak')
                        : true;
        const q = currentSearch.toLowerCase();
        const mq = !q || d.name.toLowerCase().includes(q) || d.symbol.toLowerCase().includes(q);
        return ms && mq;
    });
}

function renderDashboard() {
    const grid = document.getElementById('dashboardGrid');
    const filtered = getFilteredData();
    if (!filtered.length) {
        grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px 0;color:var(--text-muted);">
      <div style="font-size:40px;margin-bottom:12px;">🔍</div>
      <p>Niciun asset nu corespunde filtrelor.</p></div>`;
        return;
    }
    grid.innerHTML = filtered.map((d, i) => buildCard(d, i)).join('');
}

/* ─── FILTRE ──────────────────────────────────────────────── */
function filterTimeframe(tf) {
    currentTf = tf;
    document.querySelectorAll('.tf-btn').forEach(b => b.classList.toggle('active', b.dataset.tf === tf));
    renderDashboard();
}
function filterSignal(s) {
    currentSignal = s;
    document.querySelectorAll('.signal-btn').forEach(b => b.classList.toggle('active', b.dataset.signal === s));
    renderDashboard();
}
function filterSearch(v) { currentSearch = v; renderDashboard(); }

/* ─── NOTIFICARI ──────────────────────────────────────────── */
let notifEnabled = false;

function loadPrevSignals() {
    try { return JSON.parse(localStorage.getItem(LS_SIGNALS) || '{}'); } catch { return {}; }
}
function saveSignals(data) {
    const m = {};
    for (const d of data) m[d.symbol] = { confirmedSignal: d.confirmedSignal, isWeak: d.isWeak, price: d.price };
    try { localStorage.setItem(LS_SIGNALS, JSON.stringify(m)); } catch { }
}
function processFlips(newData) {
    const prev = loadPrevSignals();
    if (!Object.keys(prev).length) return;
    for (const d of newData) {
        const p = prev[d.symbol];
        if (!p) continue;
        if (p.confirmedSignal !== d.confirmedSignal && !d.isWeak && d.confirmedSignal !== 'neutral') {
            sendFlipNotification({ symbol: d.symbol, name: d.name, icon: d.icon, from: p.confirmedSignal, to: d.confirmedSignal, price: d.price });
        }
    }
}
function sendFlipNotification(flip) {
    if (Notification.permission !== 'granted' || !notifEnabled) return;
    const bull = flip.to.includes('bullish');
    const n = new Notification(`${flip.icon} ${flip.name} — ${bull ? '✅ BULLISH FLIP!' : '⛔ BEARISH FLIP!'}`, {
        body: `${flip.symbol}: ${flip.from} → ${flip.to}\nPreț: ${formatPrice(flip.price)}\nConfirmat EMA 9/21 + RSI 14`,
        tag: flip.symbol,
    });
    n.onclick = () => { window.focus(); openTVChart(flip.symbol); n.close(); };
}
function toggleNotifications() {
    if (Notification.permission === 'granted') {
        notifEnabled = !notifEnabled; updateNotifButton();
    } else if (Notification.permission === 'denied') {
        alert('Notificările sunt blocate. Schimbă din Setări browser → Notificări → Permite.');
    } else { requestNotifPermission(); }
}
async function requestNotifPermission() {
    if (await Notification.requestPermission() === 'granted') {
        notifEnabled = true; updateNotifButton();
        document.getElementById('notifBanner').classList.add('hidden');
        new Notification('✅ CryptoFlip Alerts Active', { body: 'Vei fi notificat la flip-uri confirmate (EMA + RSI).', tag: 'test' });
    }
}
function updateNotifButton() {
    document.getElementById('notifBtn').classList.toggle('notif-active', notifEnabled && Notification.permission === 'granted');
    document.getElementById('notifIcon').textContent = notifEnabled && Notification.permission === 'granted' ? '🔔' : '🔕';
    document.getElementById('notifLabel').textContent = notifEnabled && Notification.permission === 'granted' ? 'Alerte ON' : 'Notificări';
}
function dismissBanner() {
    document.getElementById('notifBanner').classList.add('hidden');
    try { localStorage.setItem(LS_NOTIF_DIS, '1'); } catch { }
}
function initNotifBanner() {
    if (!localStorage.getItem(LS_NOTIF_DIS) && Notification.permission === 'default')
        setTimeout(() => document.getElementById('notifBanner').classList.remove('hidden'), 3000);
    if (Notification.permission === 'granted') { notifEnabled = true; }
    updateNotifButton();
}

/* ─── REFRESH & MAIN ──────────────────────────────────────── */
async function loadData() {
    return await Promise.all(getActiveAssets().map(a => analyzeAsset(a)));
}

async function refreshData() {
    const btn = document.getElementById('refreshBtn');
    btn.classList.add('spinning'); btn.disabled = true;
    try {
        if (!allData.length) {
            document.getElementById('loadingState').classList.remove('hidden');
            document.getElementById('errorState').classList.add('hidden');
            document.getElementById('dashboardGrid').classList.add('hidden');
        }
        const newData = await loadData();
        processFlips(newData);
        saveSignals(newData);
        allData = newData;
        document.getElementById('loadingState').classList.add('hidden');
        document.getElementById('errorState').classList.add('hidden');
        document.getElementById('dashboardGrid').classList.remove('hidden');
        updateStatsBar();
        renderDashboard();
        const t = new Date().toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        document.getElementById('lastUpdate').querySelector('span').textContent = `Actualizat: ${t}`;
    } catch (err) {
        document.getElementById('loadingState').classList.add('hidden');
        document.getElementById('errorState').classList.remove('hidden');
        document.getElementById('dashboardGrid').classList.add('hidden');
        document.getElementById('errorMessage').textContent = err.message || 'Eroare necunoscută.';
    } finally { btn.classList.remove('spinning'); btn.disabled = false; }
}

setInterval(refreshData, 5 * 60 * 1000);
initAssets();
initNotifBanner();
refreshData();
