const DEFAULT_EVENT_DURATION_MS = 60 * 60_000;

export function resolveAuthoredEventEndAt({
  startAt,
  derivedEndAt,
  previousStartAt,
  previousEndAt,
  scheduleChanged,
}: {
  startAt: number;
  derivedEndAt?: number;
  previousStartAt?: number;
  previousEndAt?: number;
  scheduleChanged: boolean;
}): number {
  if (!scheduleChanged && previousStartAt !== undefined && previousEndAt !== undefined) {
    return previousEndAt + (startAt - previousStartAt);
  }

  return derivedEndAt ?? startAt + DEFAULT_EVENT_DURATION_MS;
}
