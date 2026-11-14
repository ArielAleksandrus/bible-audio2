import { loadFormatSupport, probeFormats } from './audio-format-probe';
import { audioFormatFor, BibleCatalogEntry, setFormatSupport } from '../data/bible-catalog';

describe('audio format probe', () => {
  const otb: BibleCatalogEntry = { lang: 'pt', version: 'otb', flag: '', label: 'OTB', formats: ['opus', 'mp3'] };

  beforeEach(() => { localStorage.clear(); setFormatSupport('opus', undefined); });
  afterEach(() => { localStorage.clear(); setFormatSupport('opus', undefined); });

  it('uses mp3 until a probe has shown that Opus plays', () => {
    loadFormatSupport();
    expect(audioFormatFor(otb)).toBe('mp3');
  });

  it('trusts the probe, and keeps its answer for the next start', async () => {
    const play = vi.fn().mockResolvedValue(true);
    await probeFormats(play);
    expect(play).toHaveBeenCalledWith(expect.any(Blob));
    expect(audioFormatFor(otb)).toBe('opus');

    setFormatSupport('opus', undefined);
    loadFormatSupport();
    expect(audioFormatFor(otb)).toBe('opus');
  });

  it('keeps the earlier answer when the probe gets none in time', async () => {
    await probeFormats(async () => true);
    await probeFormats(async () => undefined);
    setFormatSupport('opus', undefined);
    loadFormatSupport();
    expect(audioFormatFor(otb)).toBe('opus');
  });

  it('turns Opus off when it stops playing', async () => {
    await probeFormats(async () => true);
    await probeFormats(async () => false);
    expect(audioFormatFor(otb)).toBe('mp3');
  });
});
