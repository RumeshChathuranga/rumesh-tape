# Rumesh Tape

An order-flow chart for Binance futures: footprint, delta, CVD, volume and TPO profiles, order-book liquidity, open interest and liquidations, plus a fundamentals panel.

Live: https://rumesh-tape.vercel.app

This is a restyled build of an existing tool. `original.html` is the upstream page, left untouched. Everything in `theme/` is the redesign.

## Layout

| Path | What it is |
|---|---|
| `original.html` | Upstream source (unchanged) |
| `theme/styles.css` | Midnight Cobalt theme |
| `theme/body.html` | Top bar, Studies drawer, chart markup |
| `theme/fund.html` | Fundamentals panel |
| `theme/ui.js` | Drawer, timeframe, live price, saved settings and the data badge |
| `theme/engine-prelude.js` | Runs before the engine: safe error toast, saved timeframe, symbol-switch cleanup |
| `theme/build.py` | Assembles the page, patches and re-colours the chart engine |
| `tests/` | Build checks (`test_build.py`), headless Chrome smoke tests (`smoke.mjs` for v1, `smoke-v2.mjs` for v2) and their shared harness (`cdp.mjs`) |
| `v2/` | Source of the v2 engine (TypeScript); builds into `public-site/v2/` |
| `public-site/` | Built output that Vercel serves |
| `rumesh-tape.html` | Built page for local use |

## Build

```
python3 theme/build.py
```

This rewrites `rumesh-tape.html` and `public-site/index.html`. Commit both, and Vercel deploys the push.

## Run locally

The page refuses to open from `file://`, so serve it:

```
python3 -m http.server 8765 --bind 127.0.0.1 -d public-site
```

Then open http://127.0.0.1:8765.

## Test

```
python3 -m unittest discover -s tests -v   # checks the built page
node tests/smoke.mjs                       # drives the page in headless Chrome (needs google-chrome and network)
```

## Notes

- Footprint cells for bars that existed before the page opened are estimated by the engine from candle data. Only bars printed while the page is open use real trades. The top bar shows "Real from HH:MM".
- `docs/` holds private course notes and is git-ignored. Don't commit it: this repo is public.

## v2 engine

A new engine written from scratch, live at `/v2`. Footprint cells come only from real Binance trades: it loads up to 48 hours of trades by id, closes gaps after reconnects, and caches them in the browser. Bars without real trades are drawn as plain candles. The order book is synced by update id.

```
cd v2
npm install
npm test            # unit tests
npm run build       # writes public-site/v2/
cd ..
node tests/smoke-v2.mjs
```
