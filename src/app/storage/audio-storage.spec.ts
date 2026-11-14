import { audioExt, fileNameToId, idToFileName } from './audio-storage';

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

describe('audio file extensions', () => {
  it('keeps the extension of the format downloaded, mp3 by default', () => {
    expect(idToFileName('otb-ariel-Gn-1', 'm4a')).toBe('otb-ariel-Gn-1.m4a');
    expect(fileNameToId('otb-ariel-Gn-1.m4a')).toBe('otb-ariel-Gn-1');
    expect(fileNameToId('ara-gn-1.mp3')).toBe('ara-gn-1');
  });

  it('reads old name-only keys back, dots and all', () => {
    expect(fileNameToId(idToFileName('Gênesis 1.mp3'))).toBe('Gênesis 1.mp3');
  });

  it('ignores files that are not chapters', () => {
    expect(fileNameToId('otb-Gn-1.mp3.dl')).toBeNull();
    expect(fileNameToId('otb-Gn-1.m4a.part')).toBeNull();
    expect(fileNameToId('notes')).toBeNull();
  });

  it('takes the extension from the URL', () => {
    expect(audioExt('https://cdn/audios/pt/OTB/GEN/GEN 1.m4a')).toBe('m4a');
    expect(audioExt('https://cdn/audios/pt/ARA/GEN/GEN 1.mp3?ngsw-bypass=1')).toBe('mp3');
    expect(audioExt('https://cdn/x')).toBe('mp3');
  });
});

