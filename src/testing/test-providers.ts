import { EnvironmentProviders, Provider } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { provideServiceWorker } from '@angular/service-worker';
import { AlertController, ModalController, ToastController, provideIonicAngular } from '@ionic/angular';

// jsdom has no matchMedia (used by the PWA install/standalone checks).
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const overlay = () => ({
  create: vi.fn().mockResolvedValue({
    present: vi.fn().mockResolvedValue(undefined),
    onDidDismiss: vi.fn().mockResolvedValue({ data: undefined, role: 'cancel' }),
  }),
  dismiss: vi.fn().mockResolvedValue(true),
});

/** Everything a page/shell component needs to be created under jsdom. */
export function appTestProviders(): (Provider | EnvironmentProviders)[] {
  return [
    provideIonicAngular({}),
    provideRouter([]),
    provideHttpClient(),
    provideHttpClientTesting(),
    provideTranslateService(),
    provideServiceWorker('ngsw-worker.js', { enabled: false }),
    { provide: ModalController, useFactory: overlay },
    { provide: AlertController, useFactory: overlay },
    { provide: ToastController, useFactory: overlay },
  ];
}
