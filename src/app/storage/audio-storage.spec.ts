import { fileNameToId, idToFileName } from './audio-storage';

describe('audio file names', () => {
  it('keeps plain ids readable', () => {
    expect(idToFileName('ara-gn-1')).toBe('ara-gn-1.mp3');
  });

  it('round-trips non-ASCII and underscore ids into ASCII-only names', () => {
    for (const id of ['cnvs-创-1', 'jcb-創世-50', 'x_y-1', 'ara-1co-13']) {
      const name = idToFileName(id);
      expect(name).toMatch(/^[A-Za-z0-9_-]+\.mp3$/);
      expect(fileNameToId(name)).toBe(id);
    }
  });
});
