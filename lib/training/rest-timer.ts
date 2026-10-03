import type { RestTimer, TrainingData } from "@/types/training";

export function suggestedRest(note: string | undefined): { seconds: number; label: string } | undefined {
  if (!note || !/(?:intervalo|descanso|rest|entre\s+s[eé]ries)/i.test(note)) return undefined;
  const range = /(\d{1,2})\s*(?:a|até|to|[-–])\s*(\d{1,2})\s*(?:'|min(?:utos?)?\b)/i.exec(note);
  if (range) {
    const low = Number(range[1]); const high = Number(range[2]);
    if (low >= 1 && high >= low && high <= 10) return { seconds: high * 60, label: `${low}–${high} min suggested; starts at ${high} min` };
  }
  const exact = /(\d{1,2})\s*(?:'|min(?:utos?)?\b)/i.exec(note);
  const minutes = exact ? Number(exact[1]) : 0;
  return minutes >= 1 && minutes <= 10 ? { seconds: minutes * 60, label: `${minutes} min recommended` } : undefined;
}

export function remainingSeconds(timer: RestTimer, now = Date.now()): number {
  return timer.pausedRemainingSeconds ?? Math.max(0, Math.ceil((Date.parse(timer.targetEndAt!) - now) / 1000));
}

function activeSession(data: TrainingData, sessionId: string): boolean {
  return data.sessions.some((session) => session.id === sessionId && session.status === "inProgress");
}

export function startRest(data: TrainingData, sessionId: string, seconds: number, now = Date.now()): TrainingData {
  if (!activeSession(data, sessionId) || !Number.isInteger(seconds) || seconds < 1 || seconds > 3600)
    throw new Error("Rest timer cannot start for this workout.");
  return { ...data, restTimer: { sessionId, durationSeconds: seconds, targetEndAt: new Date(now + seconds * 1000).toISOString() } };
}

export function pauseRest(data: TrainingData, now = Date.now()): TrainingData {
  const timer = data.restTimer;
  if (!timer || timer.pausedRemainingSeconds !== undefined) return data;
  return { ...data, restTimer: { sessionId: timer.sessionId, durationSeconds: timer.durationSeconds,
    pausedRemainingSeconds: remainingSeconds(timer, now) } };
}

export function resumeRest(data: TrainingData, now = Date.now()): TrainingData {
  const timer = data.restTimer;
  if (!timer || timer.pausedRemainingSeconds === undefined) return data;
  return { ...data, restTimer: { sessionId: timer.sessionId, durationSeconds: timer.durationSeconds,
    targetEndAt: new Date(now + timer.pausedRemainingSeconds * 1000).toISOString() } };
}

export function extendRest(data: TrainingData, seconds: number, now = Date.now()): TrainingData {
  const timer = data.restTimer;
  if (!timer || ![30, 60].includes(seconds)) return data;
  const remaining = Math.min(3600, remainingSeconds(timer, now) + seconds);
  return { ...data, restTimer: timer.pausedRemainingSeconds !== undefined
    ? { ...timer, pausedRemainingSeconds: remaining }
    : { ...timer, targetEndAt: new Date(now + remaining * 1000).toISOString() } };
}

export function skipRest(data: TrainingData): TrainingData { return { ...data, restTimer: undefined }; }
