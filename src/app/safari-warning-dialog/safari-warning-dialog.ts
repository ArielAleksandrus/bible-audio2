import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-safari-warning-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, TranslateModule],
  templateUrl: './safari-warning-dialog.html',
  styleUrl: './safari-warning-dialog.scss'
})
export class SafariWarningDialog {
  constructor(public dialogRef: MatDialogRef<SafariWarningDialog>) {}

  close(): void {
    this.dialogRef.close();
  }
}
