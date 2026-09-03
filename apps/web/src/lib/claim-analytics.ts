const JOURNEY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validClaimJourneyId(value: string | null | undefined): value is string {
  return typeof value === "string" && JOURNEY_ID_PATTERN.test(value);
}

export function claimJourneyForAction({
  currentJourneyId,
  pendingJourneyId,
  previousJourneyFinished,
  currentJourneySubmitted,
  reservedJourneyId,
}: {
  currentJourneyId: string;
  pendingJourneyId?: string;
  previousJourneyFinished: boolean;
  currentJourneySubmitted: boolean;
  reservedJourneyId: string;
}): string {
  if (!previousJourneyFinished && validClaimJourneyId(pendingJourneyId)) return pendingJourneyId;
  if (!previousJourneyFinished && !currentJourneySubmitted) return currentJourneyId;

  if (!validClaimJourneyId(reservedJourneyId)) {
    throw new Error("Reserved claim journey IDs must be opaque UUIDs.");
  }
  return reservedJourneyId;
}
