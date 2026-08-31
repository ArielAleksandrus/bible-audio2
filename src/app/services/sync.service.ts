import { Injectable } from '@angular/core';
import type { Firestore } from 'firebase/firestore';
import { Subject } from 'rxjs';

import { firebaseEnabled, getFirestoreDb } from '../storage/firebase';
import { AuthService } from './auth.service';
import { PlanService } from './plan.service';
import { Plan } from '../models/plan';

// Mirrors plan progress + completion counts to Firestore (when signed in) so
// they follow the user across devices. Firestore's own offline cache means
// writes made offline queue automatically and sync once back online.
//
// Merge policy on sign-in: per plan, whichever side has completed more
// portions wins (progressScore) — immune to clock skew, unlike comparing
// save timestamps, so a device that was offline for weeks making genuine
// progress never gets clobbered by a less-advanced device that happened to
// sync more recently. Completion counts only ever increase, so those take
// max(local, remote) — also never loses progress.
@Injectable({ providedIn: 'root' })
export class SyncService {
  readonly enabled = firebaseEnabled;

  // Emits whenever a remote pull merges new data into local storage, so
  // pages showing plans know to reload.
  syncCompleted$ = new Subject<void>();

  private fsModule: Promise<typeof import('firebase/firestore')> | null = null;

  constructor(private authServ: AuthService, private planServ: PlanService) {
    if (!this.enabled) return;

    this.authServ.user$.subscribe(user => {
      if (user) this.pullAndMerge(user.uid).catch(err => console.warn('SyncService: merge failed', err));
    });

    // Mirror local writes to Firestore as they happen (no-ops while signed out).
    this.planServ.planSaved$.subscribe(plan => void this.pushPlan(plan));
    this.planServ.planDeleted$.subscribe(id => void this.deletePlan(id));
    this.planServ.completionCountChanged$.subscribe(({ planId, count }) => void this.pushCompletionCount(planId, count));
  }

  private getFsModule() {
    if (!this.fsModule) this.fsModule = import('firebase/firestore');
    return this.fsModule;
  }

  private getDb(): Promise<Firestore> {
    return getFirestoreDb();
  }

  private async pushPlan(plan: Plan): Promise<void> {
    const uid = this.authServ.currentUser?.uid;
    if (!uid) return;
    try {
      const [db, { doc, setDoc }] = await Promise.all([this.getDb(), this.getFsModule()]);
      await setDoc(doc(db, 'users', uid, 'plans', plan.id), this.sanitize(plan));
    } catch (err) {
      console.warn('SyncService: failed to push plan', plan.id, err);
    }
  }

  private async deletePlan(planId: string): Promise<void> {
    const uid = this.authServ.currentUser?.uid;
    if (!uid) return;
    try {
      const [db, { doc, deleteDoc }] = await Promise.all([this.getDb(), this.getFsModule()]);
      await deleteDoc(doc(db, 'users', uid, 'plans', planId));
    } catch (err) {
      console.warn('SyncService: failed to delete remote plan', planId, err);
    }
  }

  private async pushCompletionCount(planId: string, count: number): Promise<void> {
    const uid = this.authServ.currentUser?.uid;
    if (!uid) return;
    try {
      const [db, { doc, setDoc }] = await Promise.all([this.getDb(), this.getFsModule()]);
      await setDoc(doc(db, 'users', uid, 'planCompletions', planId), { count });
    } catch (err) {
      console.warn('SyncService: failed to push completion count', planId, err);
    }
  }

  private async pullAndMerge(uid: string): Promise<void> {
    const [db, { collection, getDocs }] = await Promise.all([this.getDb(), this.getFsModule()]);

    const [remotePlanDocs, localPlans] = await Promise.all([
      getDocs(collection(db, 'users', uid, 'plans')),
      this.planServ.getAll()
    ]);

    const localById = new Map(localPlans.map(p => [p.id, p]));
    const remoteById = new Map(remotePlanDocs.docs.map(d => [d.id, d.data() as Plan]));
    const allIds = new Set([...localById.keys(), ...remoteById.keys()]);

    for (const id of allIds) {
      const local = localById.get(id);
      const remote = remoteById.get(id);

      if (local && remote) {
        const winner = this.pickMoreAdvanced(local, remote);
        // Always re-save/re-push so both sides converge, even if the
        // winner happened to already be local (idempotent otherwise).
        await this.planServ.save(winner);
        await this.pushPlan(winner);
      } else if (remote) {
        await this.planServ.save(remote);
      } else if (local) {
        await this.pushPlan(local);
      }
    }

    const [remoteCountDocs, localCounts] = await Promise.all([
      getDocs(collection(db, 'users', uid, 'planCompletions')),
      this.planServ.getAllCompletionCounts()
    ]);

    const remoteCounts: Record<string, number> = {};
    for (const d of remoteCountDocs.docs) remoteCounts[d.id] = (d.data() as { count: number }).count || 0;

    const allCountIds = new Set([...Object.keys(localCounts), ...Object.keys(remoteCounts)]);
    for (const id of allCountIds) {
      const max = Math.max(localCounts[id] || 0, remoteCounts[id] || 0);
      if (max !== (localCounts[id] || 0)) await this.planServ.setCompletionCount(id, max);
      if (max !== (remoteCounts[id] || 0)) await this.pushCompletionCount(id, max);
    }

    this.syncCompleted$.next();
  }

  private pickMoreAdvanced(local: Plan, remote: Plan): Plan {
    const localScore = this.planServ.progressScore(local);
    const remoteScore = this.planServ.progressScore(remote);
    if (localScore !== remoteScore) return localScore > remoteScore ? local : remote;
    // Tie (including both untouched) — fall back to whichever was touched more recently.
    return (remote.updatedAt || 0) > (local.updatedAt || 0) ? remote : local;
  }

  private sanitize<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
  }
}
