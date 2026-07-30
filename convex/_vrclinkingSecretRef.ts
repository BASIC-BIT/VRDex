/**
 * The one secret reference a VRCLinking delegation for a guild resolves to.
 *
 * Derived everywhere rather than read back from the row. The reference is a
 * pure function of the guild id, so the stored string never carried
 * information — and a deployment upgraded from when the ARN form was accepted
 * still holds rows in that shape. Three places compare a reference against a
 * credential (selection, `recordCredentialUse`, and the final grant in
 * `recordVrchatProofVerification`); each one that read the stored value instead
 * rejected those rows, and rejecting at the *last* of the three is the worst
 * version — the provider call has already been made and the match already
 * found, and the claimant is told `unavailable`.
 */
export function vrclinkingSecretName(guildId: string): string {
  return `vrdex/vrclinking/${guildId}`;
}

export function vrclinkingSecretRef(guildId: string): string {
  return `secret://${vrclinkingSecretName(guildId)}`;
}
