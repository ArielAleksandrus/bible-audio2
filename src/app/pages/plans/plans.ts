import { Component, ChangeDetectorRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

import { AudioDownloaderService } from '../../services/audio-downloader.service';
import { AudioService } from '../../services/audio.service';
import { BibleService } from '../../services/bible.service';
import { PlanService } from '../../services/plan.service';

import { Plan, DailyGoal } from '../../models/plan';
import { Track } from '../../models/track';
import { SamplePlan } from '../../data/my-plans';

import { Bible, BibleARA, BibleKJV } from 'bible-picker';

import { MatIconModule } from '@angular/material/icon';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatPaginatorModule, MatPaginator } from '@angular/material/paginator';

const PRELOAD_DAYS = 10;

@Component({
  selector: 'app-plans',
  imports: [CommonModule,
    MatIconModule,
    MatTableModule,
    MatPaginatorModule],
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

  bibleData = BibleARA;

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
    private cdr: ChangeDetectorRef) {

  }

  ngOnInit() {
    this._loadPlans();
    if(localStorage.getItem("bible-version") == "kjv") {
      this.bibleData = BibleKJV;
    }

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
    if(!this.currentPlan)
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

  }

  openPlan(plan: Plan, day?: number) {
    this.setPlan(plan);
    if(day) {
      this.currentDay = day;
      this.curTrackIdx = 0;
    }
  }

  closePlan() {
    this.setPlan(undefined);
  }

  resumePlan(plan: Plan) {
    this.setPlan(plan);
    this.play().then(_ => {});
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
    let tracks: Track[] = await this.bibleServ.genDailyPlanTracks(this.bibleData, plan, day);
    if(preloadDays > 0) {
      for(let i = 1; i <= preloadDays; i++) {
        if(day + preloadDays > plan.days) { // we have already preloaded the end of the plan
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
    // we'll use this sample plan for now, for testing purposes
    this.availablePlans = [SamplePlan];

    this.planServ.getAll().then(plans => {
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
      this.cdr.detectChanges();
    });
  }
}
