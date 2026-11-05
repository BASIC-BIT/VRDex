export type LayoutShift = { at: number; value: number; recentInput: boolean };

/** Maximum CLS session sum for chronologically collected layout shifts. */
export function calculateSessionCls(shifts: readonly LayoutShift[]): number {
  let maximum = 0;
  let sessionValue = 0;
  let sessionStart = 0;
  let previousShiftAt: number | undefined;
  for (const shift of shifts) {
    if (shift.recentInput) continue;
    if (previousShiftAt !== undefined && shift.at - previousShiftAt < 1000 && shift.at - sessionStart < 5000) {
      sessionValue += shift.value;
    } else {
      sessionValue = shift.value;
      sessionStart = shift.at;
    }
    previousShiftAt = shift.at;
    maximum = Math.max(maximum, sessionValue);
  }
  return maximum;
}
