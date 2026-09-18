import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { InAppBrowserWarningService } from '../../services/in-app-browser-warning.service';

// Renders the "you're in Instagram's browser" banner — all the logic for
// when it (re)appears lives in InAppBrowserWarningService, since that has
// to be triggered from other pages too (home.ts on chapter selection,
// plans.ts on manually starting a reading or just landing on the page).
@Component({
  selector: 'app-in-app-browser-overlay',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule],
  templateUrl: './in-app-browser-overlay.html',
  styleUrl: './in-app-browser-overlay.scss'
})
export class InAppBrowserOverlay {
  constructor(public warning: InAppBrowserWarningService) {}

  dismiss(): void {
    this.warning.dismiss();
  }
}
