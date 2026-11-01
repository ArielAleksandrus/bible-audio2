import { Capacitor } from '@capacitor/core';
import { Directory } from '@capacitor/filesystem';

import { capacitorPlugins } from '../app/utils/capacitor-plugins';

/** Make platform.util report a native platform (or the web) for this test. */
export function runOnPlatform(platform: 'web' | 'android' | 'ios'): void {
  vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(platform !== 'web');
  vi.spyOn(Capacitor, 'getPlatform').mockReturnValue(platform);
}

interface FakeFile { size: number; mtime: number }

/**
 * In-memory stand-in for @capacitor/filesystem + @capacitor/file-transfer,
 * with just the semantics the app relies on: files live per Directory,
 * readdir of a missing folder throws, rename needs an existing source,
 * downloadFile writes to the `file://` URI from getUri.
 */
export class FakeDevice {
  readonly files = new Map<string, FakeFile>();
  /** How a download of `url` behaves. Default: a 1000-byte file. */
  onDownload: (url: string, write: (bytes: number) => void) => Promise<void> =
    async (_url, write) => write(1000);
  readonly downloads: string[] = [];

  private key(directory: string, path: string) { return `${directory}:${path}`; }
  private fromUri(uri: string) {
    const m = /^file:\/\/\/([^/]+)\/(.*)$/.exec(uri);
    if (!m) throw new Error(`bad uri ${uri}`);
    return this.key(m[1], m[2]);
  }

  /** Files currently in `folder` of `directory` (names only). */
  ls(directory: string, folder = 'audios'): string[] {
    const prefix = this.key(directory, `${folder}/`);
    return [...this.files.keys()].filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length)).sort();
  }

  put(directory: string, path: string, size = 1000, mtime = Date.now()) {
    this.files.set(this.key(directory, path), { size, mtime });
  }

  readonly Filesystem = {
    readdir: vi.fn(async ({ path, directory }: { path: string; directory: string }) => {
      const names = this.ls(directory, path);
      if (names.length === 0) throw new Error('Folder does not exist.');
      return {
        files: names.map(name => {
          const f = this.files.get(this.key(directory, `${path}/${name}`))!;
          return { name, type: 'file' as const, size: f.size, mtime: f.mtime, ctime: f.mtime, uri: '' };
        }),
      };
    }),
    mkdir: vi.fn(async () => {}),
    getUri: vi.fn(async ({ path, directory }: { path: string; directory: string }) =>
      ({ uri: `file:///${directory}/${path}` })),
    rename: vi.fn(async ({ from, to, directory }: { from: string; to: string; directory: string }) => {
      const src = this.files.get(this.key(directory, from));
      if (!src) throw new Error('File does not exist.');
      this.files.delete(this.key(directory, from));
      this.files.set(this.key(directory, to), src);
    }),
    stat: vi.fn(async ({ path, directory }: { path: string; directory: string }) => {
      const f = this.files.get(this.key(directory, path));
      if (!f) throw new Error('File does not exist.');
      return { type: 'file', size: f.size, mtime: f.mtime, ctime: f.mtime, uri: `file:///${directory}/${path}` };
    }),
    deleteFile: vi.fn(async ({ path, directory }: { path: string; directory: string }) => {
      if (!this.files.delete(this.key(directory, path))) throw new Error('File does not exist.');
    }),
    rmdir: vi.fn(async ({ path, directory }: { path: string; directory: string }) => {
      for (const name of this.ls(directory, path)) this.files.delete(this.key(directory, `${path}/${name}`));
    }),
    writeFile: vi.fn(async ({ path, directory, data }: { path: string; directory: string; data: string }) => {
      this.put(directory, path, data.length);
      return { uri: `file:///${directory}/${path}` };
    }),
  };

  readonly FileTransfer = {
    downloadFile: vi.fn(async ({ url, path }: { url: string; path: string }) => {
      this.downloads.push(url);
      const key = this.fromUri(path);
      await this.onDownload(url, bytes => this.files.set(key, { size: bytes, mtime: Date.now() }));
      return { path };
    }),
  };

  /** Route capacitorPlugins.filesystem()/fileTransfer() to this fake. */
  install(): this {
    vi.spyOn(capacitorPlugins, 'filesystem').mockResolvedValue(
      { Filesystem: this.Filesystem, Directory } as unknown as Awaited<ReturnType<typeof capacitorPlugins.filesystem>>);
    vi.spyOn(capacitorPlugins, 'fileTransfer').mockResolvedValue(
      { FileTransfer: this.FileTransfer } as unknown as Awaited<ReturnType<typeof capacitorPlugins.fileTransfer>>);
    return this;
  }
}
