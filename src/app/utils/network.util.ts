import { isNativeApp } from './platform.util';

/**
 * True only when the device is online and the connection is unmetered:
 * Wi-Fi, or Ethernet where the browser reports it. Cellular, offline, and
 * "can't tell" (Safari, desktop Chrome) are false, so a background download
 * never starts on a connection that might be the user's mobile data.
 */
export async function onWifi(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  if (isNativeApp()) {
    try {
      const { Network } = await import('@capacitor/network');
      const status = await Network.getStatus();
      return status.connectionType === 'wifi';
    } catch {
      return false;
    }
  }
  const nav = navigator as Navigator & {
    connection?: { type?: string };
    mozConnection?: { type?: string };
    webkitConnection?: { type?: string };
  };
  const type = (nav.connection || nav.mozConnection || nav.webkitConnection)?.type;
  return type === 'wifi' || type === 'ethernet';
}

/**
 * Calls `onUnmetered` when the reported connection changes. The callback
 * still checks `onWifi`: this only hears a change the platform actually
 * reports, and a browser that never reports the type (Safari, desktop
 * Chrome) never fires it. Those devices pick up a new chapter on play.
 */
export function watchWifi(onUnmetered: () => void): void {
  if (isNativeApp()) {
    void import('@capacitor/network').then(({ Network }) =>
      Network.addListener('networkStatusChange', status => {
        if (status.connected && status.connectionType === 'wifi') onUnmetered();
      })).catch(() => {});
    return;
  }
  const nav = navigator as Navigator & {
    connection?: EventTarget;
    mozConnection?: EventTarget;
    webkitConnection?: EventTarget;
  };
  const connection = nav.connection || nav.mozConnection || nav.webkitConnection;
  connection?.addEventListener('change', () => onUnmetered());
}
