import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/**
 * Android-only local plugin (android/app/.../BulkDownloadPlugin.java): runs
 * the full-Bible download in a foreground service with a progress
 * notification, so it keeps going after the user leaves the app.
 */
export type BulkDownloadStatus = 'idle' | 'running' | 'completed' | 'error' | 'cancelled';

export interface BulkDownloadSnapshot {
  status: BulkDownloadStatus;
  total: number;
  downloaded: number;
  failed: number;
}

export interface BulkDownloadPlugin {
  start(options: {
    items: { id: string; url: string; fileName: string }[];
    /** Notification texts. Placeholders: progress → {done} {total}; incomplete → {failed}. */
    strings: { title: string; progress: string; complete: string; incomplete: string; cancel: string };
  }): Promise<BulkDownloadSnapshot>;
  cancel(): Promise<void>;
  getStatus(): Promise<BulkDownloadSnapshot>;
  addListener(event: 'progress', cb: (s: BulkDownloadSnapshot) => void): Promise<PluginListenerHandle>;
  addListener(event: 'itemDone', cb: (e: { id: string; size: number }) => void): Promise<PluginListenerHandle>;
}

export const BulkDownload = registerPlugin<BulkDownloadPlugin>('BulkDownload');
