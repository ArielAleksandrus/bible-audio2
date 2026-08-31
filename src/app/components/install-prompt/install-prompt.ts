import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';

import { InstallPromptService } from '../../services/install-prompt.service';

// A custom "Install app" banner instead of waiting for the user to find the
// browser's own install option. Android/Chrome/desktop: captures the native
// beforeinstallprompt event and triggers it directly. iOS Safari has no such
// event — Apple deliberately doesn't allow triggering the "Add to Home
// Screen" flow programmatically — so there we just show instructions.
@Component({
  selector: 'app-install-prompt',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, TranslateModule],
  templateUrl: './install-prompt.html',
  styleUrl: './install-prompt.scss'
})
export class InstallPrompt {
  constructor(public installServ: InstallPromptService) {}

  install(): void {
    void this.installServ.install();
  }

  dismiss(): void {
    this.installServ.dismiss();
  }
}
