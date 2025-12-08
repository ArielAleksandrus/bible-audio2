import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'home', pathMatch: 'full' },

  {
    path: 'home',
    loadComponent: () => import('./pages/home/home').then(m => m.Home),
    data: { label: 'Home', icon: 'home' }
  },
  {
    path: 'plans',
    loadComponent: () => import('./pages/plans/plans').then(m => m.Plans),
    data: { label: 'Plans', icon: 'assignment' }
  },
  {
    path: 'settings',
    loadComponent: () => import('./pages/settings/settings').then(m => m.Settings),
    data: { label: 'Settings', icon: 'settings' }
  }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
