import { Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AudioPlayer } from './components/audio-player/audio-player';

// Material components (MDC-based tab nav bar)
import { MatTabNav, MatTabLink, MatTabNavPanel } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-root',
  imports: [
    // Material modules
    MatTabNav, MatTabLink, MatTabNavPanel, MatIconModule,
    RouterLink, RouterLinkActive, RouterOutlet,

    // My components:
    AudioPlayer
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('bible-audio2');

  links: string[] = ['Home', 'Planos', 'Configs'];
  activeLink = this.links[0];
}
