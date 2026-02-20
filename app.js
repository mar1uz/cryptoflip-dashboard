/**
 * CryptoFlip Dashboard — app.js
 * =============================
 * Logica principală:
 * 1. Definim assets-urile (crypto pairs de pe Binance)
 * 2. Fetchăm candlestick data de pe Binance Public REST API
 * 3. Calculăm EMA (Exponential Moving Average) cu perioadele 9 și 21
 * 4. Dacă EMA9 > EMA21 → BULLISH; EMA9 < EMA21 → BEARISH
 * 5. Randăm cardurile și facem totul interactiv
 *
 * ⚡ VIBECODING NOTES:
 * - Nu avem backend! Totul rulează în browser.
 * - Binance API este PUBLIC — nu necesită API key pentru datele OHLCV.
 * - EMA este indicatorul tehnic cel mai simplu și eficient pentru trend.
 * - GitHub Pages hostează fișiere statice (HTML/CSS/JS) GRATIS.
 */

/* ========================================
   CONFIGURARE — Adaugă/Scoate assets aici
   ======================================== */
const ASSETS = [
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

/* Timeframe-uri suportate:
   - Binance acceptă: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M */
const TIMEFRAMES = [
    { key: '1h', label: '1H', binanceInterval: '1h', limit: 50 },
    { key: '4h', label: '4H', binanceInterval: '4h', limit: 50 },
    { key: '1d', label: '1D', binanceInterval: '1d', limit: 50 },
    { key: '1w', label: '1W', binanceInterval: '1w', limit: 50 },
];

/* EMA periods */
const EMA_FAST = 9;
const EMA_SLOW = 21;

/* State global */
let allData = [];         // Toate datele calculate
let currentTf = '1h';    // Timeframe activ în filtru
let currentSignal = 'all'; // Filtru semnal
let currentSearch = '';   // Filtru search

/* ========================================
   EMA CALCULATOR
   ========================================
   EMA (Exponential Moving Average) este un
   moving average care pune mai mult accent
   pe prețurile RECENTE comparativ cu SMA.
   
   Formula: EMA = Price * k + EMA_prev * (1 - k)
   unde k = 2 / (N + 1)  (N = perioadă)
   ======================================== */
function calculateEMA(closes, period) {
    if (closes.length < period) return null;

    const k = 2 / (period + 1);

    // Calculăm prima EMA ca simplă medie aritmetică
    let ema = closes.slice(0, period).reduce((sum, v) => sum + v, 0) / period;

    // Aplicăm formula EMA pentru restul datelor
    for (let i = period; i < closes.length; i++) {
        ema = closes[i] * k + ema * (1 - k);
    }

    return ema;
}

/* ========================================
   FETCH DATE DE LA BINANCE PUBLIC API
   ========================================
   Endpoint: GET /api/v3/klines
   Params:
   - symbol: ex. BTCUSDT
   - interval: ex. 1h, 4h, 1d
   - limit: câte lumânări (max 1000)
   
   Răspuns: array de arrays cu:
   [0] Open time
   [1] Open
   [2] High
   [3] Low
   [4] Close  ← folosim asta
   [5] Volume
   ... etc
   ======================================== */
const BINANCE_BASE = 'https://api.binance.com/api/v3';

async function fetchKlines(symbol, interval, limit = 50) {
    const url = `${BINANCE_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Binance API error: ${response.status}`);
    const data = await response.json();
    // Extragem doar prețul de Close (index 4) și îl convertim la număr
    return data.map(candle => parseFloat(candle[4]));
}

/* Fetch prețul curent al unui asset */
async function fetchPrice(symbol) {
    const url = `${BINANCE_BASE}/ticker/24hr?symbol=${symbol}`;
    const response = await fetch(url);
    if (!response.ok) return { price: 0, change: 0 };
    const data = await response.json();
    return {
        price: parseFloat(data.lastPrice),
        change: parseFloat(data.priceChangePercent),
    };
}

/* ========================================
   ANALIZĂ ASSET — Calculăm semnalul
   ======================================== */
