import { silentWavBlob } from './silent-wav.util';

describe('silentWavBlob', () => {
  it('returns a wav blob whose size matches 1s of 8kHz 16-bit mono plus header', () => {
    const blob = silentWavBlob(1, 8000);
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44 + 8000 * 2);
  });
});
