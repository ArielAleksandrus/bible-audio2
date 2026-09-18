import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';

// A short YouTube Shorts walkthrough of "Share -> Add to Home Screen" on
// iOS, offered from SafariWarningDialog's "Como fazer?" button. Confirms
// first (some users are on limited data and don't want a video), then
// embeds it in an iframe rather than sending the user to a new tab, so they
// don't lose their place in the app.
const EXAMPLE_VIDEO_URL = 'https://www.youtube.com/embed/Bm3VIOUe7ZY?autoplay=1&playsinline=1';

@Component({
  selector: 'app-video-example-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, TranslateModule],
  templateUrl: './video-example-dialog.html',
  styleUrl: './video-example-dialog.scss'
})
export class VideoExampleDialog {
  showVideo = false;
  videoUrl: SafeResourceUrl;

  constructor(
    public dialogRef: MatDialogRef<VideoExampleDialog>,
    sanitizer: DomSanitizer
  ) {
    this.videoUrl = sanitizer.bypassSecurityTrustResourceUrl(EXAMPLE_VIDEO_URL);
  }

  confirm(): void {
    this.showVideo = true;
  }

  close(): void {
    this.dialogRef.close();
  }
}
