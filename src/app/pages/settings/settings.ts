import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonContent, IonHeader, IonIcon,
  IonProgressBar, IonSpinner, IonTitle, IonToolbar, ModalController, ViewWillEnter,
} from '@ionic/angular';
import { dbPromise, AvailableSpace } from '../../storage/my-db';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';

import { BibleService } from '../../services/bible.service';
import { AuthService } from '../../services/auth.service';
import { NotificationsService } from '../../services/notifications.service';
import { AudioDownloaderService } from '../../services/audio-downloader.service';
import { UiService } from '../../services/ui.service';
import { Bible } from 'bible-picker';
import type { User } from 'firebase/auth';

import { ConfirmationDialog } from '../../confirmation-dialog/confirmation-dialog';

import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-settings',
  imports: [
    DecimalPipe, TranslatePipe,
    IonHeader, IonToolbar, IonTitle, IonContent, IonCard, IonCardHeader, IonCardTitle, IonCardContent,
    IonButton, IonIcon, IonProgressBar, IonSpinner,
  ],
  templateUrl: './settings.html',
  styleUrl: './settings.scss'
})
export class Settings implements ViewWillEnter {
  usedByAudiosMB: number = 0;
  usedByPlansMB: number = 0;
  usedByBiblesMB: number = 0;
  totalUsedMB: number = 0;
  availableMB: number = 0;
  percentageUsed: number = 0;

  version = environment.appVersion;

  loading = true;

  private availableSpace = new AvailableSpace();
  private bibleData?: Bible;

  currentLanguageName: string = "Português";
  languageMap = {
    "pt": "Português",
    "en": "English",
    "es": "Español",
    "zh": "中文 (Chinese)",
    "ja": "日本語 (Japanese)"
  };

  user: User | null = null;

  notifSubscribed = false;
  notifBusy = false;
  notifError: string | null = null;
  signingIn = false;

  constructor(
    private translate: TranslateService,
    private bibleServ: BibleService,
    private modals: ModalController,
    private ui: UiService,
    private router: Router,
    private downloader: AudioDownloaderService,
    private cdr: ChangeDetectorRef,
    public authServ: AuthService,
    public notifServ: NotificationsService
  ) {
    this.notifSubscribed = this.notifServ.isSubscribed;

    // user$ is a BehaviorSubject, so subscribing here replays its current
    // value synchronously, before Angular has finished creating this
    // component's own view. Calling detectChanges() — an immediate,
    // synchronous re-check — from inside that replay re-enters Angular's
    // change detection while this view's own initial pass is still running,
    // which threw "ASSERTION ERROR: Should be run in update mode" on every
    // navigation to Settings (confirmed via repeated Home<->Settings
    // navigation in a real browser) and left that render half-applied —
    // this is what was behind the settings gear icon intermittently
    // rendering as raw clipped text after switching tabs. markForCheck()
    // just flags the view for the next cycle instead of forcing one now, so
    // it's safe to call from here (see AudioPlayer's ctor for the same
    // pattern). takeUntilDestroyed() additionally stops this from leaking a
    // subscriber (holding a dead view's ChangeDetectorRef) on every visit,
    // since Settings is recreated each time the route is entered.
    this.authServ.user$.pipe(takeUntilDestroyed()).subscribe(user => {
      this.user = user;
      this.cdr.markForCheck();
    });

    let bibleJson = localStorage.getItem("selectedBible");
    if(!bibleJson) {
      void this.router.navigateByUrl('/home');
    }

    let selected = localStorage.getItem("selectedBible") || "";
    this.bibleServ.loadBibleVersion(selected.split("-")[0], selected.split("-")[1]).then(res => {
      if(res) {
        this.bibleData = res;
        const savedLang = this.bibleData.language?.split("-")[0]; // e.g. 'pt-br' -> 'pt'
        if(savedLang) {
          this.translate.use(savedLang);
        }
        //@ts-ignore
        this.currentLanguageName = this.languageMap[savedLang || "pt"] || "Português";
        this.cdr.markForCheck();
      } else {
        void this.router.navigateByUrl('/home');
      }
    });

  }

