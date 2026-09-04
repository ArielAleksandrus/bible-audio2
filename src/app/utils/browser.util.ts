// iPadOS 13+ identifies as "Macintosh" in the UA string, so touch support is
// the only way left to tell it apart from a real Mac.
export function isIosDevice(): boolean {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}
