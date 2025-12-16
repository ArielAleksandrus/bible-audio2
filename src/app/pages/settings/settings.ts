import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { dbPromise, AvailableSpace } from '../../storage/my-db';
import { TranslateService, TranslateModule } from '@ngx-translate/core';

import { BibleService } from '../../services/bible.service';
import { Bible } from 'bible-picker';

import { MatDialog } from '@angular/material/dialog';
import { ConfirmationDialog } from '../../confirmation-dialog/confirmation-dialog';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatCardModule,
    MatButtonModule,
    TranslateModule
  ],
  templateUrl: './settings.html',
  styleUrl: './settings.scss'
})
export class Settings {
  usedByAudiosMB: number = 0;
  usedByPlansMB: number = 0;
  usedByBiblesMB: number = 0;
  totalUsedMB: number = 0;
  availableMB: number = 0;
  percentageUsed: number = 0;

  loading = true;

  private availableSpace = new AvailableSpace();
  private bibleData?: Bible;

  currentLanguageName: string = "Português";
  languageMap = {
    "pt": "Português",
    "en": "English",
    "es": "Español",
    "zh": "中文 (Chinese)"
  };

  constructor(
    private translate: TranslateService,
    private bibleServ: BibleService,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef
  ) {

    let bibleJson = localStorage.getItem("selectedBible");
    if(!bibleJson) {
      location.href = "/home";
    }

    let selected = localStorage.getItem("selectedBible") || "";
    this.bibleServ.loadBibleVersion(selected.split("-")[0], selected.split("-")[1]).then(res => {
      if(res) {
        this.bibleData = res;
        const savedLang = this.bibleData.language;
        if(savedLang) {
          this.translate.use(savedLang);
        }
        //@ts-ignore
        this.currentLanguageName = this.languageMap[this.bibleData.language || "pt"] || "Português";
      } else {
        location.href = "/home";
      }
    });

  }

  ngOnInit() {
    this.calculateStorage().then(() => {
      this.loading = false;
      this.cdr.detectChanges();
    });
  }

  resetLanguage() {
    this.bibleServ.removeBibleVersion();
    location.href = "/home";
  }

  async calculateStorage() {
    // 1. Espaço disponível total (do dispositivo)
    this.availableMB = this.fixNumber(await this.availableSpace.inMB());

    // 2. Tamanho dos áudios baixados (store 'files')
    let audiosSize = 0;
    const db = await dbPromise;
    const tx = db.transaction('files', 'readonly');
    const store = tx.objectStore('files');
    const allFiles = await store.getAll();

    for (const file of allFiles) {
      if (file.blob) {
        audiosSize += file.blob.size;
      }
    }
    this.usedByAudiosMB = this.fixNumber(audiosSize / (1024 * 1024));

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
    const dialogRef = this.dialog.open(ConfirmationDialog, {
      width: '380 px',
      maxWidth: '90vw',
      autoFocus: false,
      disableClose: false,
      panelClass: 'hold-confirm-dialog-panel'
    });

    dialogRef.afterClosed().subscribe(result => {
      if(result === true) {
        dbPromise.then(db => {
          db.clear('files').then(() => {
            this.calculateStorage().then(() => {
              this.cdr.detectChanges();
              alert('Pronto/Done/Listo/好了');
            });
          });
        })
      }
    })

  }
}
