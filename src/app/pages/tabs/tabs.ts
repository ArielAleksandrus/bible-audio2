import { Component, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel } from '@ionic/angular';

import { AudioPlayer } from '../../components/audio-player/audio-player';
import { AppStateService } from '../../services/app-state.service';

/**
 * Bottom-tab shell. The mini player sits in the tabs' bottom slot right above
 * the tab bar, outside the page outlet, so it stays put across tab switches
 * and never covers page content (pages end where it begins).
 */
@Component({
  selector: 'app-tabs',
  imports: [AsyncPipe, TranslatePipe, IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel, AudioPlayer],
  template: `
    <ion-tabs>
      <app-audio-player slot="bottom"></app-audio-player>

      <ion-tab-bar slot="bottom" [class.hidden]="!(appState.hasSelectedLanguage$ | async)">
        <ion-tab-button tab="home">
          <ion-icon name="home-outline"></ion-icon>
          <ion-label>{{ 'menu.home' | translate }}</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="plans">
          <ion-icon name="list-outline"></ion-icon>
          <ion-label>{{ 'menu.plans' | translate }}</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="settings">
          <ion-icon name="settings-outline"></ion-icon>
          <ion-label>{{ 'menu.settings' | translate }}</ion-label>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  `,
  styles: `
    ion-tab-bar {
      --background: var(--ion-color-primary);
      --color: rgba(255, 255, 255, 0.7);
      --color-selected: #ffffff;
    }
    ion-tab-bar.hidden {
      display: none;
    }
  `,
})
export class TabsPage {
  appState = inject(AppStateService);
}
