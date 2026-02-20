/**
 * CryptoFlip Dashboard — app.js v2
 * ==================================
 * NOVI în v2:
 * 1. RSI (Relative Strength Index) ca al doilea indicator de confirmare
 * 2. Logică semnal CONFIRMAT vs SLAB (evitare flips false)
 * 3. Sistem de notificări browser pentru flips confirmate
 * 4. Tracking semnal anterior în localStorage
 *
 * ⚡ VIBECODING NOTES:
 *
 * DE CE RSI?
 * EMA 9/21 spune DIRECȚIA trendului (bullish/bearish)
 * RSI spune FORȚA/PUTEREA trendului (0-100)
 * RSI > 50 = există presiune de cumpărare (confirmare bullish)
 * RSI < 50 = există presiune de vânzare (confirmare bearish)
 * Dacă EMA zice bullish dar RSI e < 50 = bounce fals, nu te baza pe el
 *
 * DE CE localStorage?
 * Browser-ul nu are memorie între refresh-uri. localStorage = baza de date
 * din browser, persistentă, fără server. Stocăm semnalele anterioare pentru
 * a detecta când se SCHIMBĂ (flip nou).
 *
 * DE CE Notifications API?
 * Browser-ul modern poate trimite notificări desktop chiar și când
 * tab-ul nu e activ. Folosim Notification API (standard web, gratis).
 */

/* ========================================
   CONFIGURARE
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

const TIMEFRAMES = [
    { key: '1h', label: '1H', binanceInterval: '1h', limit: 60 },
    { key: '4h', label: '4H', binanceInterval: '4h', limit: 60 },
    { key: '1d', label: '1D', binanceInterval: '1d', limit: 60 },
    { key: '1w', label: '1W', binanceInterval: '1w', limit: 60 },
];

/* Parametri indicatori */
const EMA_FAST = 9;
const EMA_SLOW = 21;
const RSI_PERIOD = 14;       // Standard: 14 perioade
const RSI_BULL_THRESHOLD = 52; // RSI > 52 = confirmare bullish (puțin deasupra lui 50 pentru siguranță)
const RSI_BEAR_THRESHOLD = 48; // RSI < 48 = confirmare bearish

/* State global */
let allData = [];
let currentTf = '1h';
let currentSignal = 'all';
let currentSearch = '';

/* ========================================
   INDICATOR 1: EMA CALCULATOR
   ========================================
   Formula: EMA = Close * k + EMA_prev * (1 - k)
   k = 2 / (period + 1)  — factorul de "smoothing"
   ======================================== */
function calculateEMA(closes, period) {
    if (closes.length < period) return null;
    const k = 2 / (period + 1);
    // Prima EMA = media simplă a primelor N valori
    let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
    // Aplicăm formula EMA pentru restul
    for (let i = period; i < closes.length; i++) {
        ema = closes[i] * k + ema * (1 - k);
    }
    return ema;
}

/* ========================================
   INDICATOR 2: RSI CALCULATOR (Wilder's)
   ========================================
   RSI = 100 - (100 / (1 + RS))
   RS  = AvgGain / AvgLoss (pe ultimele N perioade)

   Wilder's Smoothing (mai precis decât SMA):
   AvgGain = (AvgGain_prev * (N-1) + gain_curent) / N
   
   RSI 0–30  = Supravândut (potențial revenire)
   RSI 30–50 = Zona bearish / presiune vânzare
   RSI 50–70 = Zona bullish / presiune cumpărare
   RSI 70–100 = Supracumpărat (potențial reversal)
   
   ★ Folosim RSI > RSI_BULL_THRESHOLD (≈52) = confirmare bullish
     și RSI < RSI_BEAR_THRESHOLD (≈48) = confirmare bearish
   ======================================== */
