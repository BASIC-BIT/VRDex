import type { DatabaseReader } from "./_generated/server";
import { claimError } from "./_claimErrors";

/** Call inside the mutation that inserts the attempt, so index reads reserve
 * the value through Convex's transaction conflict detection. Historical rows
 * must be retained: an old code may still be posted on the provider profile.
 */
export async function allocateShortClaimCode(
  db: DatabaseReader,
  targetType: "vrchat_user" | "vrchat_group",
  targetExternalId: string,
  now: number,
): Promise<string> {
  const recent = await db.query("profileVerificationAttempts")
    .withIndex("by_targetType_targetExternalId_createdAt", (q) => q
      .eq("targetType", targetType).eq("targetExternalId", targetExternalId)
      .gt("createdAt", now - 86_400_000))
    .take(20);
  if (recent.length >= 20) throw claimError("PROOF_ISSUANCE_LIMIT");

  for (let draw = 0; draw < 32; draw++) {
    // These 32 random bits precede the UUID's fixed version/variant bits.
    // Rejection sampling avoids bias when mapping them to 100,000 values.
    const bits = Number.parseInt(crypto.randomUUID().slice(0, 8), 16);
    if (bits >= 4_294_900_000) continue;
    const code = `VRDEX${String(bits % 100_000).padStart(5, "0")}`;
    const used = await db.query("profileVerificationAttempts")
      .withIndex("by_targetType_targetExternalId_proofCode", (q) => q
        .eq("targetType", targetType).eq("targetExternalId", targetExternalId).eq("proofCode", code))
      .first();
    if (used === null) return code;
  }
  throw claimError("ADAPTER_UNAVAILABLE");
}
