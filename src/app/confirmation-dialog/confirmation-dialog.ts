import { Component, OnInit, OnDestroy } from '@angular/core';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { CommonModule } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-confirmation-dialog',
  templateUrl: './confirmation-dialog.html',
  styleUrl: './confirmation-dialog.scss',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatIconModule,
    TranslateModule,
    MatDialogModule
  ]
})
export class ConfirmationDialog implements OnInit, OnDestroy {
  // Defaults (Portuguese, matching the app's default language) so the dialog
  // is never blank if the translation request stalls or fails — e.g. a slow
  // or offline connection while the language file hasn't been cached yet.
  title = 'Tem certeza?';
  message = 'Para confirmar, segure este botão por 5 segundos';
  progress = 0; // 0 a 100
  private interval: any = null;
  private readonly duration = 5000; // 5 segundos
  private isHolding = false;

  constructor(
    public dialogRef: MatDialogRef<ConfirmationDialog>,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.setLanguageFromLocalStorage();
    // Keep the hardcoded defaults above if this never resolves (e.g. the
    // translation file fails to load) — only override once we actually have
    // a real value, and don't let an error clear the fallback text.
    this.translate.get('dialog.hold_confirm.title').subscribe({
      next: res => { if (res) this.title = res; },
      error: err => console.warn('Failed to load dialog title translation:', err),
    });
    this.translate.get('dialog.hold_confirm.message').subscribe({
      next: res => { if (res) this.message = res; },
      error: err => console.warn('Failed to load dialog message translation:', err),
    });
  }

  ngOnDestroy(): void {
    this.clearHold();
  }

  private setLanguageFromLocalStorage(): void {
    const selectedBible = localStorage.getItem('selectedBible') || '';
    let lang = 'pt'; // padrão português — matches public/assets/i18n/pt.json

    if (selectedBible.includes('-')) {
      const code = selectedBible.split('-')[0].toLowerCase();
      if (['en', 'es', 'zh', 'ja'].includes(code)) {
        lang = code;
      }
    }

    this.translate.setDefaultLang(lang);
    this.translate.use(lang);
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  // Mouse events
  onMouseDown(event: MouseEvent): void {
    event.preventDefault();
    this.startHold();
    document.addEventListener('mouseup', this.onGlobalMouseUp);
  }

  private onGlobalMouseUp = () => {
    this.stopHold();
    document.removeEventListener('mouseup', this.onGlobalMouseUp);
  };

  // Touch events (mobile)
  onTouchStart(event: TouchEvent): void {
    event.preventDefault();
    this.startHold();
    document.addEventListener('touchend', this.onGlobalTouchEnd);
    document.addEventListener('touchcancel', this.onGlobalTouchEnd);
  }

  private onGlobalTouchEnd = () => {
    this.stopHold();
    document.removeEventListener('touchend', this.onGlobalTouchEnd);
    document.removeEventListener('touchcancel', this.onGlobalTouchEnd);
  };

  private startHold(): void {
    if (this.isHolding) return;

    this.isHolding = true;
    this.progress = 0;
    let elapsed = 0;

    this.interval = setInterval(() => {
      elapsed += 50;
      this.progress = (elapsed / this.duration) * 100;

      if (elapsed >= this.duration) {
        this.completeHold();
      }
    }, 50);
  }

  private stopHold(): void {
    if (!this.isHolding) return;

    this.isHolding = false;
    this.clearHold();

    if (this.progress < 100) {
      this.progress = 0;
      this.dialogRef.close(false);
    }
  }

  private completeHold(): void {
    this.isHolding = false;
    this.clearHold();
    this.progress = 100;
    this.dialogRef.close(true);
  }

  private clearHold(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