function calculateRSI(closes, period = RSI_PERIOD) {
    // Avem nevoie de cel puțin period+1 valori pentru a calcula diferențele
    if (closes.length < period + 1) return null;

    let avgGain = 0;
    let avgLoss = 0;

    // Pas 1: calculăm media inițială pe primele `period` diferențe
    for (let i = 1; i <= period; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0) avgGain += diff;
        else avgLoss += Math.abs(diff);
    }
    avgGain /= period;
    avgLoss /= period;

    // Pas 2: Wilder's Smoothing pentru restul valorilor
    for (let i = period + 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? Math.abs(diff) : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) return 100; // Nu există pierderi = RSI maxim
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

/* ========================================
   LOGICA SEMNAL CONFIRMAT
   ========================================
   Un flip este CONFIRMAT dacă AMBII indicatori
   arată în aceeași direcție:
   - CONFIRMED BULLISH: EMA9 > EMA21 ȘI RSI > 52
   - CONFIRMED BEARISH: EMA9 < EMA21 ȘI RSI < 48
   - WEAK: EMA indică ceva dar RSI nu confirmă
   ======================================== */
function getConfirmation(emSignal, rsi) {
    if (!rsi) return { confirmed: false, reason: 'date insuficiente' };

    if (emSignal === 'bullish') {
        if (rsi > RSI_BULL_THRESHOLD) {
            return { confirmed: true, reason: `RSI ${rsi.toFixed(1)} > ${RSI_BULL_THRESHOLD}` };
        } else {
            return { confirmed: false, reason: `RSI ${rsi.toFixed(1)} sub ${RSI_BULL_THRESHOLD} (fals?)` };
        }
    }
    if (emSignal === 'bearish') {
        if (rsi < RSI_BEAR_THRESHOLD) {
            return { confirmed: true, reason: `RSI ${rsi.toFixed(1)} < ${RSI_BEAR_THRESHOLD}` };
        } else {
            return { confirmed: false, reason: `RSI ${rsi.toFixed(1)} peste ${RSI_BEAR_THRESHOLD} (fals?)` };
        }
    }
    return { confirmed: false, reason: 'neutru' };
}

/* ========================================
   BINANCE PUBLIC API
   ======================================== */
const BINANCE_BASE = 'https://api.binance.com/api/v3';

async function fetchKlines(symbol, interval, limit = 60) {
    const url = `${BINANCE_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Binance ${r.status}`);
    const data = await r.json();
    return data.map(c => parseFloat(c[4])); // index 4 = close price
}

async function fetchPrice(symbol) {
    const url = `${BINANCE_BASE}/ticker/24hr?symbol=${symbol}`;
    const r = await fetch(url);
    if (!r.ok) return { price: 0, change: 0 };
    const d = await r.json();
    return { price: parseFloat(d.lastPrice), change: parseFloat(d.priceChangePercent) };
}

/* ========================================
   ANALIZĂ ASSET
   ======================================== */
