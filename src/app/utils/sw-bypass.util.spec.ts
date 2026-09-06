import { bypassServiceWorker } from './sw-bypass.util';

describe('bypassServiceWorker', () => {
  it('appends ngsw-bypass to http(s) URLs', () => {
    expect(bypassServiceWorker('https://cdn.example/a.mp3')).toContain('ngsw-bypass=1');
  });

  it('leaves blob and data URLs untouched', () => {
    expect(bypassServiceWorker('blob:https://app/123')).toBe('blob:https://app/123');
    expect(bypassServiceWorker('data:audio/wav;base64,AAA')).toBe('data:audio/wav;base64,AAA');
  });

  it('does not duplicate the param', () => {
    const once = bypassServiceWorker('https://cdn.example/a.mp3?ngsw-bypass=1');
    expect(once.match(/ngsw-bypass/g)?.length).toBe(1);
  });
});
