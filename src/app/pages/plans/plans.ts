import { Component, ChangeDetectorRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateService, TranslateModule } from '@ngx-translate/core';

import { AudioDownloaderService } from '../../services/audio-downloader.service';
import { AudioService } from '../../services/audio.service';
import { BibleService } from '../../services/bible.service';
import { PlanService } from '../../services/plan.service';

import { Plan, DailyGoal } from '../../models/plan';
import { Track } from '../../models/track';
import { SamplePlan } from '../../data/my-plans';

import { Bible } from 'bible-picker';

import { MatIconModule } from '@angular/material/icon';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatPaginatorModule, MatPaginator } from '@angular/material/paginator';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';

import { MatDialog } from '@angular/material/dialog';
import { ConfirmationDialog } from '../../confirmation-dialog/confirmation-dialog';


const PRELOAD_DAYS = 7;

@Component({
  selector: 'app-plans',
  imports: [CommonModule,
    MatIconModule,
    MatTableModule,
    MatPaginatorModule,
    MatButtonModule,
    MatTooltipModule,
    TranslateModule],
  templateUrl: './plans.html',
  styleUrl: './plans.scss',
})
export class Plans {
  availablePlans: Plan[] = [];
  startedPlans: Plan[] = [];
  completedPlans: Plan[] = [];

  currentPlan?: Plan;
  currentDay: number = 1;
  stoppedAt: {day: number, portionIdx: number} = {day: 0, portionIdx: 0};

  bibleData?: Bible;

  tracks: Track[] = [];
  curTrackIdx: number = 0;

  dataSource = new MatTableDataSource<DailyGoal>([]);
  displayedColumns: string[] = ['title', 'portions', 'actions'];
  @ViewChild(MatPaginator, { static: false }) set paginator(p: MatPaginator) {
    this.dataSource.paginator = p; // seta automaticamente quando aparecer
  }

  constructor(private planServ: PlanService,
    private dlServ: AudioDownloaderService,
    private bibleServ: BibleService,
    private audioService: AudioService,
    private cdr: ChangeDetectorRef,
    private dialog: MatDialog,
    private translate: TranslateService
  ) {

    if(!localStorage.getItem("selectedBible")) {
      location.href = "/home";
      return;
    }

    let selected = localStorage.getItem("selectedBible") || "";
    this.bibleServ.loadBibleVersion(selected.split("-")[0], selected.split("-")[1]).then(res => {
      if(res) {
        this.bibleData = res;
        const savedLang = this.bibleData.language;
        if(savedLang) {
          this.translate.use(savedLang);
        }
      } else {
        location.href = "/home";
      }
    });

  }

  ngOnInit() {
    this._loadPlans();


    this.audioService.trackEnded$.subscribe(finishedTrack => {
      if(finishedTrack) {
        this.setTrackCompleted(finishedTrack, true);
      }
    })
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

    if(completed)
      alert("Parabéns, você finalizou o plano de leitura!");
  }

  /////////// START, RESUME, OPEN AND CLOSE PLANS ////////////

  setPlan(plan?: Plan) {
    if(!plan) {
      this.currentPlan = undefined;
      this.dataSource.data = [];
      return;
    }

    this.currentPlan = plan;
    this.dataSource.data = this.currentPlan.goals;
    this.stoppedAt = this.planServ.stoppedAt(plan);
    if(this.stoppedAt) {
      this.currentDay = this.stoppedAt.day;
      this.curTrackIdx = this.stoppedAt.portionIdx;
    }

    // Delay slightly to ensure content has loaded
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 30);
  }

  deletePlan(plan: Plan) {
    const dialogRef = this.dialog.open(ConfirmationDialog, {
      width: '380 px',
      maxWidth: '90vw',
      autoFocus: false,
      disableClose: false,
      panelClass: 'hold-confirm-dialog-panel'
    });

    dialogRef.afterClosed().subscribe(result => {
      if(result === true) {
        this.planServ.delete(plan.id).then(_ => {
          this._loadPlans();
        });
      }
    });
  }

  startPlan(plan: Plan) {
    plan.startedAt = new Date().toISOString();
    plan.status = "started";
    this.planServ.get(plan.id).then(res => {
      if(res) {
        alert("Plano já iniciado. Caso queira recomeçá-lo, remova-o antes de adicionar novamente");
        return;
      } else {
        this.planServ.save(plan).then(_ => {
          this.openPlan(plan, 1);
        });
      }
    });
    this.openPlan(plan);
    this.playGoal(plan.goals[0]);
    // Delay slightly to ensure content has loaded
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 30);
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

  resumePlan(plan: Plan) {
    this.setPlan(plan);
    this._goToStoppedAt(plan);
    this.play().then(_ => {});
  }

  private _goToStoppedAt(plan: Plan) {
    setTimeout(() => {
      if(this.dataSource && this.dataSource.paginator) {
        let paginator = this.dataSource.paginator;
        let d = plan.stoppedAt?.day || 1;
        paginator.pageIndex = Math.floor(d / paginator.pageSize);
        paginator.page.next({
          pageIndex: paginator.pageIndex,
          pageSize: paginator.pageSize,
          length: paginator.length
        });
      }
    }, 100);
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
      alert("Erro");
      return;
    }
    this.tracks = await this.buildTracks(this.currentPlan, this.currentDay, PRELOAD_DAYS);
  }

  async play() {
    await this.prepareToPlay();
    await this.dlServ.download(this.tracks[0]);
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


  private _loadPlans() {
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
