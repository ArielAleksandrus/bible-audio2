import { Routes } from '@angular/router';

// Tab URLs stay the same as before (/home, /plans, /settings) so existing
// PWA bookmarks and installed shortcuts keep working.
export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/tabs/tabs').then(m => m.TabsPage),
    children: [
      { path: '', redirectTo: 'home', pathMatch: 'full' },
      {
        path: 'home',
        loadComponent: () => import('./pages/home/home').then(m => m.Home),
      },
      {
        path: 'plans',
        loadComponent: () => import('./pages/plans/plans').then(m => m.Plans),
      },
      {
        path: 'settings',
        loadComponent: () => import('./pages/settings/settings').then(m => m.Settings),
      },
    ],
  },
  { path: '**', redirectTo: 'home' },
];
