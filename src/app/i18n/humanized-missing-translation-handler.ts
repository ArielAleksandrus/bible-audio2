import { Injectable } from '@angular/core';
import { MissingTranslationHandler, MissingTranslationHandlerParams } from '@ngx-translate/core';

// A client can end up running JS that requests a key its cached translation
// JSON doesn't have yet (see UpdateService — the service worker can lag well
// behind the JS bundle for an installed PWA that's rarely fully closed).
// Rather than showing that raw dotted key to the user (e.g.
// "plans.current.days_completed"), fall back to a readable label derived
// from the key itself.
@Injectable()
export class HumanizedMissingTranslationHandler implements MissingTranslationHandler {
  handle(params: MissingTranslationHandlerParams): string {
    console.warn('Missing translation key:', params.key);
    const lastSegment = params.key.split('.').pop() || params.key;
    return lastSegment
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }
}
