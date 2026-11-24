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
| `tests/` | Build checks (`test_build.py`) and a headless Chrome smoke test (`smoke.mjs`) |
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
