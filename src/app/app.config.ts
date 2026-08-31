import { ApplicationConfig, provideBrowserGlobalErrorListeners, isDevMode, importProvidersFrom } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideServiceWorker } from '@angular/service-worker';

import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';

import { inject, Injectable } from '@angular/core';
import { provideTranslateService, provideTranslateLoader, TranslateLoader } from '@ngx-translate/core';
import { HttpClient, provideHttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

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
    importProvidersFrom(
      MatTabsModule,
      MatIconModule
    ),
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000'
    }),
    provideHttpClient(),
    provideTranslateService({
      defaultLanguage: 'pt',  // português como padrão
      loader: provideTranslateLoader(AppTranslateLoader)
    })
  ]
};
