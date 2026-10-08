#!/usr/bin/env python3
"""Build the Midnight Cobalt edition of the market tool.

Reads the untouched original (original.html), swaps in the new head
styles, markup and fundamentals panel from this folder, re-colours the
canvas engine's string literals, and writes:

    rumesh-tape.html          (local copy)
    public-site/index.html    (what gets deployed to Vercel)

Run:  python3 theme/build.py
"""
import collections
import pathlib
import re
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
THEME = ROOT / "theme"
APP_NAME = "Rumesh Tape"          # shown in the tab title and the top bar
APP_SLUG = "rumesh-tape"          # local file name and Vercel project name

SRC = ROOT / "original.html"
OUT_LOCAL = ROOT / (APP_SLUG + ".html")
OUT_DIR = ROOT / "public-site"

# ---------------------------------------------------------------- palette
# Midnight Cobalt
UP, DN = "#3A86FF", "#F0506E"
BONE, MUTED, FAINT = "#E8EDF5", "#7B8698", "#4A5366"
STEEL, PLUM, SAND, COPPER, ROSE, OLIVE = "#8CC2FF", "#9D8CFF", "#E6B85C", "#F08A5D", "#F27BA6", "#7FD1A0"
BG, GRID, LINE, LINE2 = "#07080B", "#10131A", "#1C212B", "#2A3140"

HEX = {}
def _hex(target, *sources):
    for s in sources:
        HEX[s.upper()] = target
_hex(UP, "#10B981")
_hex(DN, "#EF4444", "#FF0000")
_hex(BONE, "#FFFFFF", "#FFF", "#F1F5F9", "#F8FAFC", "#D1D5DB")
_hex(MUTED, "#94A3B8", "#9CA3AF", "#64748B")
_hex(FAINT, "#475569", "#666")
_hex(STEEL, "#00FFFF", "#00E5FF", "#60A5FA", "#2962FF", "#3B82F6")
_hex(PLUM, "#FF00FF", "#FF4ECD", "#8A2BE2", "#A855F7", "#A78BFA")
_hex(ROSE, "#F472B6", "#FF3366", "#E11D48")
_hex(SAND, "#FFD700", "#FFEA00", "#FFFF00", "#FDE047", "#EAB308", "#F59E0B", "#FFA500", "#FACC15")
_hex(COPPER, "#F97316", "#FF6B00", "#FF4500")
_hex(OLIVE, "#84CC16")
_hex(LINE, "#1F2937", "#334155")
_hex(LINE2, "#374151")
_hex(BG, "#070B14", "#060A12", "#0A0F17", "#090D14", "#080C14")
_hex(GRID, "#101721")

def _rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

RGB = {}
def _trip(target_hex, *sources):
    for s in sources:
        RGB[s] = _rgb(target_hex)
_trip(DN, (239, 68, 68))
_trip(UP, (16, 185, 129))
_trip(BONE, (255, 255, 255))
_trip(SAND, (255, 165, 0), (245, 158, 11), (234, 179, 8), (255, 255, 0), (255, 235, 59), (255, 234, 0), (255, 215, 0))
_trip(COPPER, (249, 115, 22))
_trip("#4B5468", (41, 108, 255))      # volume-profile / footprint cell base: cool gray
_trip(STEEL, (0, 229, 255), (0, 255, 255), (59, 130, 246), (41, 98, 255), (41, 138, 255),
      (50, 80, 255), (100, 120, 255), (100, 140, 255), (0, 0, 255))
_trip(PLUM, (255, 0, 255), (168, 85, 247), (167, 139, 250), (138, 43, 226))
_trip(ROSE, (236, 72, 153), (255, 51, 102))
_trip("#7FB2FF", (52, 211, 153))     # light up-blue
_trip("#F59AAB", (252, 165, 165))    # light crimson
_trip(MUTED, (156, 163, 175), (100, 116, 139))
_trip(BG, (6, 10, 18), (7, 11, 20), (10, 15, 28), (10, 15, 25), (8, 12, 20), (2, 6, 23), (15, 23, 42))
_trip(LINE, (30, 41, 59), (55, 65, 81))

SP = r"(?: |\\x20)"   # a space as it appears in the obfuscated source

EMOJI = r"[\U0001F000-\U0001FAFF☀-⛿✀-✔✖-➿⬀-⯿⏩-⏺⌚⌛]️?"

# Specific glyph swaps before the generic emoji strip
GLYPHS = [
    ("👑", "◆"),
    ("⬆️", "↑"), ("⬇️", "↓"), ("⬆", "↑"), ("⬇", "↓"),
    ("⏸", "❚❚"),
    ("🔹", "•"),
]

# Copy edits inside the engine (plain text; spaces may be \x20 in source)
COPY = [
    (" — FA Engine", " · Fundamentals"),
    ("-- AGGREGATION --", "Aggregation"),
]


def loose(text):
    """Regex for `text` where each space may be written as \\x20."""
    return SP.join(re.escape(part) for part in text.split(" "))


