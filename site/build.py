#!/usr/bin/env python3
"""Builds the landing site (biblia.nlabs.live / bible.nlabs.live) into site/dist.

One static page per language in strings.json (/pt/, /en/, ...), plus a root
page that sends the visitor to the language of their browser (or system, in an
in-app browser), falling back to English. A language chosen by hand is kept in
localStorage and wins on the next visit; ?lang=xx in the root URL wins over both.

    python3 site/build.py            # build
    python3 site/build.py --deploy   # build and rsync to nlabs.live
"""
import html
import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP = HERE.parent
DIST = HERE / "dist"
STRINGS = json.loads((HERE / "strings.json").read_text(encoding="utf-8"))
LANGS = list(STRINGS)  # order = order in the language menu
DEFAULT_LANG = "en"

PLAY_URL = "https://play.google.com/store/apps/details?id=live.nlabs.biblia"
IOS_URL = "https://apps.apple.com/app/id6832831597"
WEB_URL = "https://biblia-narrada.vercel.app/"
PRIVACY_URL = "https://biblia-narrada.vercel.app/privacy.html"
GITHUB_URL = "https://github.com/ArielAleksandrus/bible-audio2"
OTB_SITE = "https://openbible.uk"
OTB_GITHUB = "https://github.com/OpenTranslationBible/open-bible"
CC_URL = "https://creativecommons.org/licenses/by-sa/4.0/"
CDN = "https://pub-7db5ca77d7e14ca79a36013b9fc40870.r2.dev"
SAMPLES = [  # (narrator, url) — Psalm 23 in Portuguese
    ("Ariel", f"{CDN}/audios/pt/OTB/PSA/PSA%2023.mp3"),
    ("Lucas", f"{CDN}/audios/pt/OTB/lucas/PSA/PSA%2023.mp3"),
]

# Portuguese pages live on biblia.nlabs.live, the rest on bible.nlabs.live
def canonical(lang: str) -> str:
    host = "biblia.nlabs.live" if lang == "pt" else "bible.nlabs.live"
    return f"https://{host}/{lang}/"

DEPLOY_TARGET = "nlabs@nlabs.live:/home/nlabs/sites/biblia-narrada/"

ICON_WEB = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-9 9h18M12 3c2.5 2.5 3.6 5.6 3.6 9s-1.1 6.5-3.6 9c-2.5-2.5-3.6-5.6-3.6-9S9.5 5.5 12 3Z"/></svg>'
ICON_GITHUB = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1.5a10.5 10.5 0 0 0-3.3 20.5c.5.1.7-.2.7-.5v-1.8c-2.9.6-3.5-1.4-3.5-1.4-.5-1.2-1.2-1.5-1.2-1.5-1-.7 0-.6 0-.6 1 .1 1.6 1.1 1.6 1.1.9 1.6 2.5 1.2 3.1.9.1-.7.4-1.2.7-1.4-2.3-.3-4.8-1.2-4.8-5.2 0-1.1.4-2.1 1.1-2.8-.1-.3-.5-1.4.1-2.8 0 0 .9-.3 2.9 1.1a10 10 0 0 1 5.3 0c2-1.4 2.9-1.1 2.9-1.1.6 1.4.2 2.5.1 2.8.7.7 1.1 1.7 1.1 2.8 0 4-2.5 4.9-4.8 5.2.4.3.7 1 .7 2v2.9c0 .3.2.6.7.5A10.5 10.5 0 0 0 12 1.5Z"/></svg>'
ICON_LINK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>'
FEATURE_ICONS = [  # offline, lock, car, plans, text, account
    '<path d="M12 3v11m0 0-4-4m4 4 4-4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"/>',
    '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    '<path d="M5 17h14M6 17l1.5-5.5A2 2 0 0 1 9.4 10h5.2a2 2 0 0 1 1.9 1.5L18 17v3h-2v-1.5M6 17v3h2v-1.5"/><circle cx="8.5" cy="14.5" r=".6"/><circle cx="15.5" cy="14.5" r=".6"/>',
    '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M4 10h16M9 15l2 2 4-4"/>',
    '<path d="M4 5.5C6.5 4 9.5 4 12 6c2.5-2 5.5-2 8-.5V19c-2.5-1.5-5.5-1.5-8 .5-2.5-2-5.5-2-8-.5Z"/><path d="M12 6v13.5"/>',
    '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/><path d="M3 3l18 18"/>',
]


