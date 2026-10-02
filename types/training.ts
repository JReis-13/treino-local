export type SourceKind = "builtin" | "excel" | "google";
export type SourceSyncStatus = "notApplicable" | "pending" | "synced" | "conflict" | "authRequired" | "sourceUnavailable" | "failed";

export interface ImportWarning {
  code: string;
  message: string;
  location: string;
  severity: "info" | "warning" | "syncBlocker" | "activationBlocker";
}

export interface CompletionMapping {
  sheetName: string;
  sheetId?: number;
  slots: string[];
  ordinalCells: string[];
}

export type TrainingSource =
  | { kind: "builtin"; label: string }
  | { kind: "excel"; filename: string; template: string; mappings: Record<string, CompletionMapping>; mode: "direct" | "copy" }
  | { kind: "google"; filename: string; template: string; mappings: Record<string, CompletionMapping>;
      connectorUrl?: string; mappingId?: string; sheetUrl?: string; lastRefreshedAt?: string; syncEnabled?: boolean;
      connectorVersion?: 1 | 2; sourceMode?: "bound" | "standalone"; spreadsheetId?: string;
      authMode?: "oauth"; sourceProof?: string; gid?: number;
      // Older Picker-based plans remain loadable but require a new connector to sync.
      fileId?: string; url?: string };

export interface ExerciseBlock {
  kind: "exercise";
  id: string;
  section: string;
  name: string;
  prescription: string;
  equipment?: string;
  defaultLoad?: string;
  videoUrl?: string;
  groupId?: string;
  note?: string;
  sourceCell?: string;
}

export interface InstructionBlock {
  kind: "instruction";
  id: string;
  section: string;
  heading: string;
  text: string;
  sourceCell?: string;
}

export type WorkoutBlock = ExerciseBlock | InstructionBlock;

export interface TrainingWorkout {
  id: string;
  title: string;
  description: string;
  duration?: string;
  restNote?: string;
  rirByOccurrence?: number[];
  blocks: WorkoutBlock[];
}

export interface LegacyCompletion {
  id: string;
  workoutId: string;
  date: string;
  sourceSlot: string;
  calories?: string;
}

export interface TrainingPlanRecord {
  id: string;
  name: string;
  source: TrainingSource;
  version: number;
  importedAt: string;
  updatedAt: string;
  sourceFingerprint?: string;
  workouts: TrainingWorkout[];
  importWarnings: ImportWarning[];
  legacyCompletions: LegacyCompletion[];
}

export interface BlockProgress {
  blockId: string;
  completed: boolean;
  actualLoad?: string;
}

export interface TrainingSession {
  id: string;
  planId: string;
  planVersion: number;
  workoutId: string;
  workoutSnapshot: TrainingWorkout;
  status: "inProgress" | "completed";
  startedAt: string;
  completedAt?: string;
  localDate?: string;
  blocks: BlockProgress[];
  syncStatus: SourceSyncStatus;
  syncMessage?: string;
}

export interface TrainingData {
  schemaVersion: 2;
  plans: TrainingPlanRecord[];
  activePlanId?: string;
  sessions: TrainingSession[];
  archivedSources?: Array<{ planId: string; planName: string; legacyCompletions: LegacyCompletion[] }>;
}

export interface ImportedTraining {
  name: string;
  source: TrainingSource;
  sourceFingerprint: string;
  workouts: TrainingWorkout[];
  warnings: ImportWarning[];
  legacyCompletions: LegacyCompletion[];
}
