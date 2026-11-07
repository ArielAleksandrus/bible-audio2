import { Component, inject } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { TranslatePipe } from '@ngx-translate/core';
import { IonButton, IonIcon, ModalController } from '@ionic/angular';

// A short YouTube Shorts walkthrough of "Share -> Add to Home Screen" on
// iOS, offered from SafariWarningDialog's "Como fazer?" button. Confirms
// first (some users are on limited data and don't want a video), then
// embeds it in an iframe rather than sending the user to a new tab, so they
// don't lose their place in the app.
const EXAMPLE_VIDEO_URL = 'https://www.youtube.com/embed/Bm3VIOUe7ZY?autoplay=1&playsinline=1';

@Component({
  selector: 'app-video-example-dialog',
  imports: [TranslatePipe, IonButton, IonIcon],
  templateUrl: './video-example-dialog.html',
  styleUrl: './video-example-dialog.scss'
})
export class VideoExampleDialog {
  showVideo = false;
  videoUrl: SafeResourceUrl;

  private modalCtrl = inject(ModalController);

  constructor() {
    this.videoUrl = inject(DomSanitizer).bypassSecurityTrustResourceUrl(EXAMPLE_VIDEO_URL);
  }

  confirm(): void {
    this.showVideo = true;
  }

  close(): void {
    void this.modalCtrl.dismiss();
  }
}
