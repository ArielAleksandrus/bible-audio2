/**
 * Angular's service worker intercepts every fetch, including <audio> Range
 * requests and the next-chapter download. A suspended SW (locked screen)
 * makes those hang, which is why auto-advance works offline (blob: URLs
 * never touch the SW) and fails online. Bypass so audio hits the network
 * directly; IndexedDB blobs remain the playback source of truth.
 */
export function bypassServiceWorker(url: string): string {
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return url;
  try {
    const parsed = new URL(url, typeof location !== 'undefined' ? location.href : 'https://local.invalid');
    if (!parsed.searchParams.has('ngsw-bypass')) {
      parsed.searchParams.set('ngsw-bypass', '1');
    }
    return parsed.toString();
  } catch {
    if (/[?&]ngsw-bypass(?:[=&]|$)/i.test(url)) return url;
    return `${url}${url.includes('?') ? '&' : '?'}ngsw-bypass=1`;
  }
}