def retheme_js(js, stats):
    def hex_sub(m):
        new = HEX.get(m.group(0).upper())
        if new:
            stats["hex " + m.group(0).upper()] += 1
            return new
        return m.group(0)
    js = re.sub(r"#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_])", hex_sub, js)

    trip_re = re.compile(
        r"(?<=[('])(" + SP + r"*)(\d{1,3})(\s*," + SP + r"*)(\d{1,3})(\s*," + SP + r"*)(\d{1,3})(?=" + SP + r"*[,)'])")
    def trip_sub(m):
        key = (int(m.group(2)), int(m.group(4)), int(m.group(6)))
        new = RGB.get(key)
        if not new:
            return m.group(0)
        stats["rgb %d,%d,%d" % key] += 1
        return "%s%d%s%d%s%d" % (m.group(1), new[0], m.group(3), new[1], m.group(5), new[2])
    js = trip_re.sub(trip_sub, js)

    n0 = len(re.findall(r"(?<![A-Za-z])Inter(?![A-Za-z])", js))
    js = re.sub(r"(?<![A-Za-z])Inter(?![A-Za-z])", "IBM Plex Sans", js)
    js = re.sub(r"Roboto" + SP + r"Mono", "JetBrains Mono", js)
    js = js.replace("'Outfit'", "'IBM Plex Sans'").replace("Outfit,", "IBM Plex Sans,")
    stats["font Inter"] += n0

    for a, b in GLYPHS:
        stats["glyph " + a] += js.count(a)
        js = js.replace(a, b)

    for a, b in COPY:
        js, n = re.subn(loose(a), b, js)
        stats["copy " + a.strip()] += n

    # Emoji + its separating space, whichever side the space is on
    before = len(re.findall(EMOJI, js))
    js = re.sub(EMOJI + SP, "", js)
    js = re.sub(SP + EMOJI, "", js)
    js = re.sub(EMOJI, "", js)
    stats["emoji removed"] += before
    return js


def main():
    lines = SRC.read_text(encoding="utf-8").split("\n")
    # Sanity-check the anchors this build relies on
    expect = {
        5: "<script>(function(){var _0x26d869",
        477: "</head>",
        478: "<body>",
        848: "<script>window['addEventListener']('error'",
        1025: "<script>function closeFundamental()",
        1028: "</body>",
    }
    for n, start in expect.items():
        if not lines[n - 1].strip().startswith(start):
            sys.exit("Unexpected source layout at line %d: %r" % (n, lines[n - 1][:80]))

    stats = collections.Counter()

    # Start on the 5-minute chart (the engine doesn't persist timeframe,
    # so this default is what every fresh load uses).
    default_tf = "'tf':'1m','tfMs':0xea60"
    if lines[847].count(default_tf) != 1:
        sys.exit("Could not find the engine's default timeframe")
    lines[847] = lines[847].replace(default_tf, "'tf':'5m','tfMs':0x493e0")
    stats["default tf -> 5m"] += 1

    # Fundamentals: CoinGecko's free API no longer returns developer_data /
    # community_data, and the panel crashed reading fields off undefined.
    fa_fix = "_0x251b52=_0x30136c['developer_data'],_0xe41395=_0x30136c['community_data']"
    if lines[1024].count(fa_fix) != 1:
        sys.exit("Could not find the fundamentals data accessors")
    lines[1024] = lines[1024].replace(
        fa_fix, "_0x251b52=_0x30136c['developer_data']||{},_0xe41395=_0x30136c['community_data']||{}")
    stats["fundamentals null-guard"] += 1

    main_js = retheme_js(lines[847], stats)
    tail_js = retheme_js(lines[1024], stats)

    # doctype .. viewport meta (keeps domain lock + time sync). The charset
    # meta must sit in the first 1024 bytes, so lift it above the lock script.
    head_lines = [l for l in lines[:11] if 'meta charset' not in l]
    head_lines.insert(head_lines.index("<head>") + 1, '    <meta charset="UTF-8">')
    head = "\n".join(head_lines)
    styles = (THEME / "styles.css").read_text(encoding="utf-8")
    body = (THEME / "body.html").read_text(encoding="utf-8")
    fund = (THEME / "fund.html").read_text(encoding="utf-8")
    ui = (THEME / "ui.js").read_text(encoding="utf-8")
    body = body.replace("{{APP_NAME}}", APP_NAME)
    ui = ui.replace("{{APP_NAME}}", APP_NAME)

    html = "\n".join([
        head,
        "    <title>%s</title>" % APP_NAME,
        '    <meta name="theme-color" content="#07080B">',
        '    <link rel="icon" href="favicon.svg" type="image/svg+xml">',
        '    <link rel="preconnect" href="https://fonts.googleapis.com">',
        '    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
        '    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">',
        "    <style>",
        styles.rstrip(),
        "    </style>",
        "</head>",
        body.rstrip(),
        main_js,
        fund.rstrip(),
        tail_js,
        "    <script>",
        ui.rstrip(),
        "    </script>",
        "</body>",
        "</html>",
        "",
    ])

    OUT_LOCAL.write_text(html, encoding="utf-8")
    OUT_DIR.mkdir(exist_ok=True)
    (OUT_DIR / "index.html").write_text(html, encoding="utf-8")
    shutil.copyfile(THEME / "favicon.svg", OUT_DIR / "favicon.svg")
    shutil.copyfile(THEME / "favicon.svg", ROOT / "favicon.svg")

    for k in sorted(stats):
        print("%-28s %d" % (k, stats[k]))
    print("wrote", OUT_LOCAL, "and", OUT_DIR / "index.html", "(%d bytes)" % len(html.encode("utf-8")))


if __name__ == "__main__":
    main()
