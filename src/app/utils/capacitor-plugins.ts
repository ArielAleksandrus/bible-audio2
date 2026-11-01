/**
 * Lazy loaders for the Capacitor plugins the app uses.
 *
 * Each one is still a dynamic import, so a plugin only lands in its own
 * chunk and only loads when native code actually needs it (the web/PWA
 * never loads most of them). Going through this object instead of calling
 * `import('@capacitor/…')` inline gives unit tests one place to swap in a
 * fake: `vi.spyOn(capacitorPlugins, 'filesystem').mockResolvedValue(…)`.
 * (Spying on the plugin proxies themselves doesn't work, and vi.mock of a
 * package isn't reliable under the Angular unit-test builder.)
 */
export const capacitorPlugins = {
  filesystem: () => import('@capacitor/filesystem'),
  fileTransfer: () => import('@capacitor/file-transfer'),
  localNotifications: () => import('@capacitor/local-notifications'),
  network: () => import('@capacitor/network'),
  keepAwake: () => import('@capacitor-community/keep-awake'),
  firebaseAuthentication: () => import('@capacitor-firebase/authentication'),
};
