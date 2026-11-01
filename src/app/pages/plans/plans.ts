import { Component, ChangeDetectorRef, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import {
  IonButton, IonButtons, IonCard, IonCardContent, IonCardHeader, IonCardSubtitle, IonCardTitle,
  IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonProgressBar, IonTitle, IonToolbar,
  ModalController,
} from '@ionic/angular';

import { AudioDownloaderService } from '../../services/audio-downloader.service';
import { AudioService } from '../../services/audio.service';
import { BibleService } from '../../services/bible.service';
import { PlanService } from '../../services/plan.service';
import { AnalyticsService } from '../../services/analytics.service';
import { SyncService } from '../../services/sync.service';
import { InAppBrowserWarningService } from '../../services/in-app-browser-warning.service';
import { UiService } from '../../services/ui.service';

import { Plan, DailyGoal } from '../../models/plan';
import { Track } from '../../models/track';
import { SamplePlan } from '../../data/my-plans';

import { Bible } from 'bible-picker';

import { ConfirmationDialog } from '../../confirmation-dialog/confirmation-dialog';


const PRELOAD_DAYS = 7;
/** Days per page in the current plan's day list (a week at a time). */
const PAGE_SIZE = 7;

@Component({
  selector: 'app-plans',
  imports: [
    TranslatePipe,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon, IonContent, IonList, IonItem,
    IonLabel, IonProgressBar, IonCard, IonCardHeader, IonCardTitle, IonCardSubtitle, IonCardContent,
  ],
  templateUrl: './plans.html',
  styleUrl: './plans.scss',
})
export class Plans {
  availablePlans: Plan[] = [];
  startedPlans: Plan[] = [];
  completedPlans: Plan[] = [];
  completionCounts: Record<string, number> = {};

  currentPlan?: Plan;
  currentDay: number = 1;
  stoppedAt: {day: number, portionIdx: number} = {day: 0, portionIdx: 0};

  bibleData?: Bible;

  tracks: Track[] = [];
  curTrackIdx: number = 0;

  readonly pageSize = PAGE_SIZE;
  pageIndex = 0;

  @ViewChild(IonContent) private content?: IonContent;

  get pageCount(): number {
    return this.currentPlan ? Math.ceil(this.currentPlan.goals.length / this.pageSize) : 0;
  }

  get pagedGoals(): DailyGoal[] {
    if (!this.currentPlan) return [];
    const start = this.pageIndex * this.pageSize;
    return this.currentPlan.goals.slice(start, start + this.pageSize);
  }

  goToPage(index: number) {
    this.pageIndex = Math.max(0, Math.min(index, this.pageCount - 1));
  }

  constructor(private planServ: PlanService,
    private dlServ: AudioDownloaderService,
    private bibleServ: BibleService,
    private audioService: AudioService,
    private cdr: ChangeDetectorRef,
    private modals: ModalController,
    private ui: UiService,
    private router: Router,
    private translate: TranslateService,
    private analytics: AnalyticsService,
    private syncServ: SyncService,
    private inAppBrowserWarning: InAppBrowserWarningService
  ) {

    if(!localStorage.getItem("selectedBible")) {
      void this.router.navigateByUrl('/home');
      return;
    }

    let selected = localStorage.getItem("selectedBible") || "";
    this.bibleServ.loadBibleVersion(selected.split("-")[0], selected.split("-")[1]).then(res => {
      if(res) {
        this.bibleData = res;
        const savedLang = this.bibleData.language?.split("-")[0]; // e.g. 'pt-br' -> 'pt'
        if(savedLang) {
          this.translate.use(savedLang);
        }
        this.cdr.markForCheck();
      } else {
        void this.router.navigateByUrl('/home');
      }
    });

  }

  // Plan title/author/description come from the plan JSON in a single base language.
  // Translations for them (when available) live in the i18n files under
  // plan_content.<planId>.<field>; if no translation exists for the current
  // language, the original text from the plan is used.
  planText(plan: Plan | undefined, field: 'title' | 'author' | 'description'): string {
    if(!plan) return '';
    const original = plan[field] as string | undefined;
    const key = `plan_content.${plan.id}.${field}`;
    const translated = this.translate.instant(key);
    return (translated && translated !== key) ? translated : (original || '');
  }

  completionCount(plan: Plan): number {
    return this.completionCounts[plan.id] || 0;
  }

  daysCompleted(plan: Plan): number {
    return plan.days - (plan.daysRemaining ?? 0);
  }

  ngOnInit() {
    this._loadPlans();

    // Landing on this page is itself a moment worth reminding the user
    // about, even if they dismissed the warning earlier elsewhere.
    this.inAppBrowserWarning.showNow();


    this.audioService.trackEnded$.subscribe(finishedTrack => {
      if(finishedTrack) {
        this.setTrackCompleted(finishedTrack, true);
      }
    })

    // Refresh the lists if a cross-device merge lands while this page is open.
    this.syncServ.syncCompleted$.subscribe(() => this._loadPlans());
  }

  setGoalCompleted(goal: DailyGoal, completed: boolean) {
    goal.completed = completed;
    for(let portion of goal.portions)
      portion.completed = completed;

    this.checkCompletedPlan();
    this.updatePlan();
  }
  setTrackCompleted(track: Track, completed: boolean) {
    if(!this.currentPlan || !this.bibleData)
      return;

    const bookIdx = this.bibleData.books.findIndex(book => book.name === track.book);
    for(let i = 0; i < this.currentPlan.goals.length; i++) {
      let goal = this.currentPlan.goals[i];
      let portion = goal.portions.find(portion => portion.bookIdx === bookIdx && portion.chapter === track.chapter)
      if(portion) {
        portion.completed = completed;
        goal.completed = goal.portions.every(portion => portion.completed);
        if(goal.completed && this.currentPlan.goals[i+1]) {
          this.currentDay = this.currentPlan.goals[i+1].day;
        }
      }
    }

    this.checkCompletedPlan();
    this.updatePlan();
  }

  updatePlan() {
    if(!this.currentPlan)
      return;

    this.currentPlan.stoppedAt = this.planServ.stoppedAt(this.currentPlan);
    this.currentPlan.daysRemaining = this.currentPlan.days + 1 - this.currentPlan.stoppedAt.day;
    this.planServ.save(this.currentPlan);
  }

  checkCompletedPlan() {
    if(!this.currentPlan)
      return;

    const completed: boolean = this.currentPlan.goals.every(goal => goal.completed);

    if(completed && this.currentPlan.status !== "completed") {
      const planId = this.currentPlan.id;
      this.currentPlan.status = "completed";
      this.analytics.planCompleted(planId);
      this.planServ.incrementCompletionCount(planId).then(count => {
        this.completionCounts[planId] = count;
      });
      void this.ui.alert("Parabéns, você finalizou o plano de leitura!");
    }
  }

  /////////// START, RESUME, OPEN AND CLOSE PLANS ////////////

  setPlan(plan?: Plan) {
    if(!plan) {
      this.currentPlan = undefined;
      this.pageIndex = 0;
      return;
    }

    this.currentPlan = plan;
    // Saved along with the plan's next progress update (or right away when
    // opened/resumed from the started list — see useStartedPlan()).
    plan.lastUsedAt = Date.now();
    this.sortStartedPlans();
    this.stoppedAt = this.planServ.stoppedAt(plan);
    // A plan fresh from fetchPlans() (start of a new plan) has no
    // daysRemaining yet — daysCompleted() falls back to 0 via `?? 0`,
    // which reads as "days - 0 = every day already completed". Set it
    // here so it's correct from the moment a plan is opened/started, not
    // just after the first goal/track completion runs updatePlan().
    this.currentPlan.daysRemaining = this.currentPlan.days + 1 - this.stoppedAt.day;
    if(this.stoppedAt) {
      this.currentDay = this.stoppedAt.day;
      this.curTrackIdx = this.stoppedAt.portionIdx;
    }

    this.scrollToTop();
  }

  private scrollToTop() {
    // Delay slightly so the plan header has rendered first.
    setTimeout(() => void this.content?.scrollToTop(300), 30);
  }

  async deletePlan(plan: Plan) {
    const modal = await this.modals.create({ component: ConfirmationDialog, cssClass: 'app-dialog' });
    await modal.present();
    const { data: result } = await modal.onDidDismiss<boolean>();
    if(result === true) {
      if (this.currentPlan?.id === plan.id) this.setPlan(undefined);
      await this.planServ.delete(plan.id);
      this._loadPlans();
    }
  }

  startPlan(plan: Plan) {
    plan.startedAt = new Date().toISOString();
    plan.status = "started";
    this.planServ.get(plan.id).then(res => {
      if(res && res.status !== "completed") {
        void this.ui.alert("Plano já iniciado. Caso queira recomeçá-lo, remova-o antes de adicionar novamente");
        return;
      } else {
        this.planServ.save(plan).then(_ => {
          // Move it from "available" to "started" now. Before the Ionic tabs
          // this happened as a side effect of the page being re-created on
          // every visit; a tab page stays alive, so the lists would stay
          // stale until a full reload.
          this._loadPlans();
          this.openPlan(plan, 1);
        });
        this.analytics.planStarted(plan.id);
      }
    });
    this.openPlan(plan);
    this.playGoal(plan.goals[0]);
  }

  openPlan(plan: Plan, day?: number) {
    this.setPlan(plan);
    if(day) {
      this.currentDay = day;
      this.curTrackIdx = 0;
    }

    this._goToStoppedAt(plan);
  }

  closePlan() {
    this.setPlan(undefined);
  }

  /** "Abrir" on a started plan: open it and remember it as the most recently used. */
  openStartedPlan(plan: Plan) {
    this.openPlan(plan);
    void this.planServ.save(plan);
  }

  resumePlan(plan: Plan) {
    this.setPlan(plan);
    void this.planServ.save(plan);
    this._goToStoppedAt(plan);
    this.play().then(_ => {});
  }

  /** Show the page of days that contains where the user stopped (or the day just opened). */
  private _goToStoppedAt(plan: Plan) {
    const day = this.currentDay || plan.stoppedAt?.day || 1;
    this.goToPage(Math.floor((Math.max(1, day) - 1) / this.pageSize));
  }
  //////////////////////////////////////////////////


  //////////////// PLAYING FUNCTIONS ////////////////////
  playGoal(goal: DailyGoal) {
    this.currentDay = goal.day;
    this.play().then(_ => {});
  }

  async prepareToPlay(): Promise<void> {
    if(!this.currentPlan) {
      console.error("Plans::prepareToPlay", "currentPlan is not set");
      void this.ui.alert("Erro");
      return;
    }
    this.tracks = await this.buildTracks(this.currentPlan, this.currentDay, PRELOAD_DAYS);
  }

  async play() {
    await this.prepareToPlay();
    const start = this.tracks[this.curTrackIdx] ?? this.tracks[0];
    if (!start) {
      console.error("Plans::play", "no tracks to play");
      return;
    }
    this.inAppBrowserWarning.armForNextPlay();
    await this.dlServ.download(start);
    // if we await here, next lines will only run once audio playback is completed.
    this.audioService.playPlaylist(this.tracks, this.curTrackIdx).then(_ => {});

    this.dlServ.downloadTracks(this.tracks).then(_ => {});

  }
  //////////////////////////////////////////////////////



  async buildTracks(plan: Plan, day: number, preloadDays: number = 0): Promise<Track[]> {
    if(!this.bibleData) return [];

    let tracks: Track[] = await this.bibleServ.genDailyPlanTracks(this.bibleData, plan, day);
    if(preloadDays > 0) {
      for(let i = 1; i <= preloadDays; i++) {
        if(day + i > plan.days) { // we have already preloaded the end of the plan
          break;
        } else {
          let preloaded = await this.bibleServ.genDailyPlanTracks(this.bibleData, plan, day + i);
          tracks = [...tracks, ...preloaded];
        }
      }

    }
    return tracks;
  }


  /** Most recently used first; plans never opened since this existed fall back to their last save/start. */
  private sortStartedPlans() {
    const lastUse = (p: Plan) =>
      p.lastUsedAt ?? p.updatedAt ?? (p.startedAt ? Date.parse(p.startedAt) || 0 : 0);
    this.startedPlans.sort((a, b) => lastUse(b) - lastUse(a));
  }

  private _loadPlans() {
    this.planServ.getAllCompletionCounts().then(counts => {
      this.completionCounts = counts;
      this.cdr.detectChanges();
    });

    this.planServ.getAll().then(plans => {
      this.availablePlans = [];
      this.startedPlans = [];
      this.completedPlans = [];
      if(plans) {
        for(let plan of plans) {
          if(plan.status == "started" || plan.status == "late") {
            if(!plan.stoppedAt) {
              plan.stoppedAt = this.planServ.stoppedAt(plan);
            }
            plan.daysRemaining = plan.days + 1 - plan.stoppedAt.day;
            this.startedPlans.push(plan);
          } else if(plan.status == "completed") {
            this.completedPlans.push(plan);
          }
        }
      }
      this.sortStartedPlans();
      this.planServ.fetchPlans().then(res => {
        res.push(SamplePlan);
        for(let plan of res) {
          // do not include to Available Plans the ones that are already started
          if(!this.startedPlans.find(item => item.id === plan.id)) {
            this.availablePlans.push(plan);
          }
        }
        this.cdr.detectChanges();
      });
    });
  }

}
