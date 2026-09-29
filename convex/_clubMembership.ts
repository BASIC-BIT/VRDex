export const DAY_MS = 86_400_000;
// Primary adapter evidence: Scarlet's net/sybyline/scarlet/GroupAuditType.java.
// A ban or an instance kick is not a group departure.
export function membershipMovement(type: string): "join" | "departure" | null {
  if (type === "group.member.join") return "join";
  if (type === "group.member.leave" || type === "group.member.remove")
    return "departure";
  return null;
}
export type Interval = { startAt: number; endAt: number };
export function checkedMembershipRange(
  startAt: number,
  endAt: number,
  maxMs: number,
) {
  if (
    !Number.isSafeInteger(startAt) ||
    !Number.isSafeInteger(endAt) ||
    startAt < 0 ||
    endAt <= startAt ||
    endAt - startAt > maxMs
  )
    throw new Error("Invalid membership range.");
}
export function mergeCoverage(intervals: Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const interval of [...intervals].sort((a, b) => a.startAt - b.startAt)) {
    const last = result[result.length - 1];
    if (last && interval.startAt <= last.endAt)
      last.endAt = Math.max(last.endAt, interval.endAt);
    else result.push({ ...interval });
  }
  if (result.length > 256)
    throw new Error("Too many fragmented coverage intervals.");
  return result;
}
