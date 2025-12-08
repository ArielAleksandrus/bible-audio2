import { Injectable } from '@angular/core';

/**
 * AudioPlaylistService manages the list of tracks, current track,
 * and provides next/previous/selection logic for playlist navigation.
 */
export interface AudioTrack {
  url: string;
  title: string;
  artist?: string;
  cover?: string;
}

@Injectable({ providedIn: 'root' })
export class AudioPlaylistService {
  private tracks: AudioTrack[] = [];
  private currentIndex: number = 0;

  setTracks(tracks: AudioTrack[]) {
    this.tracks = tracks;
    this.currentIndex = 0;
  }

  getTracks(): AudioTrack[] {
    return this.tracks;
  }

  getCurrentTrack(): AudioTrack | null {
    return this.tracks.length > 0 ? this.tracks[this.currentIndex] : null;
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  selectTrack(index: number): AudioTrack | null {
    if (index < 0 || index >= this.tracks.length) return null;
    this.currentIndex = index;
    return this.getCurrentTrack();
  }

  next(): AudioTrack | null {
    if (this.currentIndex < this.tracks.length - 1) {
      this.currentIndex++;
      return this.getCurrentTrack();
    }
    return null; // end of playlist
  }

  previous(): AudioTrack | null {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      return this.getCurrentTrack();
    }
    return null; // beginning of playlist
  }

  hasNext(): boolean {
    return this.currentIndex < this.tracks.length - 1;
  }

  hasPrevious(): boolean {
    return this.currentIndex > 0;
  }
}
