const JOURNEY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validClaimJourneyId(value: string | null | undefined): value is string {
  return typeof value === "string" && JOURNEY_ID_PATTERN.test(value);
}

export function claimJourneyForAction({
  currentJourneyId,
  pendingJourneyId,
  previousJourneyFinished,
  currentJourneySubmitted,
  generate,
}: {
  currentJourneyId: string;
  pendingJourneyId?: string;
  previousJourneyFinished: boolean;
  currentJourneySubmitted: boolean;
  generate: () => string;
}): string {
  if (validClaimJourneyId(pendingJourneyId)) return pendingJourneyId;
  if (!previousJourneyFinished && !currentJourneySubmitted) return currentJourneyId;

  const generated = generate();
  if (!validClaimJourneyId(generated)) {
    throw new Error("Claim journey ID generators must return an opaque UUID.");
  }
  return generated;
}
