export function resolveAuthoredEventEndAt({
  authoredEndAt,
  derivedEndAt,
  previousEndAt,
}: {
  startAt: number;
  authoredEndAt?: number | null;
  derivedEndAt?: number;
  previousStartAt?: number;
  previousEndAt?: number;
  scheduleChanged: boolean;
}): number | undefined {
  if (authoredEndAt !== undefined) return authoredEndAt ?? derivedEndAt;
  return previousEndAt ?? derivedEndAt;
}
