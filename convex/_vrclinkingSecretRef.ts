/**
 * The one secret reference a VRCLinking delegation for a guild resolves to.
 *
 * Derived everywhere rather than read back from the row. The reference is a
 * pure function of the guild id, so the stored string never carried
 * information — and a deployment upgraded from when the ARN form was accepted
 * still holds rows in that shape.
 *
 * Four places compare a reference against a credential, and each one that read
 * the stored value instead silently dropped those rows at a different point:
 *
 * | Site | What reading the stored value cost |
 * | --- | --- |
 * | `reserveAdapterDelegations` | the delegation was never sent to the adapter |
 * | `recordCredentialConsultations` | the audit said "Not used yet" for a key being queried on every claim |
 * | `recordCredentialUse` | the match was found and then not attributed |
 * | `recordVrchatProofVerification` | the claim was rejected `unavailable` after verifying |
 *
 * They were found one at a time, in that order, each after the previous was
 * called fixed. Derive here rather than adding a fifth.
 */
export function vrclinkingSecretName(guildId: string): string {
  return `vrdex/vrclinking/${guildId}`;
}

export function vrclinkingSecretRef(guildId: string): string {
  return `secret://${vrclinkingSecretName(guildId)}`;
}