async function analyzeAsset(asset) {
    const { price, change } = await fetchPrice(asset.symbol);
    const tfResults = {};

    for (const tf of TIMEFRAMES) {
        try {
            const closes = await fetchKlines(asset.symbol, tf.binanceInterval, tf.limit);

            // Calculăm EMA
            const ema9 = calculateEMA(closes, EMA_FAST);
            const ema21 = calculateEMA(closes, EMA_SLOW);

            // Calculăm RSI
            const rsi = calculateRSI(closes, RSI_PERIOD);

            if (ema9 === null || ema21 === null) {
                tfResults[tf.key] = { signal: 'neutral', ema9: null, ema21: null, diff: null, rsi: null, confirmed: false, reason: 'date insuficiente' };
                continue;
            }

            const diff = ((ema9 - ema21) / ema21) * 100;
            const emaSignal = ema9 > ema21 ? 'bullish' : 'bearish';

            // Verificăm confirmarea cu RSI
            const { confirmed, reason } = getConfirmation(emaSignal, rsi);

            tfResults[tf.key] = {
                signal: emaSignal,   // ce zice EMA
                confirmed,           // sunt de acord EMA + RSI?
                reason,              // explicație pentru UI
                ema9, ema21, diff,
                rsi,
            };
        } catch (err) {
            console.warn(`Error ${asset.symbol} ${tf.key}:`, err);
            tfResults[tf.key] = { signal: 'neutral', confirmed: false, reason: 'eroare', ema9: null, ema21: null, diff: null, rsi: null };
        }
    }

    // ========================================
    // SEMNAL OVERALL
    // Cel mai puternic semnal CONFIRMAT câștigă
    // ========================================
    const confirmedBullish = Object.values(tfResults).filter(t => t.signal === 'bullish' && t.confirmed).length;
    const confirmedBearish = Object.values(tfResults).filter(t => t.signal === 'bearish' && t.confirmed).length;

    // Orice semnal EMA (indiferent de confirmare)
    const emaBullish = Object.values(tfResults).filter(t => t.signal === 'bullish').length;
    const emaBearish = Object.values(tfResults).filter(t => t.signal === 'bearish').length;

    let overallSignal = 'neutral';
    let confirmedSignal = 'neutral'; // semnalul confirmat
    let score = 0;

    if (confirmedBullish > confirmedBearish) {
        confirmedSignal = 'confirmed-bullish';
        overallSignal = 'bullish';
        score = confirmedBullish / TIMEFRAMES.length;
    } else if (confirmedBearish > confirmedBullish) {
        confirmedSignal = 'confirmed-bearish';
        overallSignal = 'bearish';
        score = confirmedBearish / TIMEFRAMES.length;
    } else if (emaBullish > emaBearish) {
        // EMA indică bullish dar RSI nu confirmă → slab
        confirmedSignal = 'weak-bullish';
        overallSignal = 'bullish';
        score = emaBullish / TIMEFRAMES.length * 0.5;
    } else if (emaBearish > emaBullish) {
        confirmedSignal = 'weak-bearish';
        overallSignal = 'bearish';
        score = emaBearish / TIMEFRAMES.length * 0.5;
    }

    const isWeak = confirmedSignal.startsWith('weak');

    return {
        ...asset,
        price, change,
        tfResults,
        overallSignal,
        confirmedSignal,
        isWeak,
        score,
        confirmedBullish,
        confirmedBearish,
    };
}

/* ========================================
   FORMATARE
   ======================================== */
function formatPrice(p) {
    if (!p) return '–';
    if (p >= 1000) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (p >= 1) return '$' + p.toFixed(4);
    return '$' + p.toFixed(6);
}

function formatDiff(d) {
    if (d === null || d === undefined) return '–';
    return (d >= 0 ? '+' : '') + d.toFixed(3) + '%';
}

function formatRSI(rsi) {
    if (!rsi) return '–';
    return rsi.toFixed(1);
}

function getRSIColor(rsi, signal) {
    if (!rsi) return 'var(--text-muted)';
    if (signal === 'bullish' && rsi > RSI_BULL_THRESHOLD) return 'var(--bullish)';
    if (signal === 'bearish' && rsi < RSI_BEAR_THRESHOLD) return 'var(--bearish)';
    return '#f59e0b'; // galben = nu confirmă
}

/* ========================================
   RENDER CARD
   ======================================== */
function getSignalEmoji(signal, confirmed) {
    if (signal === 'bullish') return confirmed ? '🟢' : '🟡';
    if (signal === 'bearish') return confirmed ? '🔴' : '🟠';
    return '⚪';
}

