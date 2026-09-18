// iPadOS 13+ identifies as "Macintosh" in the UA string, so touch support is
// the only way left to tell it apart from a real Mac.
export function isIosDevice(): boolean {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

// Instagram's webview appends "Instagram <version>" to the UA string on both
// iOS and Android. It's a plain embedded WKWebView/Custom Tab with no
// beforeinstallprompt support and no "Add to Home Screen" entry in its menu,
// so a PWA install (and anything that depends on it — background audio,
// push notifications) is unreachable until the user backs out to a real
// browser.
export function isInstagramInAppBrowser(): boolean {
  return /\bInstagram\b/.test(navigator.userAgent);
}

const SUPPORTED_UI_LANGS = ['pt', 'en', 'es', 'zh', 'ja'];

// Used for UI that has to speak to the user before they've picked a Bible
// translation (and therefore before the app's own language is known).
// Regional variants collapse to their base code (pt-BR -> pt, zh-Hans -> zh),
// same as the i18n loader does; anything unsupported falls back to English
// rather than the app's usual Portuguese default, since English is the
// safer bet for an unrecognized audience.
export function detectOverlayLanguage(): string {
  const browserLang = (navigator.language || 'en').toLowerCase();
  const base = browserLang.split('-')[0];
  return SUPPORTED_UI_LANGS.includes(base) ? base : 'en';
}