  // Tabs keep this page alive, so recompute storage every time it's shown
  // (chapters may have been downloaded or played since the last visit).
  ionViewWillEnter() {
    this.calculateStorage().then(() => {
      this.loading = false;
      this.cdr.detectChanges();
    });
  }

  async resetLanguage() {
    await this.bibleServ.removeBibleVersion();
    // Full reload on purpose: every page re-reads the chosen Bible on start.
    location.href = "/home";
  }

  async signIn() {
    this.signingIn = true;
    try {
      await this.authServ.signInWithGoogle();
    } catch (err) {
      console.warn('Settings::signIn', err);
    } finally {
      this.signingIn = false;
      this.cdr.markForCheck();
    }
  }

  signOut() {
    this.authServ.signOut();
  }

  async toggleNotifications() {
    this.notifError = null;
    this.notifBusy = true;
    try {
      if (this.notifSubscribed) {
        await this.notifServ.unsubscribe();
        this.notifSubscribed = false;
      } else {
        await this.notifServ.subscribe(this.bibleData?.language || 'en');
        this.notifSubscribed = true;
      }
    } catch (err) {
      console.warn('Settings::toggleNotifications', err);
      this.notifError = 'permission';
    } finally {
      this.notifBusy = false;
      this.cdr.detectChanges();
    }
  }

  async calculateStorage() {
    // 1. Espaço disponível total (do dispositivo)
    this.availableMB = this.fixNumber(await this.availableSpace.inMB());

    // 2. Tamanho dos áudios baixados (IndexedDB na web, arquivos no app nativo)
    const audiosSize = await this.downloader.getDownloadedBytes();
    this.usedByAudiosMB = this.fixNumber(audiosSize / (1024 * 1024));
    const db = await dbPromise;

    // 3. Tamanho dos planos (store 'plans') – geralmente menos de 1 MB
    const plansTx = db.transaction('plans', 'readonly');
    const plansStore = plansTx.objectStore('plans');
    const allPlans = await plansStore.getAll();
    let plansSize = 0;
    for (const plan of allPlans) {
      plansSize += new Blob([JSON.stringify(plan)]).size;
    }
    this.usedByPlansMB = this.fixNumber(plansSize / (1024 * 1024));

    // 4. Tamanho das bíblias em texto - geralmente poucos Mb
    const biblesTx = db.transaction('bibles', 'readonly');
    const biblesStore = biblesTx.objectStore('bibles');
    const allBibles = await biblesStore.getAll();
    let biblesSize = 0;
    for(const bible of allBibles) {
      biblesSize += new Blob([JSON.stringify(bible)]).size;
    }
    this.usedByBiblesMB = this.fixNumber(biblesSize / (1024 * 1024));

    // 5. Total usado pelo app
    this.totalUsedMB = this.fixNumber(this.usedByAudiosMB + this.usedByPlansMB + this.usedByBiblesMB);

    // 6. Porcentagem usada (baseado no disponível)
    if (this.availableMB > 0) {
      this.percentageUsed = this.fixNumber(Math.min(100, Math.round((this.totalUsedMB / (this.totalUsedMB + this.availableMB)) * 100)));
    }
  }

  fixNumber(n: number, decimals: number = 2): number {
    return Number(n.toFixed(decimals));
  }

  async clearAllAudios() {
    const modal = await this.modals.create({ component: ConfirmationDialog, cssClass: 'app-dialog' });
    await modal.present();
    const { data: result } = await modal.onDidDismiss<boolean>();
    if (result !== true) return;

    await this.downloader.clearAll();
    await this.calculateStorage();
    this.cdr.detectChanges();
    await this.ui.alert('Pronto/Done/Listo/好了');
  }
}
