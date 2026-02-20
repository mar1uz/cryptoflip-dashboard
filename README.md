# CryptoFlip Dashboard 📊

Un dashboard web **real-time** care detectează flip-uri **bullish** și **bearish** pe multiple timeframe-uri pentru principalele crypto assets.

🔗 **Live Demo**: [https://YOUR_USERNAME.github.io/cryptoflip-dashboard](https://YOUR_USERNAME.github.io/cryptoflip-dashboard)

---

## 🚀 Features

- ✅ **12 crypto assets**: BTC, ETH, SOL, BNB, XRP, ADA, AVAX, DOGE, DOT, MATIC, LINK, UNI
- ✅ **4 timeframe-uri**: 1H, 4H, 1D, 1W
- ✅ **Indicator EMA 9/21 crossover** — semnal bullish/bearish per timeframe
- ✅ **Filtrare** după timeframe, tip semnal și search
- ✅ **Modal detalii** per asset cu toate EMA-urile
- ✅ **Auto-refresh** la 5 minute
- ✅ **100% static** — fără backend, fără costuri

---

## 🧠 Cum funcționează?

### Logica Bullish/Bearish
Folosim **EMA Crossover**:
- `EMA 9` (rapid) > `EMA 21` (lent) = **🟢 BULLISH** — trendul e ascendent
- `EMA 9` < `EMA 21` = **🔴 BEARISH** — trendul e descendent

### Stack Tehnic
| Componenta | Tehnologie | Motiv |
|---|---|---|
| Frontend | HTML + CSS + JS pur | GitHub Pages = static files |
| Date | Binance Public REST API | Gratuit, fără autentificare |
| Indicatori | EMA 9/21 calculat local | Nu avem nevoie de librării |
| Hosting | GitHub Pages | Gratuit, simplu |

---

## 📦 Deploy pe GitHub Pages

1. Fork sau clonează acest repository
2. Du-te la **Settings** → **Pages**
3. Sub **Source**, selectează `Deploy from a branch`
4. Selectează branch-ul `main` și folderul `/ (root)`
5. Click **Save**
6. Gata! Site-ul e live la `https://YOUR_USERNAME.github.io/REPO_NAME`

---

## 🛠️ Rulare locală (opțional)

```bash
# Clonează repo-ul
git clone https://github.com/YOUR_USERNAME/cryptoflip-dashboard.git
cd cryptoflip-dashboard

# Pornire server local simplu
python3 -m http.server 8000
# sau
npx serve .

# Deschide http://localhost:8000
```

---

## ⚠️ Disclaimer

Acest dashboard este **exclusiv educațional**. Nu constitituie sfat financiar. Semnalele tehnice nu garantează performanța viitoare.
