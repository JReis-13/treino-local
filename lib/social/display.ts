/** Zero may be a sub-minute workout or an old missing-duration placeholder; do not present it as a measured 0 min. */
export function sharedDurationLabel(minutes: number | null): string | null {
  return minutes !== null && Number.isInteger(minutes) && minutes > 0 ? `${minutes} min` : null;
}