async function analyzeAsset(asset) {
    // Fetchăm prețul curent
    const { price, change } = await fetchPrice(asset.symbol);

    // Analizăm fiecare timeframe
    const tfResults = {};

    for (const tf of TIMEFRAMES) {
        try {
            // Fetchăm candlestick data
            const closes = await fetchKlines(asset.symbol, tf.binanceInterval, tf.limit);

            // Calculăm EMA9 și EMA21
            const ema9 = calculateEMA(closes, EMA_FAST);
            const ema21 = calculateEMA(closes, EMA_SLOW);

            if (ema9 === null || ema21 === null) {
                tfResults[tf.key] = { signal: 'neutral', ema9: null, ema21: null, diff: null };
                continue;
            }

            // Determinăm semnalul
            const diff = ((ema9 - ema21) / ema21) * 100; // diferența în procente
            const signal = ema9 > ema21 ? 'bullish' : 'bearish';

            tfResults[tf.key] = { signal, ema9, ema21, diff };
        } catch (err) {
            console.warn(`Eroare ${asset.symbol} ${tf.key}:`, err);
            tfResults[tf.key] = { signal: 'neutral', ema9: null, ema21: null, diff: null };
        }
    }

    // Calculăm semnalul OVERALL (majoritate)
    const signals = Object.values(tfResults).map(t => t.signal);
    const bullishCount = signals.filter(s => s === 'bullish').length;
    const bearishCount = signals.filter(s => s === 'bearish').length;

    let overallSignal = 'neutral';
    let score = 0;
    if (bullishCount > bearishCount) {
        overallSignal = 'bullish';
        score = bullishCount / signals.length;
    } else if (bearishCount > bullishCount) {
        overallSignal = 'bearish';
        score = bearishCount / signals.length;
    } else if (bullishCount === bearishCount && bullishCount > 0) {
        score = 0.5;
    }

    return {
        ...asset,
        price,
        change,
        tfResults,
        overallSignal,
        score,
        bullishTfCount: bullishCount,
        bearishTfCount: bearishCount,
    };
}

/* ========================================
   FORMATARE PREȚ
   ======================================== */
function formatPrice(price) {
    if (price >= 1000) return '$' + price.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (price >= 1) return '$' + price.toFixed(4);
    return '$' + price.toFixed(6);
}

function formatEMA(ema, price) {
    if (!ema) return '–';
    return formatPrice(ema);
}

function formatDiff(diff) {
    if (diff === null) return '–';
    const sign = diff >= 0 ? '+' : '';
    return sign + diff.toFixed(3) + '%';
}

/* ========================================
   RENDER — Construim HTML-ul cardurilor
   ======================================== */
function getSignalEmoji(signal) {
    return signal === 'bullish' ? '🟢' : signal === 'bearish' ? '🔴' : '⚪';
}

