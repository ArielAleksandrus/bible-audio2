import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { loadFormatSupport, probeFormats } from './app/utils/audio-format-probe';

// Before anything builds an audio URL: which formats earlier starts found
// this device plays. Then check again, for the next start.
loadFormatSupport();
void probeFormats();

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
