import { Component, Inject } from '@angular/core';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';  // ← ESSA LINHA!
import { CommonModule } from '@angular/common';  // para *ngIf

@Component({
  selector: 'app-language-selector-dialog',
  templateUrl: './language-selector-dialog.html',
  styleUrl: './language-selector-dialog.scss',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatProgressSpinnerModule
  ]
})
export class LanguageSelectorDialog {
  loading = false;

  constructor(
    public dialogRef: MatDialogRef<LanguageSelectorDialog>,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {}

  select(language: string, version: string) {
    this.loading = true;
    this.dialogRef.close(language + "-" + version);
  }
}
