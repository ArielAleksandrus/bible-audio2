const platform = vi.hoisted(() => ({ name: 'web' as 'web' | 'android' | 'ios' }));

vi.mock('@capacitor/core', async importOriginal => {
  const real = await importOriginal<typeof import('@capacitor/core')>();
  return {
    ...real,
    Capacitor: {
      ...real.Capacitor,
      isNativePlatform: () => platform.name !== 'web',
      getPlatform: () => platform.name,
    },
  };
});

import { isNativeApp, nativePlatform, nativeSafeUrl } from './platform.util';

describe('platform.util', () => {
  afterEach(() => (platform.name = 'web'));

  it('treats the browser/PWA as web, not native', () => {
    platform.name = 'web';
    expect(isNativeApp()).toBe(false);
    expect(nativePlatform()).toBe('web');
  });

  it.each(['android', 'ios'] as const)('reports %s as a native app', name => {
    platform.name = name;
    expect(isNativeApp()).toBe(true);
    expect(nativePlatform()).toBe(name);
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
