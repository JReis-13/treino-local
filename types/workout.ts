export type WorkoutId = "A" | "B";
export type SectionId = "warmup" | "strength";
export type SyncStatus = "notConfigured" | "pending" | "synced" | "conflict" | "failed";

export interface ExercisePrescription {
  sourceText: string;
  sets?: number;
  min: number;
  max?: number;
  unit: "reps" | "steps" | "seconds";
  perSide?: boolean;
}

export interface Exercise {
  id: string;
  name: string;
  section: SectionId;
  order: number;
  pairId?: string;
  prescription: ExercisePrescription;
  defaultLoad?: string;
  equipment?: string;
  videoUrl: string;
  note?: string;
}

export interface WorkoutPlan {
  id: WorkoutId;
  title: string;
  description: string;
  expectedMinutes: { min: number; max: number };
  warmupMinutes: number;
  betweenSetRestNote: string;
  rirByOccurrence: number[];
  exercises: Exercise[];
  planVersion: string;
}

export interface ExerciseSession {
  exerciseId: string;
  completed: boolean;
  actualLoad?: string;
}

export interface WorkoutSession {
  id: string;
  workoutId: WorkoutId;
  planVersion: string;
  status: "inProgress" | "completed";
  startedAt: string;
  completedAt?: string;
  localDate?: string;
  exercises: ExerciseSession[];
  syncStatus: SyncStatus;
  syncMessage?: string;
}

export interface ExcelConnectionInfo {
  filename: string;
  validation: "compatible" | "incompatible";
  validatedAt: string;
  lastSyncedAt?: string;
  mode: "direct" | "copy";
}

export interface AppData {
  schemaVersion: 1;
  sessions: WorkoutSession[];
  excel?: ExcelConnectionInfo;
}
