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

  // helper variables
  daysRemaining?: number;
  stoppedAt?: {day: number, portionIdx: number};
}