function buildCard(data, index) {
    const delayStyle = `animation-delay: ${index * 0.05}s`;

    const tfCells = TIMEFRAMES.map(tf => {
        const tfData = data.tfResults[tf.key];
        const cellClass = `cell-${tfData.signal}`;
        const diffStr = tfData.diff !== null ? formatDiff(tfData.diff) : '–';
        return `
      <div class="tf-cell ${cellClass}">
        <span class="tf-label">${tf.label}</span>
        <span class="tf-signal">${getSignalEmoji(tfData.signal)}</span>
        <span class="tf-ema-diff">${diffStr}</span>
      </div>
    `;
    }).join('');

    const badgeClass = `badge-${data.overallSignal}`;
    const badgeText = data.overallSignal === 'bullish' ? 'Bullish' :
        data.overallSignal === 'bearish' ? 'Bearish' : 'Neutru';

    const changeClass = data.change >= 0 ? 'positive' : 'negative';
    const changeStr = (data.change >= 0 ? '+' : '') + data.change.toFixed(2) + '%';

    const fillClass = data.overallSignal === 'bullish' ? 'fill-bullish' :
        data.overallSignal === 'bearish' ? 'fill-bearish' : 'fill-neutral';
    const fillWidth = Math.round(data.score * 100);
    const scoreText = data.overallSignal === 'bullish' ? `${data.bullishTfCount}/4 TF` :
        data.overallSignal === 'bearish' ? `${data.bearishTfCount}/4 TF` : 'Mix';

    const iconStyle = `color: ${data.color}; background: ${data.color}22;`;

    return `
    <div class="asset-card ${data.overallSignal}-card"
         style="${delayStyle}"
         onclick="openModal('${data.symbol}')"
         id="card-${data.symbol}"
         data-signal="${data.overallSignal}"
         data-name="${data.name.toLowerCase()}"
         data-symbol="${data.symbol.toLowerCase()}">
      <div class="card-header">
        <div class="asset-info">
          <div class="asset-icon" style="${iconStyle}">
            <span>${data.icon}</span>
          </div>
          <div>
            <div class="asset-name">${data.name}</div>
            <div class="asset-symbol">${data.symbol}</div>
          </div>
        </div>
        <span class="overall-badge ${badgeClass}">${badgeText}</span>
      </div>
      <div class="price-row">
        <span class="asset-price">${formatPrice(data.price)}</span>
        <span class="price-change ${changeClass}">${changeStr}</span>
      </div>
      <div class="tf-grid">
        ${tfCells}
      </div>
      <div class="score-bar-wrap">
        <div class="score-bar-track">
          <div class="score-bar-fill ${fillClass}" style="width: ${fillWidth}%"></div>
        </div>
        <span class="score-label">${scoreText}</span>
      </div>
    </div>
  `;
}

function updateStatsBar() {
    const bullish = allData.filter(d => d.overallSignal === 'bullish').length;
    const bearish = allData.filter(d => d.overallSignal === 'bearish').length;
    const neutral = allData.filter(d => d.overallSignal === 'neutral').length;

    document.getElementById('bullishCount').textContent = bullish;
    document.getElementById('bearishCount').textContent = bearish;
    document.getElementById('neutralCount').textContent = neutral;
    document.getElementById('totalAssets').textContent = allData.length;
}

