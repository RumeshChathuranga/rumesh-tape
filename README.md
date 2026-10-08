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
| `theme/ui.js` | Drawer, timeframe and live price wiring |
| `theme/build.py` | Assembles the page and re-colours the chart engine |
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