def og_image(lang: str) -> str:
    """Share preview: the App Store launch banner (Portuguese art) on /pt/, the icon elsewhere."""
    if lang == "pt":
        url = canonical(lang).replace(f"/{lang}/", "/assets/og-pt.jpg")
        return (f'  <meta property="og:image" content="{url}">\n'
                '  <meta property="og:image:width" content="1280">\n'
                '  <meta property="og:image:height" content="720">\n'
                '  <meta name="twitter:card" content="summary_large_image">')
    return f'  <meta property="og:image" content="{canonical(lang).replace(f'/{lang}/', '/assets/icon-512.png')}">'


def e(s: str) -> str:
    return html.escape(s, quote=True)


def page(lang: str) -> str:
    t = STRINGS[lang]
    alternates = "\n".join(
        f'  <link rel="alternate" hreflang="{STRINGS[l]["html_lang"]}" href="{canonical(l)}">' for l in LANGS
    ) + f'\n  <link rel="alternate" hreflang="x-default" href="https://bible.nlabs.live/">'
    lang_menu = "\n".join(
        f'        <a href="../{l}/" lang="{STRINGS[l]["html_lang"]}" data-lang="{l}"'
        + (' aria-current="page"' if l == lang else "")
        + f'>{e(STRINGS[l]["language_name"])}</a>'
        for l in LANGS
    )
    features = "\n".join(
        f"""      <li class="feature">
        <svg viewBox="0 0 24 24" aria-hidden="true">{FEATURE_ICONS[i]}</svg>
        <h3>{e(title)}</h3>
        <p>{e(text)}</p>
      </li>"""
        for i, (title, text) in enumerate(t["features"])
    )
    samples = "\n".join(
        f"""        <figure class="sample">
          <figcaption>{e(name)}</figcaption>
          <audio controls preload="none" src="{url}"></audio>
        </figure>"""
        for name, url in SAMPLES
    )
    note = f' <span class="note">{e(t["sample_note"])}</span>' if t["sample_note"] else ""

    return f"""<!doctype html>
<html lang="{t['html_lang']}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{e(t['title'])}</title>
  <meta name="description" content="{e(t['meta_description'])}">
  <link rel="canonical" href="{canonical(lang)}">
{alternates}
  <meta property="og:type" content="website">
  <meta property="og:title" content="{e(t['title'])}">
  <meta property="og:description" content="{e(t['meta_description'])}">
  <meta property="og:url" content="{canonical(lang)}">
{og_image(lang)}
  <meta name="theme-color" content="#0f3d3e">
  <link rel="icon" href="../assets/icon-192.png">
  <link rel="apple-touch-icon" href="../assets/icon-192.png">
  <link rel="stylesheet" href="../assets/style.css">
</head>
<body class="lang-{lang}">
  <header class="top">
    <div class="wrap top-row">
      <a class="brand" href="./"><img src="../assets/icon-192.png" alt="" width="32" height="32"><span>{e(t['app_name'])}</span></a>
      <details class="langs">
        <summary aria-label="{e(t['choose_language'])}">{ICON_WEB}<span>{e(t['language_name'])}</span></summary>
        <nav>
{lang_menu}
        </nav>
      </details>
    </div>
  </header>

  <main>
    <section class="hero">
      <div class="wrap hero-grid">
        <div class="hero-text">
          <h1>{e(t['app_name'])}</h1>
          <p class="tagline">{e(t['tagline'])}</p>
          <div class="stores">
            <a class="store" href="{PLAY_URL}" rel="noopener"><img src="../assets/badges/google-play-{lang}.png" alt="{e(t['get_it_on'])} Google Play" height="54"></a>
            <a class="store" href="{IOS_URL}" rel="noopener"><img src="../assets/badges/app-store-{lang}.svg" alt="{e(t['download_on'])} App Store" height="54"></a>
          </div>
          <a class="web-link" href="{WEB_URL}" rel="noopener">{ICON_WEB}{e(t['use_web'])}</a>
        </div>
        <img class="hero-icon" src="../assets/icon-512.png" alt="" width="512" height="512">
      </div>
    </section>

    <section class="wrap narration">
      <p class="now">{e(t['narration_now'])}</p>
      <p class="soon">{e(t['narration_soon'])}</p>
      <div class="samples">
        <h2>{e(t['sample_title'])}{note}</h2>
        <div class="sample-row">
{samples}
        </div>
      </div>
    </section>

    <section class="wrap">
      <h2 class="section-title">{e(t['features_title'])}</h2>
      <ul class="features">
{features}
      </ul>
    </section>

    <section class="open">
      <div class="wrap open-grid">
        <article>
          <p class="kicker">{e(t['otb_kicker'])}</p>
          <h2>{e(t['otb_title'])}</h2>
          <p>{e(t['otb_text'])}</p>
          <p class="links">
            <a href="{OTB_SITE}" rel="noopener">{ICON_LINK}{e(t['otb_site'])}</a>
            <a href="{OTB_GITHUB}" rel="noopener">{ICON_GITHUB}{e(t['otb_github'])}</a>
            <a href="{CC_URL}" rel="noopener license">{ICON_LINK}CC BY-SA 4.0</a>
          </p>
        </article>
        <article>
          <p class="kicker">{e(t['oss_kicker'])}</p>
          <h2>{e(t['oss_title'])}</h2>
          <p>{e(t['oss_text'])}</p>
          <p class="links">
            <a href="{GITHUB_URL}" rel="noopener">{ICON_GITHUB}{e(t['oss_github'])}</a>
          </p>
        </article>
      </div>
    </section>

    <section class="wrap cta">
      <h2>{e(t['cta_title'])}</h2>
      <p>{e(t['cta_text'])}</p>
    </section>
  </main>

  <footer class="foot">
    <div class="wrap">
      <p>{e(t['credit'])}</p>
      <p class="foot-links">
        <a href="{PRIVACY_URL}">{e(t['privacy'])}</a>
        <a href="{GITHUB_URL}">GitHub</a>
        <span>© nlabs</span>
      </p>
    </div>
  </footer>
  <script>
    // Remember a language picked by hand, so the root page opens it next time.
    document.querySelectorAll('.langs a').forEach(function (a) {{
      a.addEventListener('click', function () {{
        try {{ localStorage.setItem('siteLang', a.dataset.lang); }} catch (_) {{}}
      }});
    }});
  </script>
</body>
</html>
"""


