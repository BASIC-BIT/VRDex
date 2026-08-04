/**
 * The one secret reference a VRCLinking delegation resolves to.
 *
 * Scoped to the credential row, not to the guild. A guild-scoped name is a name
 * with no version, and three separate things went wrong because of it:
 *
 * | Guild-scoped | What it cost |
 * | --- | --- |
 * | replacing a key | the new value landed under the old row's identical reference, so a registration that failed after the write left the previous delegation answering with a key nobody had registered |
 * | one guild delegated by two profiles | replacing either one overwrote the single shared secret, and the other row stayed active pointing at a key it never authorized |
 * | `vrdex/vrclinking/shared` | the adapter's own bearer token and capability key sit under the same prefix, so a grant wide enough to write delegations was wide enough to replace them |
 *
 * A per-credential name gives each row its own object: a replacement writes a
 * new name, so nothing existing is destroyed until the new row is activated,
 * and no two rows can name the same secret. The trailing segment also puts
 * every delegation two path segments deep, which `shared` is not — that is what
 * lets the IAM grant exclude it by shape rather than by an exception list.
 *
 * Derived everywhere rather than read back from the row. The reference is a
 * pure function of the row, so the stored string never carried information —
 * and a deployment upgraded from when the ARN form was accepted still holds
 * rows in that shape.
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
export function vrclinkingSecretName(guildId: string, credentialId: string): string {
  return `vrdex/vrclinking/${guildId}/${credentialId}`;
}

export function vrclinkingSecretRef(guildId: string, credentialId: string): string {
  return `secret://${vrclinkingSecretName(guildId, credentialId)}`;
}

/**
 * The name a delegation registered before per-credential naming still uses.
 *
 * Its key sits under the guild-only name and nothing copies it, so emitting the
 * per-credential reference for such a row points every adapter — old or new — at
 * an object that does not exist, taking a working delegation offline.
 */
export function vrclinkingLegacySecretRef(guildId: string): string {
  return `secret://vrdex/vrclinking/${guildId}`;
}

/**
 * The reference a row's key actually lives under.
 *
 * Derived and *compared*, never read through. A row whose stored reference
 * matches its own per-credential derivation was written by `reserveCredential`
 * and is current; anything else predates it and keeps the guild-only name.
 *
 * This is not the pattern the table above warns against. That bug was emitting
 * the stored string verbatim, which silently dropped rows written in the retired
 * ARN shape. Here the stored value only chooses between two derivations, and
 * neither is ever the string itself.
 */
export function vrclinkingSecretRefForRow(row: {
  _id: string;
  guildId: string;
  secretRef: string;
}): string {
  const current = vrclinkingSecretRef(row.guildId, row._id);

  return row.secretRef === current ? current : vrclinkingLegacySecretRef(row.guildId);
}
