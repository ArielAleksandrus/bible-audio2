import { Component, ElementRef, Input, OnChanges, Output, EventEmitter, inject } from '@angular/core';
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
export class BibleTextViewer implements OnChanges {
  @Input() book!: BibleBook;
  @Input() chapters: number[] = [];
  /** Verse (of the first chapter shown) to scroll to and mark, e.g. a search result. */
  @Input() highlightVerse?: number;
  @Output() close = new EventEmitter<void>();

  private host: ElementRef<HTMLElement> = inject(ElementRef);

  ngOnChanges() {
    if (!this.highlightVerse) return;
    // After this change has rendered (and the overlay's slide-up has begun).
    setTimeout(() => {
      this.host.nativeElement.querySelector('.verse.highlight')?.scrollIntoView?.({ block: 'center' });
    }, 50);
  }

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
