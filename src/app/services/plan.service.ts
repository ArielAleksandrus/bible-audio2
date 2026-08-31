import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { dbPromise } from '../storage/my-db';
import { Plan } from '../models/plan';
import { HttpClient } from '@angular/common/http';

const AVAILABLE_PLANS = ['first-steps', 'new-testament', 'christmas', 'easter'];

@Injectable({ providedIn: 'root' })
export class PlanService {
  // SyncService listens on these to mirror local writes to Firestore,
  // without PlanService needing to know sync exists (avoids a DI cycle,
  // since SyncService itself depends on PlanService for local reads/writes).
  planSaved$ = new Subject<Plan>();
  planDeleted$ = new Subject<string>();
  completionCountChanged$ = new Subject<{ planId: string; count: number }>();

  constructor(private http: HttpClient) {}

  async fetchPlans(): Promise<Plan[]> {
    let res: Plan[] = [];
    for(let str of AVAILABLE_PLANS) {
      const url = `/assets/plans/${str}.json`;
      try {
        const plan = await this.http.get<Plan>(url).toPromise();
        if(plan) res.push(plan);
      } catch(error) {
        console.error("PlanService::fetchPlans -> Erro ao carregar plano " + str, error);
      }
    }
    return res;
  }

  stoppedAt(plan: Plan): {day: number, portionIdx: number} {
    let res = {day: -1, portionIdx: 0};
    for(let i = 0; i < plan.goals.length; i++) {
      let goal = plan.goals[i];

      if(goal.completed)
        continue;
      else {
        res.day = i + 1;
      }

      for(let j = 0; j < goal.portions.length; j++) {
        let portion = goal.portions[j];
        if(portion.completed)
          continue;
        else {
          res.portionIdx = j;
          return res;
        }
      }
    }
    return res;
  }

  // How many portions have been marked completed — used as the source of
  // truth when merging two devices' copies of the same plan, since it's
  // immune to clock skew (unlike comparing save timestamps).
  progressScore(plan: Plan): number {
    let score = 0;
    for(const goal of plan.goals)
      for(const portion of goal.portions)
        if(portion.completed) score++;
    return score;
  }

  // Salvar ou atualizar plano (usuário marcando capítulos)
  async save(plan: Plan): Promise<void> {
    plan.updatedAt = Date.now();
    const db = await dbPromise;
    await db.put('plans', plan);
    this.planSaved$.next(plan);
  }

  // Carregar um plano específico
  async get(id: string): Promise<Plan | undefined> {
    const db = await dbPromise;
    return db.get('plans', id);
  }

  // Listar todos os planos salvos
  async getAll(): Promise<Plan[]> {
    const db = await dbPromise;
    return db.getAll('plans');
  }

  // Deletar plano
  async delete(id: string): Promise<void> {
    const db = await dbPromise;
    await db.delete('plans', id);
    this.planDeleted$.next(id);
  }

  // Quantas vezes o usuário já terminou este plano (persistido separadamente
  // do progresso, já que o progresso é resetado a cada reinício).
  async incrementCompletionCount(planId: string): Promise<number> {
    const count = (await this.getCompletionCount(planId)) + 1;
    await this.setCompletionCount(planId, count);
    return count;
  }

  async getCompletionCount(planId: string): Promise<number> {
    const db = await dbPromise;
    const existing = await db.get('plan_completions', planId);
    return existing?.count || 0;
  }

  // Sets the count directly (used by the increment above, and by
  // SyncService when reconciling with a remote count during merge).
  async setCompletionCount(planId: string, count: number): Promise<void> {
    const db = await dbPromise;
    await db.put('plan_completions', { id: planId, count });
    this.completionCountChanged$.next({ planId, count });
  }

  async getAllCompletionCounts(): Promise<Record<string, number>> {
    const db = await dbPromise;
    const all = await db.getAll('plan_completions');
    const map: Record<string, number> = {};
    for(const rec of all) map[rec.id] = rec.count;
    return map;
  }

  // Baixar plano novo da internet e salvar automaticamente
  async importFromUrl(url: string): Promise<Plan> {
    const response = await fetch(url);
    const plan: Plan = await response.json();

    // garante que não tem dados de progresso antigo
    plan.goals.forEach(goal => {
      goal.completed = false;
      goal.portions.forEach(p => p.completed = false);
    });
    plan.status = 'not started';
    plan.startedAt = new Date().toISOString();

    await this.save(plan);
    return plan;
  }
}
