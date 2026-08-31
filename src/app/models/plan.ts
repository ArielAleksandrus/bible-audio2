export interface ReadingPortion {
  bookIdx: number;
  chapter: number;
  completed?: boolean;
}
export interface DailyGoal {
  title?: string;
  day: number;
  portions: ReadingPortion[];
  completed?: boolean;
}
export interface Plan {
  id: string;
  title: string;
  author?: string;
  description?: string;
  days: number; // redundant to goals.length
  goals: DailyGoal[];
  startedAt?: string;
  status?: "not started"|"started"|"late"|"completed";
  // Bumped on every local save; used to resolve conflicts when merging
  // this plan's progress against another device's copy during cloud sync.
  updatedAt?: number;

  // helper variables
  daysRemaining?: number;
  stoppedAt?: {day: number, portionIdx: number};
}
