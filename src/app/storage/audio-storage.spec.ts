import { Directory } from '@capacitor/filesystem';

import {
  FilesystemAudioStorage, IndexedDbAudioStorage, fileNameToId, idToFileName,
} from './audio-storage';
import { dbPromise } from './my-db';
import { FakeDevice, runOnPlatform } from '../../testing/fake-capacitor';

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

describe('IndexedDbAudioStorage (web/PWA)', () => {
  let storage: IndexedDbAudioStorage;

  beforeEach(async () => {
    await (await dbPromise).clear('files');
    storage = new IndexedDbAudioStorage();
  });
  afterEach(() => vi.restoreAllMocks());

  function serve(status = 200, bytes = 5) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(new Uint8Array(bytes), { status }));
  }

  it('has nothing before a download', async () => {
    expect(await storage.has('ara-gn-1')).toBe(false);
    expect(await storage.playableUrl('ara-gn-1')).toBeNull();
    expect(await storage.list()).toEqual([]);
  });

  it('downloads, then lists and serves the chapter from IndexedDB', async () => {
    const fetchSpy = serve(200, 7);
    const createObjectURL = vi.fn(() => 'blob:local-1');
    Object.assign(URL, { createObjectURL });
    await storage.download('ara-gn-1', 'https://cdn/GN/GN 1.mp3');

    // Bypasses the service worker (query param) and never reuses an HTTP cache entry.
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('ngsw-bypass');
    expect(init.cache).toBe('no-store');

    expect(await storage.has('ara-gn-1')).toBe(true);
    expect(await storage.playableUrl('ara-gn-1')).toBe('blob:local-1');
    // Byte size isn't asserted here: under jsdom, Node's Response.blob() and
    // jsdom's Blob don't interoperate, and fake-indexeddb can't clone a jsdom
    // Blob. The e2e suite (real Chromium) checks that real audio is stored.
    expect((await storage.list()).map(f => f.id)).toEqual(['ara-gn-1']);
  });

  it('stores nothing when the server answers with an error', async () => {
    serve(404);
    await expect(storage.download('ara-gn-1', 'https://cdn/x.mp3')).rejects.toThrow(/404/);
    expect(await storage.has('ara-gn-1')).toBe(false);
  });

  it('stores nothing when the transfer is aborted', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_u, init) => new Promise((_, reject) => {
      (init as RequestInit).signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const ctrl = new AbortController();
    const pending = storage.download('ara-gn-1', 'https://cdn/x.mp3', ctrl.signal);
    ctrl.abort();
    await expect(pending).rejects.toThrow();
    expect(await storage.has('ara-gn-1')).toBe(false);
  });

  it('removes one chapter or clears them all', async () => {
    serve();
    await storage.download('a', 'https://cdn/a.mp3');
    await storage.download('b', 'https://cdn/b.mp3');
    await storage.remove('a');
    expect((await storage.list()).map(f => f.id)).toEqual(['b']);
    await storage.clear();
    expect(await storage.list()).toEqual([]);
  });
});

describe('FilesystemAudioStorage (native)', () => {
  let device: FakeDevice;

  beforeEach(() => {
    device = new FakeDevice().install();
    runOnPlatform('android');
  });
  afterEach(() => vi.restoreAllMocks());

  it('has nothing when the audios folder does not exist yet', async () => {
    const storage = new FilesystemAudioStorage();
    expect(await storage.has('ara-gn-1')).toBe(false);
    expect(await storage.playableUrl('ara-gn-1')).toBeNull();
    expect(await storage.list()).toEqual([]);
  });

  it('downloads through native HTTP into the app files dir and plays from a file:// URI', async () => {
    const storage = new FilesystemAudioStorage();
    await storage.download('ara-gn-1', 'https://cdn/GN/GN 1.mp3');
    expect(device.downloads).toEqual(['https://cdn/GN/GN%201.mp3']);
    expect(device.ls(Directory.Data)).toEqual(['ara-gn-1.mp3']);
    expect(await storage.has('ara-gn-1')).toBe(true);
    expect(await storage.playableUrl('ara-gn-1')).toBe(`file:///${Directory.Data}/audios/ara-gn-1.mp3`);
    expect(await storage.list()).toEqual([expect.objectContaining({ id: 'ara-gn-1', size: 1000 })]);
  });

  it('keeps chapters out of iCloud backup on iOS (Library/NoCloud)', async () => {
    runOnPlatform('ios');
    const storage = new FilesystemAudioStorage();
    await storage.download('ara-gn-1', 'https://cdn/a.mp3');
    expect(device.ls(Directory.LibraryNoCloud)).toEqual(['ara-gn-1.mp3']);
    expect(device.ls(Directory.Data)).toEqual([]);
  });

  it('finds chapters downloaded in an earlier session', async () => {
    device.put(Directory.Data, 'audios/ara-gn-1.mp3', 1234, 111);
    device.put(Directory.Data, `audios/${idToFileName('cnvs-创-1')}`, 10, 222);
    const storage = new FilesystemAudioStorage();
    expect(await storage.has('ara-gn-1')).toBe(true);
    expect(await storage.has('cnvs-创-1')).toBe(true);
    expect((await storage.list()).find(f => f.id === 'ara-gn-1')).toEqual({ id: 'ara-gn-1', size: 1234, downloadedAt: 111 });
  });

  it('never treats a partial download as a chapter, and cleans it up', async () => {
    device.put(Directory.Data, 'audios/ara-gn-1.mp3.part', 300);
    device.put(Directory.Data, 'audios/ara-gn-2.mp3', 1000);
    const storage = new FilesystemAudioStorage();
    expect(await storage.has('ara-gn-1')).toBe(false);
    expect((await storage.list()).map(f => f.id)).toEqual(['ara-gn-2']);
    await vi.waitFor(() => expect(device.ls(Directory.Data)).toEqual(['ara-gn-2.mp3']));
  });

  it('leaves no file behind when the transfer fails midway', async () => {
    device.onDownload = async (_url, write) => {
      write(300); // some bytes landed…
      throw new Error('connection reset');
    };
    const storage = new FilesystemAudioStorage();
    await expect(storage.download('ara-gn-1', 'https://cdn/a.mp3')).rejects.toThrow('connection reset');
    expect(await storage.has('ara-gn-1')).toBe(false);
    expect(device.ls(Directory.Data)).toEqual([]);
  });

  it('can retry a chapter after a failed attempt', async () => {
    let attempt = 0;
    device.onDownload = async (_url, write) => {
      write(attempt === 0 ? 100 : 1000);
      if (attempt++ === 0) throw new Error('timeout');
    };
    const storage = new FilesystemAudioStorage();
    await expect(storage.download('ara-gn-1', 'https://cdn/a.mp3')).rejects.toThrow();
    await storage.download('ara-gn-1', 'https://cdn/a.mp3');
    expect(await storage.list()).toEqual([expect.objectContaining({ id: 'ara-gn-1', size: 1000 })]);
  });

  it('removes one chapter or clears them all', async () => {
    const storage = new FilesystemAudioStorage();
    await storage.download('a', 'https://cdn/a.mp3');
    await storage.download('b', 'https://cdn/b.mp3');
    await storage.remove('a');
    expect(await storage.has('a')).toBe(false);
    expect(device.ls(Directory.Data)).toEqual(['b.mp3']);
    await storage.clear();
    expect(await storage.list()).toEqual([]);
    expect(device.ls(Directory.Data)).toEqual([]);
  });
});