function renderDashboard() {
    const grid = document.getElementById('dashboardGrid');
    const filtered = getFilteredData();

    if (filtered.length === 0) {
        grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 60px 0; color: var(--text-muted);">
        <div style="font-size: 40px; margin-bottom: 12px;">🔍</div>
        <p>Niciun asset nu corespunde filtrelor selectate.</p>
      </div>
    `;
        return;
    }

    grid.innerHTML = filtered.map((data, i) => buildCard(data, i)).join('');
}

function getFilteredData() {
    return allData.filter(data => {
        // Filtru semnal pe baza timeframe-ului selectat
        let signal = data.overallSignal;
        if (currentTf !== 'all') {
            const tfSignal = data.tfResults[currentTf]?.signal;
            signal = tfSignal || 'neutral';
        }

        const matchesSignal = currentSignal === 'all' || signal === currentSignal;
        const searchStr = currentSearch.toLowerCase();
        const matchesSearch = !searchStr ||
            data.name.toLowerCase().includes(searchStr) ||
            data.symbol.toLowerCase().includes(searchStr);

        return matchesSignal && matchesSearch;
    });
}

/* ========================================
   MODAL DETALIU ASSET
   ======================================== */
function openModal(symbol) {
    const data = allData.find(d => d.symbol === symbol);
    if (!data) return;

    document.getElementById('modalTitle').textContent = data.name;
    document.getElementById('modalSymbol').textContent = data.symbol;
    document.getElementById('modalPrice').textContent = formatPrice(data.price);
    document.getElementById('modalIcon').textContent = data.icon;
    document.getElementById('modalIcon').style.background = `${data.color}22`;
    document.getElementById('modalIcon').style.color = data.color;

    // Construim cardurile pentru fiecare timeframe
    const tfContainer = document.getElementById('modalTimeframes');
    tfContainer.innerHTML = TIMEFRAMES.map(tf => {
        const tfData = data.tfResults[tf.key];
        const cardClass = `modal-${tfData.signal}`;

        const ema9Str = tfData.ema9 ? formatPrice(tfData.ema9) : '–';
        const ema21Str = tfData.ema21 ? formatPrice(tfData.ema21) : '–';
        const diffStr = tfData.diff !== null ? formatDiff(tfData.diff) : '–';
        const diffClass = tfData.signal === 'bullish' ? 'diff-bullish' : tfData.signal === 'bearish' ? 'diff-bearish' : '';

        return `
      <div class="modal-tf-card ${cardClass}">
        <div class="modal-tf-header">
          <span class="modal-tf-name">${tf.label}</span>
          <span class="modal-tf-signal">${getSignalEmoji(tfData.signal)}</span>
        </div>
        <div class="modal-ema-row">
          <div class="modal-ema-item">
            <span class="modal-ema-label">EMA ${EMA_FAST}</span>
            <span class="modal-ema-value">${ema9Str}</span>
          </div>
          <div class="modal-ema-item">
            <span class="modal-ema-label">EMA ${EMA_SLOW}</span>
            <span class="modal-ema-value">${ema21Str}</span>
          </div>
          <div style="margin-top: 8px;">
            <span class="modal-ema-diff ${diffClass}">Δ ${diffStr}</span>
          </div>
        </div>
      </div>
    `;
    }).join('');

    document.getElementById('modalOverlay').classList.remove('hidden');
}

function closeModal(event) {
    if (event.target === document.getElementById('modalOverlay')) {
        closeModalDirect();
    }
}

function closeModalDirect() {
    document.getElementById('modalOverlay').classList.add('hidden');
}

// Închide modal cu Escape
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModalDirect();
});

/* ========================================
   FILTRE
   ======================================== */
function filterTimeframe(tf) {
    currentTf = tf;
    document.querySelectorAll('.tf-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tf === tf);
    });
    renderDashboard();
}

function filterSignal(signal) {
    currentSignal = signal;
    document.querySelectorAll('.signal-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.signal === signal);
    });
    renderDashboard();
}

function filterSearch(value) {
    currentSearch = value;
    renderDashboard();
}

/* ========================================
   REFRESH & MAIN FLOW
   ======================================== */
function updateLastUpdateTime() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    document.getElementById('lastUpdate').querySelector('span').textContent = `Actualizat: ${timeStr}`;
}

async function loadData() {
    // Fetch toate assets-urile în paralel (Promise.all = mai rapid)
    const promises = ASSETS.map(asset => analyzeAsset(asset));
    const results = await Promise.all(promises);
    return results;
}

async function refreshData() {
    const btn = document.getElementById('refreshBtn');
    btn.classList.add('spinning');
    btn.disabled = true;

    try {
        const loadingState = document.getElementById('loadingState');
        const errorState = document.getElementById('errorState');
        const grid = document.getElementById('dashboardGrid');

        if (allData.length === 0) {
            loadingState.classList.remove('hidden');
            errorState.classList.add('hidden');
            grid.classList.add('hidden');
        }

        allData = await loadData();

        loadingState.classList.add('hidden');
        errorState.classList.add('hidden');
        grid.classList.remove('hidden');

        updateStatsBar();
        renderDashboard();
        updateLastUpdateTime();

    } catch (err) {
        console.error('Eroare la refresh:', err);
        document.getElementById('loadingState').classList.add('hidden');
        document.getElementById('errorState').classList.remove('hidden');
        document.getElementById('dashboardGrid').classList.add('hidden');
        document.getElementById('errorMessage').textContent = err.message || 'Eroare necunoscută.';
    } finally {
        btn.classList.remove('spinning');
        btn.disabled = false;
    }
}

/* Auto-refresh la fiecare 5 minute */
const AUTO_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minute
setInterval(() => {
    refreshData();
}, AUTO_REFRESH_INTERVAL);

/* Pornire */
refreshData();
