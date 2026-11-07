import { ApplicationConfig, provideBrowserGlobalErrorListeners, isDevMode } from '@angular/core';
import { provideRouter, RouteReuseStrategy } from '@angular/router';
import { provideIonicAngular, IonicRouteStrategy } from '@ionic/angular';

import { routes } from './app.routes';
import { provideServiceWorker } from '@angular/service-worker';
import { isNativeApp } from './utils/platform.util';

import { inject, Injectable } from '@angular/core';
import { provideTranslateService, provideTranslateLoader, provideMissingTranslationHandler, TranslateLoader } from '@ngx-translate/core';
import { HttpClient, provideHttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { HumanizedMissingTranslationHandler } from './i18n/humanized-missing-translation-handler';

const I18N_PREFIX = './assets/i18n/';
const I18N_SUFFIX = '.json';

// Some Bible JSONs on the CDN report their language as a regional variant
// (e.g. 'pt-br') that has no matching file under assets/i18n — only the
// base 'pt.json' exists. Normalizing here means even a stale cached client
// that hasn't picked up the code fix yet can't request a deleted file.
@Injectable()
class AppTranslateLoader implements TranslateLoader {
  private http = inject(HttpClient);

  getTranslation(lang: string): Observable<any> {
    const base = lang.split('-')[0];
    return this.http.get(`${I18N_PREFIX}${base}${I18N_SUFFIX}`);
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Ionic picks iOS or Material Design styling from the platform it runs on.
    provideIonicAngular({}),
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideRouter(routes),
    // The native apps ship the web bundle inside the binary (updates come
    // from the stores), so the PWA service worker is web-only.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode() && !isNativeApp(),
      registrationStrategy: 'registerWhenStable:30000'
    }),
    provideHttpClient(),
    provideTranslateService({
      fallbackLang: 'pt',  // português como padrão
      loader: provideTranslateLoader(AppTranslateLoader),
      missingTranslationHandler: provideMissingTranslationHandler(HumanizedMissingTranslationHandler)
    })
  ]
};
