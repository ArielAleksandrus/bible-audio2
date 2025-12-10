import { Injectable } from '@angular/core';
import { dbPromise } from '../storage/my-db';
import { Plan } from '../models/plan';

@Injectable({ providedIn: 'root' })
export class PlanService {

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

  // Salvar ou atualizar plano (usuário marcando capítulos)
  async save(plan: Plan): Promise<void> {
    const db = await dbPromise;
    await db.put('plans', plan);
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