function buildCard(data, index) {
    const delayStyle = `animation-delay: ${index * 0.05}s`;

    const tfCells = TIMEFRAMES.map(tf => {
        const t = data.tfResults[tf.key];
        const cellClass = t.confirmed
            ? `cell-${t.signal} cell-confirmed`
            : t.signal !== 'neutral' ? `cell-${t.signal} cell-weak` : '';

        const rsiColor = getRSIColor(t.rsi, t.signal);
        const rsiStr = t.rsi ? formatRSI(t.rsi) : '–';
        const diffStr = t.diff !== null ? formatDiff(t.diff) : '–';

        return `
      <div class="tf-cell ${cellClass}">
        <span class="tf-label">${tf.label}</span>
        <span class="tf-signal">${getSignalEmoji(t.signal, t.confirmed)}</span>
        <span class="tf-ema-diff">${diffStr}</span>
        <span class="tf-rsi" style="color:${rsiColor}">RSI ${rsiStr}</span>
      </div>
    `;
    }).join('');

    /* Badge */
    let badgeClass, badgeText;
    if (data.confirmedSignal === 'confirmed-bullish') {
        badgeClass = 'badge-confirmed-bullish'; badgeText = '✅ Bullish';
    } else if (data.confirmedSignal === 'confirmed-bearish') {
        badgeClass = 'badge-confirmed-bearish'; badgeText = '⛔ Bearish';
    } else if (data.confirmedSignal === 'weak-bullish') {
        badgeClass = 'badge-weak'; badgeText = '⚠️ Bullish';
    } else if (data.confirmedSignal === 'weak-bearish') {
        badgeClass = 'badge-weak'; badgeText = '⚠️ Bearish';
    } else {
        badgeClass = 'badge-neutral'; badgeText = '⏸ Neutru';
    }

    const cardClass = data.confirmedSignal.includes('bullish') ? 'bullish-card'
        : data.confirmedSignal.includes('bearish') ? 'bearish-card'
            : 'neutral-card';

    const changeClass = data.change >= 0 ? 'positive' : 'negative';
    const changeStr = (data.change >= 0 ? '+' : '') + data.change.toFixed(2) + '%';

    const fillClass = data.overallSignal === 'bullish' ? 'fill-bullish'
        : data.overallSignal === 'bearish' ? 'fill-bearish' : 'fill-neutral';
    const fillWidth = Math.round(data.score * 100);

    const pfCount = data.confirmedBullish > data.confirmedBearish
        ? data.confirmedBullish : data.confirmedBearish;
    const scoreText = data.confirmedSignal === 'neutral' ? 'Mix'
        : `${pfCount}/4 conf.`;

    return `
    <div class="asset-card ${cardClass} ${data.isWeak ? 'weak-card' : ''}"
         style="${delayStyle}"
         onclick="openModal('${data.symbol}')"
         id="card-${data.symbol}"
         data-signal="${data.confirmedSignal}"
         data-name="${data.name.toLowerCase()}"
         data-symbol="${data.symbol.toLowerCase()}">
      <div class="card-header">
        <div class="asset-info">
          <div class="asset-icon" style="color:${data.color};background:${data.color}22;">
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
          <div class="score-bar-fill ${fillClass}" style="width:${fillWidth}%"></div>
        </div>
        <span class="score-label">${scoreText}</span>
      </div>
    </div>
  `;
}

/* ========================================
   STATS BAR
   ======================================== */
function updateStatsBar() {
    const confirmed_b = allData.filter(d => d.confirmedSignal === 'confirmed-bullish').length;
    const confirmed_be = allData.filter(d => d.confirmedSignal === 'confirmed-bearish').length;
    const weak = allData.filter(d => d.isWeak).length;
    const neutral = allData.filter(d => d.confirmedSignal === 'neutral').length;

    document.getElementById('bullishCount').textContent = confirmed_b;
    document.getElementById('bearishCount').textContent = confirmed_be;
    document.getElementById('weakCount').textContent = weak;
    document.getElementById('neutralCount').textContent = neutral;
    document.getElementById('totalAssets').textContent = allData.length;
}

/* ========================================
   FILTRE
   ======================================== */
