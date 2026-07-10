import type { Id } from "./_generated/dataModel";

const transactionHashPattern = /^[0-9a-f]{64}$/;

export type OAuthConsentTransactionRecord = {
  _id: Id<"oauthConsentTransactions">;
  userId: Id<"users">;
  expiresAt: number;
};

export function normalizeOAuthConsentTransactionHash(value: string) {
  const transactionHash = value.trim();

  if (!transactionHashPattern.test(transactionHash)) {
    throw new Error("OAuth consent transaction hash must be a 64-character lowercase hex digest.");
  }

  return transactionHash;
}

export function oauthConsentTransactionDisposition(
  transaction: OAuthConsentTransactionRecord | null,
  userId: Id<"users">,
  now = Date.now(),
) {
  if (transaction === null) {
    return "missing" as const;
  }

  if (transaction.userId !== userId) {
    return "cross_user" as const;
  }

  if (transaction.expiresAt <= now) {
    return "expired" as const;
  }

  return "accepted" as const;
}
