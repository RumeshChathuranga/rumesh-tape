"""Static checks on the built page.

Rebuilds the site with theme/build.py, then inspects public-site/index.html.

Run:  python3 -m unittest discover -s tests -v
"""
import pathlib
import re
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
BUILT = ROOT / "public-site" / "index.html"

# Studies taken out of the drawer (their hidden engine buttons must remain).
REMOVED = {
    "showSNR": "snr-btn", "showSMC": "smc-btn", "showAutoFVG": "autofvg-btn",
    "showWyckoff": "wyc-btn", "showEW": "ew-btn", "showSK": "sk-btn",
    "showCRT": "crt-btn", "showPivots": "pivot-btn", "showMMS": "mms-btn",
    "showNews": "news-btn",
}
# Studies moved to the collapsed "Extra" section.
PARKED = ["showPaceTape", "showVPT", "showWDE", "showTFHeatmap"]


def drawer(html):
    start = html.index('<div id="tab-ind">')
    return html[start:html.index('<div id="tab-tf"', start)]


class BuiltPage(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        subprocess.run([sys.executable, str(ROOT / "theme" / "build.py")],
                       check=True, capture_output=True)
        cls.html = BUILT.read_text(encoding="utf-8")

    # ---------------------------------------------------------- engine patches
    def test_error_handler_does_not_rewrite_body(self):
        self.assertNotIn("document['body']['innerHTML']+=", self.html)
        self.assertIn("rt-error", self.html)

    def test_news_fields_are_escaped(self):
        self.assertIn("'+__rtEsc(_0x17ae7a)+'", self.html)
        self.assertIn("'+__rtEsc(_0x289d88)+'", self.html)

    def test_symbol_switch_closes_other_sockets(self):
        self.assertRegex(self.html, r"toUpperCase'\]\(\);__rtDropOtherSymbols\(_0x27b057\);")
        self.assertIn("async function connectLive(_0x30a3a0){if(_0x30a3a0!==SETTINGS['symbol'])return;",
                      self.html)

    def test_30m_in_every_timeframe_map(self):
        self.assertEqual(self.html.count("'15m':0xdbba0,'30m':0x1b7740,"), 3)
        self.assertIn("'15m':'15m','30m':'30m',", self.html)
        self.assertIn("['1m','5m','15m','30m','1h','2h','4h','1d']", self.html)
        self.assertIn("'15m':0x8,'30m':0xb,", self.html)

    def test_saved_timeframe_is_the_engine_default(self):
        self.assertIn("'tf':__rtTF['tf'],'tfMs':__rtTF['ms']", self.html)

    # ------------------------------------------------------------- top bar
    def test_30m_buttons(self):
        self.assertIn('<button data-tf="30m">30m</button>', self.html)
        self.assertIn('<option value="30m">30m</option>', self.html)
        self.assertIn("setMobileTF('30m',this)", self.html)

    def test_data_badge_present(self):
        self.assertIn('id="data-badge"', self.html)

    # ------------------------------------------------------------- drawer
    def test_removed_studies_gone_from_drawer(self):
        d = drawer(self.html)
        for key in REMOVED:
            self.assertNotIn('data-key="%s"' % key, d, key)

    def test_removed_studies_keep_engine_buttons(self):
        legacy = self.html[self.html.index('<div id="legacy-toggles"'):]
        legacy = legacy[:legacy.index("</div>")]
        for btn in REMOVED.values():
            self.assertIn('id="%s"' % btn, legacy, btn)

    def test_parked_studies_in_extra_section(self):
        d = drawer(self.html)
        extra = d[d.index('<details class="sheet-extra"'):]
        extra = extra[:extra.index("</details>")]
        for key in PARKED:
            self.assertIn('data-key="%s"' % key, extra, key)

    def test_honest_labels(self):
        d = drawer(self.html)
        self.assertIn("Liquidation map (estimated)", d)
        self.assertIn("Peak open interest price", d)
        self.assertIn("Largest per second only", d)
        self.assertIn("Whale size (coins)", d)
        self.assertNotIn("Live resting orders by price", d)
        self.assertNotIn("Estimated liquidation clusters", d)

    # ------------------------------------------------------------- fundamentals
    def test_score_card_hidden(self):
        self.assertRegex(self.html, r'<div id="signalCard"[^>]*style="display:none"')

    def test_sinhala_verdict_removed(self):
        self.assertNotIn("අවසාන\\x20නිගමනය", self.html)
        self.assertNotIn("අවසාන නිගමනය", self.html)
        self.assertIn("f-aiSummary", self.html)

    def test_oi_wall_text_not_called_a_wall(self):
        self.assertNotIn("SELL\\x20WALL", self.html)
        self.assertNotIn("BUY\\x20WALL", self.html)

    # ------------------------------------------------------------- repo hygiene
    def test_docs_ignored(self):
        out = subprocess.run(["git", "check-ignore", "docs/README.md"], cwd=ROOT,
                             capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, "docs/ must be git-ignored")


if __name__ == "__main__":
    unittest.main()
