import { Capacitor } from '@capacitor/core';

import { isNativeApp, nativePlatform, nativeSafeUrl } from './platform.util';

// Spy on the shared Capacitor object instead of vi.mock('@capacitor/core'):
// the Angular unit-test builder bundles specs into shared chunks, so a
// module mock isn't reliably applied once several spec files run together.
function runOn(platform: 'web' | 'android' | 'ios') {
  vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(platform !== 'web');
  vi.spyOn(Capacitor, 'getPlatform').mockReturnValue(platform);
}

describe('platform.util', () => {
  afterEach(() => vi.restoreAllMocks());

  it('treats the browser/PWA as web, not native', () => {
    runOn('web');
    expect(isNativeApp()).toBe(false);
    expect(nativePlatform()).toBe('web');
  });

  it.each(['android', 'ios'] as const)('reports %s as a native app', name => {
    runOn(name);
    expect(isNativeApp()).toBe(true);
    expect(nativePlatform()).toBe(name);
  });

  it('is web when nothing is stubbed (jsdom = browser)', () => {
    expect(isNativeApp()).toBe(false);
  });
});

describe('nativeSafeUrl', () => {
  it('encodes the space in chapter file names', () => {
    expect(nativeSafeUrl('https://cdn/audios/pt/ARA/GN/GN 1.mp3')).toBe('https://cdn/audios/pt/ARA/GN/GN%201.mp3');
  });

  it('leaves already-encoded URLs alone', () => {
    expect(nativeSafeUrl('https://cdn/a/GN%201.mp3')).toBe('https://cdn/a/GN%201.mp3');
  });
});
