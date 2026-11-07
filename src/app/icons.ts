import { addIcons } from 'ionicons';
import {
  addCircleOutline, arrowForward, bookOutline, bookmarkOutline, checkmark, checkmarkCircle,
  checkmarkCircleOutline, close, cloudOutline, downloadOutline, helpCircleOutline, homeOutline,
  informationCircleOutline, languageOutline, libraryOutline, listOutline, logInOutline, logOutOutline,
  notificationsOffOutline, notificationsOutline, openOutline, pause, phonePortraitOutline, play,
  playBack, playCircleOutline, playForward, playSkipBack, playSkipForward, refreshOutline,
  serverOutline, settingsOutline, shareOutline, timeOutline, trashOutline, warningOutline,
  chevronBack, chevronForward,
} from 'ionicons/icons';

/**
 * Ionicons are registered up front (instead of loaded from a CDN by name) so
 * every icon is in the bundle and renders offline — the same reason the old
 * Material Icons font was self-hosted.
 */
export function registerIcons(): void {
  addIcons({
    addCircleOutline, arrowForward, bookOutline, bookmarkOutline, checkmark, checkmarkCircle,
    checkmarkCircleOutline, close, cloudOutline, downloadOutline, helpCircleOutline, homeOutline,
    informationCircleOutline, languageOutline, libraryOutline, listOutline, logInOutline, logOutOutline,
    notificationsOffOutline, notificationsOutline, openOutline, pause, phonePortraitOutline, play,
    playBack, playCircleOutline, playForward, playSkipBack, playSkipForward, refreshOutline,
    serverOutline, settingsOutline, shareOutline, timeOutline, trashOutline, warningOutline,
    chevronBack, chevronForward,
  });
}
