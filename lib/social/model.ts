import { isLocalDate } from "@/lib/dates";

export const REACTIONS = ["💪", "🔥", "👏", "😂", "❤️"] as const;
export type ReactionEmoji = typeof REACTIONS[number];
export interface PublishActivity {
  clientSessionId: string;
  workoutName: string;
  completedAt: string;
  localDate: string;
  durationMinutes: number | null;
  completedExercises: number | null;
  totalExercises: number | null;
}
export interface SocialActivity {
  id: string;
  friendshipId?: string;
  displayName: string;
  workoutName: string;
  completedAt: string;
  localDate: string;
  durationMinutes: number | null;
  completedExercises: number | null;
  totalExercises: number | null;
  reactions: Partial<Record<ReactionEmoji, number>>;
  myReaction: ReactionEmoji | null;
}

export function validDisplayName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 50 && !/[\u0000-\u001f\u007f]/.test(value);
}
export function validEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
export function parsePublishActivity(value: unknown): PublishActivity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const optionalCount = (n: unknown) => n === null || (Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 500);
  if (typeof item.clientSessionId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(item.clientSessionId) ||
    typeof item.workoutName !== "string" || !item.workoutName.trim() || item.workoutName.length > 120 || /[\u0000-\u001f\u007f]/.test(item.workoutName) ||
    typeof item.localDate !== "string" || !isLocalDate(item.localDate) || typeof item.completedAt !== "string" ||
    !Number.isFinite(Date.parse(item.completedAt)) || !/^\d{4}-\d\d-\d\dT/.test(item.completedAt) ||
    !(item.durationMinutes === null || (Number.isInteger(item.durationMinutes) && (item.durationMinutes as number) >= 0 && (item.durationMinutes as number) <= 1440)) ||
    !optionalCount(item.completedExercises) || !optionalCount(item.totalExercises) ||
    (item.completedExercises !== null && item.totalExercises !== null && (item.completedExercises as number) > (item.totalExercises as number))) return null;
  return { clientSessionId: item.clientSessionId, workoutName: item.workoutName.trim(), completedAt: item.completedAt,
    localDate: item.localDate, durationMinutes: item.durationMinutes, completedExercises: item.completedExercises,
    totalExercises: item.totalExercises } as PublishActivity;
}

export function isReactionEmoji(value: unknown): value is ReactionEmoji {
  return REACTIONS.includes(value as ReactionEmoji);
}