function getFilteredData() {
    return allData.filter(data => {
        // Determină semnalul relevant pentru TF-ul selectat sau overall
        let sigToCheck = data.confirmedSignal;
        if (currentTf !== 'all') {
            const tfData = data.tfResults[currentTf];
            if (tfData) {
                if (tfData.confirmed && tfData.signal === 'bullish') sigToCheck = 'confirmed-bullish';
                else if (tfData.confirmed && tfData.signal === 'bearish') sigToCheck = 'confirmed-bearish';
                else if (!tfData.confirmed && tfData.signal !== 'neutral') sigToCheck = `weak-${tfData.signal}`;
                else sigToCheck = 'neutral';
            }
        }

        let matchesSignal = false;
        if (currentSignal === 'all') matchesSignal = true;
        else if (currentSignal === 'confirmed-bullish') matchesSignal = sigToCheck === 'confirmed-bullish';
        else if (currentSignal === 'confirmed-bearish') matchesSignal = sigToCheck === 'confirmed-bearish';
        else if (currentSignal === 'weak') matchesSignal = sigToCheck.startsWith('weak');

        const searchStr = currentSearch.toLowerCase();
        const matchesSearch = !searchStr ||
            data.name.toLowerCase().includes(searchStr) ||
            data.symbol.toLowerCase().includes(searchStr);

        return matchesSignal && matchesSearch;
    });
}

