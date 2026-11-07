import { nativeSafeUrl } from './platform.util';

describe('nativeSafeUrl', () => {
  it('encodes the space in chapter file names', () => {
    expect(nativeSafeUrl('https://cdn/audios/pt/ARA/GN/GN 1.mp3')).toBe('https://cdn/audios/pt/ARA/GN/GN%201.mp3');
  });

  it('leaves already-encoded URLs alone', () => {
    expect(nativeSafeUrl('https://cdn/a/GN%201.mp3')).toBe('https://cdn/a/GN%201.mp3');
  });
});
