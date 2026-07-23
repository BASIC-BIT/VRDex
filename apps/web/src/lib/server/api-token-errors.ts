export function temporalTokenScopeEligibilityProblem(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  if (message.includes("verified_email_required")) {
    return {
      title: "Verified email required",
      detail: "Verify the account email before creating a token with the time:parse scope.",
    };
  }

  if (message.includes("temporal_beta_required")) {
    return {
      title: "Temporal beta access required",
      detail: "An active temporal parsing beta grant is required for the time:parse scope.",
    };
  }

  return null;
}