def root_page() -> str:
    links = " · ".join(f'<a href="{l}/">{e(STRINGS[l]["language_name"])}</a>' for l in LANGS)
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Narrated Bible · Bíblia Narrada</title>
  <link rel="icon" href="assets/icon-192.png">
  <script>
    (function () {{
      var langs = {json.dumps(LANGS)};
      function pick() {{
        var q = new URLSearchParams(location.search).get('lang');
        if (q && langs.indexOf(q) >= 0) return q;
        try {{
          var saved = localStorage.getItem('siteLang');
          if (saved && langs.indexOf(saved) >= 0) return saved;
        }} catch (_) {{}}
        var prefs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
        for (var i = 0; i < prefs.length; i++) {{
          var code = String(prefs[i]).toLowerCase().split('-')[0];
          if (langs.indexOf(code) >= 0) return code;
        }}
        return '{DEFAULT_LANG}';
      }}
      location.replace(pick() + '/' + location.hash);
    }})();
  </script>
</head>
<body style="font-family: system-ui, sans-serif; text-align: center; padding: 3rem 1rem;">
  <p>{links}</p>
</body>
</html>
"""


def build() -> None:
    if DIST.exists():
        shutil.rmtree(DIST)
    (DIST / "assets").mkdir(parents=True)
    shutil.copy(HERE / "style.css", DIST / "assets" / "style.css")
    shutil.copy(HERE / "img/icon-512.png", DIST / "assets/icon-512.png")
    shutil.copy(HERE / "img/icon-192.png", DIST / "assets/icon-192.png")
    shutil.copy(HERE / "img/og-pt.jpg", DIST / "assets/og-pt.jpg")
    # Official store badges, one per language (Apple: toolbox.marketingtools.apple.com; Google: play.google.com/intl/en_us/badges)
    shutil.copytree(HERE / "img/badges", DIST / "assets/badges")
    for lang in LANGS:
        (DIST / lang).mkdir()
        (DIST / lang / "index.html").write_text(page(lang), encoding="utf-8")
    (DIST / "index.html").write_text(root_page(), encoding="utf-8")
    (DIST / "robots.txt").write_text("User-agent: *\nAllow: /\n", encoding="utf-8")
    print(f"built {len(LANGS)} languages into {DIST}")


if __name__ == "__main__":
    build()
    if "--deploy" in sys.argv:
        subprocess.run(["rsync", "-az", "--delete", f"{DIST}/", DEPLOY_TARGET], check=True)
        print(f"deployed to {DEPLOY_TARGET}")
