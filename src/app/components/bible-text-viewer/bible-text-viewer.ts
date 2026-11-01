import { Component, Input, Output, EventEmitter } from '@angular/core';
import { IonButton, IonButtons, IonIcon, IonTitle, IonToolbar } from '@ionic/angular';

import { BibleBook } from 'bible-picker';
import { parseChapter, bookDisplayName, ChapterEntry } from '../../utils/bible-text.util';

interface RenderedChapter {
  number: number;
  entries: ChapterEntry[];
}

@Component({
  selector: 'app-bible-text-viewer',
  imports: [IonToolbar, IonTitle, IonButtons, IonButton, IonIcon],
  templateUrl: './bible-text-viewer.html',
  styleUrl: './bible-text-viewer.scss'
})
export class BibleTextViewer {
  @Input() book!: BibleBook;
  @Input() chapters: number[] = [];
  @Output() close = new EventEmitter<void>();

  get bookDisplayName(): string {
    return bookDisplayName(this.book);
  }

  get renderedChapters(): RenderedChapter[] {
    if (!this.book) return [];
    return this.chapters.map(number => ({
      number,
      entries: parseChapter(this.book.chapters[number - 1] || [])
    }));
  }
}
