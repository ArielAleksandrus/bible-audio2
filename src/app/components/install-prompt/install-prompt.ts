import { Component, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';

const DISMISSED_KEY = 'installPromptDismissed';

// beforeinstallprompt isn't a standard DOM type.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

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
  visible = false;
  mode: 'android' | 'ios' = 'android';

  private deferredPrompt: BeforeInstallPromptEvent | null = null;

  constructor() {
    if (this.alreadyInstalled() || localStorage.getItem(DISMISSED_KEY) === 'true') return;

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIos) {
      this.mode = 'ios';
      this.visible = true;
    }
    // Android/desktop: wait for beforeinstallprompt (handled below) before showing anything.
  }

  @HostListener('window:beforeinstallprompt', ['$event'])
  onBeforeInstallPrompt(event: Event) {
    event.preventDefault();
    if (localStorage.getItem(DISMISSED_KEY) === 'true') return;
    this.deferredPrompt = event as BeforeInstallPromptEvent;
    this.mode = 'android';
    this.visible = true;
  }

  async install() {
    if (!this.deferredPrompt) return;
    await this.deferredPrompt.prompt();
    await this.deferredPrompt.userChoice;
    this.deferredPrompt = null;
    this.visible = false;
  }

  dismiss() {
    this.visible = false;
    localStorage.setItem(DISMISSED_KEY, 'true');
  }

  private alreadyInstalled(): boolean {
    return window.matchMedia('(display-mode: standalone)').matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true;
  }
}