function renderDashboard() {
    const grid = document.getElementById('dashboardGrid');
    const filtered = getFilteredData();
    if (filtered.length === 0) {
        grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:60px 0;color:var(--text-muted);">
        <div style="font-size:40px;margin-bottom:12px;">🔍</div>
        <p>Niciun asset nu corespunde filtrelor selectate.</p>
      </div>`;
        return;
    }
    grid.innerHTML = filtered.map((d, i) => buildCard(d, i)).join('');
}

function filterTimeframe(tf) {
    currentTf = tf;
    document.querySelectorAll('.tf-btn').forEach(b => b.classList.toggle('active', b.dataset.tf === tf));
    renderDashboard();
}

function filterSignal(signal) {
    currentSignal = signal;
    document.querySelectorAll('.signal-btn').forEach(b => b.classList.toggle('active', b.dataset.signal === signal));
    renderDashboard();
}

function filterSearch(value) {
    currentSearch = value;
    renderDashboard();
}

/* ========================================
   MODAL DETALIU
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

    document.getElementById('modalTimeframes').innerHTML = TIMEFRAMES.map(tf => {
        const t = data.tfResults[tf.key];
        const cardClass = t.confirmed ? `modal-${t.signal}` : t.signal !== 'neutral' ? 'modal-weak' : '';

        const signalLabel = t.confirmed
            ? (t.signal === 'bullish' ? '✅ Confirmat Bullish' : '⛔ Confirmat Bearish')
            : t.signal !== 'neutral' ? '⚠️ Semnal Slab' : '⏸ Neutru';

        const rsiBarWidth = t.rsi ? Math.min(100, t.rsi) : 0;
        const rsiColor = getRSIColor(t.rsi, t.signal);

        return `
      <div class="modal-tf-card ${cardClass}">
        <div class="modal-tf-header">
          <span class="modal-tf-name">${tf.label}</span>
          <span class="modal-tf-signal">${getSignalEmoji(t.signal, t.confirmed)}</span>
        </div>
        <div class="modal-signal-label">${signalLabel}</div>
        <div class="modal-ema-row">
          <div class="modal-ema-item">
            <span class="modal-ema-label">EMA ${EMA_FAST}</span>
            <span class="modal-ema-value">${t.ema9 ? formatPrice(t.ema9) : '–'}</span>
          </div>
          <div class="modal-ema-item">
            <span class="modal-ema-label">EMA ${EMA_SLOW}</span>
            <span class="modal-ema-value">${t.ema21 ? formatPrice(t.ema21) : '–'}</span>
          </div>
          <div class="modal-ema-item" style="margin-top:4px;">
            <span class="modal-ema-label">Δ EMA</span>
            <span class="modal-ema-diff ${t.signal === 'bullish' ? 'diff-bullish' : 'diff-bearish'}">${formatDiff(t.diff)}</span>
          </div>
        </div>
        <!-- RSI Visual -->
        <div class="rsi-block">
          <div class="rsi-row">
            <span class="rsi-label">RSI ${RSI_PERIOD}</span>
            <span class="rsi-value" style="color:${rsiColor}">${formatRSI(t.rsi)}</span>
          </div>
          <div class="rsi-track">
            <div class="rsi-zone rsi-zone-bear"></div>
            <div class="rsi-zone rsi-zone-mid"></div>
            <div class="rsi-zone rsi-zone-bull"></div>
            <div class="rsi-pointer" style="left:${rsiBarWidth}%;background:${rsiColor};"></div>
          </div>
          <div class="rsi-labels">
            <span>0</span><span style="margin-left:30%">30</span>
            <span style="margin-left:18%">50</span>
            <span style="margin-left:18%">70</span>
            <span style="margin-left:auto">100</span>
          </div>
          <div class="rsi-reason">${t.reason}</div>
        </div>
      </div>
    `;
    }).join('');

    document.getElementById('modalOverlay').classList.remove('hidden');
}

function closeModal(event) {
    if (event.target === document.getElementById('modalOverlay')) closeModalDirect();
}
function closeModalDirect() {
    document.getElementById('modalOverlay').classList.add('hidden');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModalDirect(); });

/* ========================================================
   SISTEM NOTIFICĂRI BROWSER
   ========================================================
   Cum funcționează:
   1. Utilizatorul trebuie să ACCEPTE notificările (Notifications API)
   2. La fiecare refresh, comparăm semnalele noi cu cele vechi din localStorage
   3. Dacă semnalul s-a SCHIMBAT și noul semnal e CONFIRMAT → notificație
   4. Stocăm semnalele curente în localStorage pentru comparație viitoare

   ⚡ NOTĂ: Notificările funcționează DOAR pe HTTPS (GitHub Pages = OK!)
   Pe file:// (local) pot funcționa în unele browsere.
   ======================================================== */
const LS_SIGNALS_KEY = 'cryptoflip_signals_v2';
const LS_NOTIF_DISMISSED = 'cryptoflip_notif_dismissed';
let notifEnabled = false;

/* Citim semnalele salvate anterior */
function loadPreviousSignals() {
    try {
        const raw = localStorage.getItem(LS_SIGNALS_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}

/* Salvăm semnalele curente */
function saveCurrentSignals(data) {
    const map = {};
    for (const d of data) {
        map[d.symbol] = {
            confirmedSignal: d.confirmedSignal,
            isWeak: d.isWeak,
            price: d.price,
        };
    }
    try { localStorage.setItem(LS_SIGNALS_KEY, JSON.stringify(map)); } catch { }
}

/* Detectăm flip-urile noi față de sesiunea anterioară */
function detectFlips(newData) {
    const prev = loadPreviousSignals();
    const flips = [];

    for (const d of newData) {
        const p = prev[d.symbol];
        if (!p) continue; // prima rulare — nu avem cu ce compara

        const wasConfirmed = !p.isWeak && p.confirmedSignal !== 'neutral';
        const isConfirmedNow = !d.isWeak && d.confirmedSignal !== 'neutral';

        // Semnalul s-a schimbat ȘI noul semnal e confirmat = flip real!
        if (p.confirmedSignal !== d.confirmedSignal && isConfirmedNow) {
            flips.push({
                symbol: d.symbol,
                name: d.name,
                icon: d.icon,
                from: p.confirmedSignal,
                to: d.confirmedSignal,
                price: d.price,
            });
        }
    }

    return flips;
}

/* Trimite notificație pentru un flip */
function sendFlipNotification(flip) {
    if (Notification.permission !== 'granted') return;

    const isBull = flip.to.includes('bullish');
    const title = `${flip.icon} ${flip.name} — ${isBull ? '✅ BULLISH FLIP!' : '⛔ BEARISH FLIP!'}`;
    const body = `${flip.symbol} a trecut de la ${flip.from} la ${flip.to}.\nPreț: ${formatPrice(flip.price)}\nEMA 9/21 + RSI confirmate.`;

    try {
        const notif = new Notification(title, {
            body,
            icon: 'https://mar1uz.github.io/cryptoflip-dashboard/icon.png',
            badge: 'https://mar1uz.github.io/cryptoflip-dashboard/icon.png',
            tag: flip.symbol, // IMPORTANT: previne spam, înlocuiește notif anterioară pt acelaș asset
            requireInteraction: false,
        });

        // Click pe notificație → focusăm tab-ul și deschidem modalul
        notif.onclick = () => {
            window.focus();
            openModal(flip.symbol);
            notif.close();
        };
    } catch (err) {
        console.warn('Notificație eșuată:', err);
    }
}

/* Procesează toate flip-urile detectate */
function processFlips(newData) {
    const flips = detectFlips(newData);
    if (flips.length === 0) return;

    console.log(`🔔 ${flips.length} flip(uri) detectate:`, flips);

    if (notifEnabled && Notification.permission === 'granted') {
        for (const flip of flips) {
            sendFlipNotification(flip);
        }
    }
}

/* Toggle notificări */
function toggleNotifications() {
    if (Notification.permission === 'granted') {
        // Deja activ → dezactivăm
        notifEnabled = !notifEnabled;
        updateNotifButton();
    } else if (Notification.permission === 'denied') {
        alert('Notificările sunt blocate în browser. Mergi la Setări Site → Notificări → Permite.');
    } else {
        // pending → cerem permisiunea
        requestNotifPermission();
    }
}

async function requestNotifPermission() {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
        notifEnabled = true;
        updateNotifButton();
        document.getElementById('notifBanner').classList.add('hidden');
        // Trimitem o notificație de test
        new Notification('✅ CryptoFlip Alerts Active', {
            body: 'Vei fi notificat când se detectează un flip confirmat (EMA + RSI).',
            tag: 'test',
        });
    } else {
        alert('Permisiunea a fost refuzată. Poți reactiva din setările browserului.');
    }
}

function updateNotifButton() {
    const btn = document.getElementById('notifBtn');
    const icon = document.getElementById('notifIcon');
    const label = document.getElementById('notifLabel');

    if (notifEnabled && Notification.permission === 'granted') {
        btn.classList.add('notif-active');
        icon.textContent = '🔔';
        label.textContent = 'Alerte ON';
    } else {
        btn.classList.remove('notif-active');
        icon.textContent = '🔕';
        label.textContent = 'Notificări';
    }
}

function dismissBanner() {
    document.getElementById('notifBanner').classList.add('hidden');
    try { localStorage.setItem(LS_NOTIF_DISMISSED, '1'); } catch { }
}

/* Arată banner la prima vizită dacă notificările nu sunt setate */
function initNotifBanner() {
    const dismissed = localStorage.getItem(LS_NOTIF_DISMISSED);
    if (!dismissed && Notification.permission === 'default') {
        setTimeout(() => {
            document.getElementById('notifBanner').classList.remove('hidden');
        }, 3000); // apare după 3 secunde
    }
    if (Notification.permission === 'granted') {
        notifEnabled = true;
        updateNotifButton();
    } else {
        updateNotifButton();
    }
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
    // Fetchăm toți assets-urile în paralel (Promise.all = concurrent, nu secvențial)
    return await Promise.all(ASSETS.map(asset => analyzeAsset(asset)));
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

        const newData = await loadData();

        // Detectăm flip-uri ÎNAINTE să salvăm noile semnale
        processFlips(newData);

        // Salvăm semnalele curente în localStorage
        saveCurrentSignals(newData);

        allData = newData;

        loadingState.classList.add('hidden');
        errorState.classList.add('hidden');
        grid.classList.remove('hidden');

        updateStatsBar();
        renderDashboard();
        updateLastUpdateTime();

    } catch (err) {
        console.error('Eroare:', err);
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
setInterval(refreshData, 5 * 60 * 1000);

/* Pornire */
initNotifBanner();
refreshData();
