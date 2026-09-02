const JOURNEY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validClaimJourneyId(value: string | null | undefined): value is string {
  return typeof value === "string" && JOURNEY_ID_PATTERN.test(value);
}

export function resolveClaimJourneyId({
  pendingJourneyId,
  storedJourneyId,
  generate,
}: {
  pendingJourneyId?: string;
  storedJourneyId?: string | null;
  generate: () => string;
}): string {
  if (validClaimJourneyId(pendingJourneyId)) return pendingJourneyId;
  if (validClaimJourneyId(storedJourneyId)) return storedJourneyId;

  const generated = generate();
  if (!validClaimJourneyId(generated)) {
    throw new Error("Claim journey ID generators must return an opaque UUID.");
  }
  return generated;
}

export function claimJourneyStorageKey(profileSlug: string, authSessionId: string): string {
  return `vrdex:claim-journey:${authSessionId}:${profileSlug}`;
}
