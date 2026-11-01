// Global test setup (angular.json → test.options.setupFiles).
//
// jsdom has no IndexedDB. The app keeps plans, Bibles, downloaded web audio
// and the analytics queue there (src/app/storage/my-db.ts), so give every
// spec file an in-memory implementation — each file runs in its own
// environment, so state doesn't leak between files.
import 'fake-indexeddb/auto';

// The app registers its Ionicons in app.ts. Specs that render a component
// on its own would otherwise make <ion-icon> try to fetch the SVG by URL,
// which logs "TypeError: Invalid URL" under jsdom.
import { registerIcons } from '../app/icons';
registerIcons();
