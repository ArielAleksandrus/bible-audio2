import { Component, OnInit } from '@angular/core';
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
    private bibleServ: BibleService
  ) {
    let bibleJson = localStorage.getItem("selectedBible");
    if(!bibleJson) {
      location.href = "/home";
    }
    let json = JSON.parse(bibleJson || "");
    this.bibleData = <Bible>json;
    //@ts-ignore
    this.currentLanguageName = this.languageMap[this.bibleData.language || "pt"] || "Português";
  }

  ngOnInit() {
    this.calculateStorage().then(() => {
      this.loading = false;
    });
  }

  resetLanguage() {
    this.bibleServ.removeBibleVersion();
    location.href = "/home";
  }

  async calculateStorage() {
    // 1. Espaço disponível total (do dispositivo)
    this.availableMB = await this.availableSpace.inMB();

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
    this.usedByAudiosMB = Math.round(audiosSize / (1024 * 1024) * 100) / 100; // arredonda 2 casas

    // 3. Tamanho dos planos (store 'plans') – geralmente insignificante
    const plansTx = db.transaction('plans', 'readonly');
    const plansStore = plansTx.objectStore('plans');
    const allPlans = await plansStore.getAll();
    let plansSize = 0;
    for (const plan of allPlans) {
      plansSize += new Blob([JSON.stringify(plan)]).size;
    }
    this.usedByPlansMB = Math.round(plansSize / (1024 * 1024) * 100) / 100;

    // 4. Total usado pelo app
    this.totalUsedMB = this.usedByAudiosMB + this.usedByPlansMB;

    // 5. Porcentagem usada (baseado no disponível)
    if (this.availableMB > 0) {
      this.percentageUsed = Math.min(100, Math.round((this.totalUsedMB / (this.totalUsedMB + this.availableMB)) * 100));
    }
  }

  async clearAllAudios() {
    if((prompt("Tem certeza que quer apagar TODOS os áudios baixados? Isso não afeta seus planos. Para prosseguir, digite: sim") || "").toLowerCase() == "sim") {
    const db = await dbPromise;
    await db.clear('files');
    await this.calculateStorage();
    alert('Áudios apagados com sucesso!');
    }
  }
}
