export function resolveAuthoredEventEndAt({
  startAt,
  authoredEndAt,
  derivedEndAt,
  previousStartAt,
  previousEndAt,
  scheduleChanged,
}: {
  startAt: number;
  authoredEndAt?: number | null;
  derivedEndAt?: number;
  previousStartAt?: number;
  previousEndAt?: number;
  scheduleChanged: boolean;
}): number | undefined {
  if (authoredEndAt !== undefined) return authoredEndAt ?? derivedEndAt;
  if (!scheduleChanged && previousStartAt !== undefined && previousEndAt !== undefined) {
    return previousEndAt + (startAt - previousStartAt);
  }

  return derivedEndAt;
}
