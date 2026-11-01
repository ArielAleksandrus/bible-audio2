import { Capacitor } from '@capacitor/core';

/**
 * True inside the Android/iOS Capacitor shell, false for the PWA/browser.
 *
 * Most of the web-only workarounds in this codebase (dual <audio> priming,
 * service-worker bypass, install banners, Instagram/Safari warnings) exist
 * because a browser tab is not allowed to keep audio alive with the screen
 * locked. The native shell plays through the OS media player instead, so
 * those code paths are skipped whenever this returns true.
 */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

export function nativePlatform(): 'android' | 'ios' | 'web' {
  return Capacitor.getPlatform() as 'android' | 'ios' | 'web';
}
