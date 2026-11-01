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

/**
 * Chapter URLs on the CDN contain a literal space (`…/GN/GN 1.mp3`). Browsers
 * encode that on their own, but the native side doesn't: iOS < 17's
 * `URL(string:)` — used by both the playlist plugin (AudioTrack.swift) and
 * @capacitor/file-transfer — returns nil for it, so the chapter is silently
 * dropped from the queue / the download fails. Only spaces are encoded, so an
 * already-encoded URL (`%20`, `%C3%A9`…) is left untouched.
 */
export function nativeSafeUrl(url: string): string {
  return url.replace(/ /g, '%20');
}
