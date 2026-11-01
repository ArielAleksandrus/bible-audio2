import { capacitorPlugins } from '../utils/capacitor-plugins';

/**
 * Lock-screen / notification cover art for the native player.
 *
 * The app icon ships inside the web bundle, which only the WebView can read.
 * The OS media player needs a real file instead, so it's copied once into the
 * app's data directory. Android (Glide) takes a `file://` URI; the iOS plugin
 * loads non-http artwork with `UIImage(contentsOfFile:)`, i.e. a plain path.
 * Works offline, unlike pointing at the icon on the website.
 */
const SOURCE = '/icons/android/android-launchericon-512-512.png';
const TARGET = 'artwork-512.png';

let cached: Promise<string | null> | null = null;

export function artworkUri(platform: 'android' | 'ios' | 'web'): Promise<string | null> {
  if (platform === 'web') return Promise.resolve(null);
  if (!cached) {
    cached = (async () => {
      const { Filesystem, Directory } = await capacitorPlugins.filesystem();
      try {
        await Filesystem.stat({ path: TARGET, directory: Directory.Data });
      } catch {
        const blob = await (await fetch(SOURCE)).blob();
        const data = await blobToBase64(blob);
        await Filesystem.writeFile({ path: TARGET, directory: Directory.Data, data });
      }
      const { uri } = await Filesystem.getUri({ path: TARGET, directory: Directory.Data });
      return platform === 'ios' ? decodeURIComponent(uri.replace(/^file:\/\//, '')) : uri;
    })().catch(err => {
      console.warn('artworkUri: falling back to the plugin default', err);
      cached = null;
      return null;
    });
  }
  return cached;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
