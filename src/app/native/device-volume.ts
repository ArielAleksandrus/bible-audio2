import { registerPlugin } from '@capacitor/core';

/**
 * Local plugin (android/.../DeviceVolumePlugin.java, ios/App/App/DeviceVolumePlugin.swift):
 * the device's media volume, which the WebView can't read. Present from the
 * 3.0.0 store build on; older shells reject the call as not implemented.
 */
export interface DeviceVolumePlugin {
  /** 0 (silent) to 1 (max). */
  getVolume(): Promise<{ volume: number }>;
}

export const DeviceVolume = registerPlugin<DeviceVolumePlugin>('DeviceVolume');
