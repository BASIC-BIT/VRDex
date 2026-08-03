import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function adapterError(message: string, status = 403) {
  return NextResponse.json({ error: message }, { status });
}

function requireAdapterRequest(request: NextRequest) {
  const expectedToken = process.env.VRCHAT_PROOF_ADAPTER_BEARER_TOKEN?.trim();
  const productionBlocked = process.env.VERCEL_ENV === "production" && process.env.VRDEX_ALLOW_PRODUCTION_E2E_HELPERS !== "true";
  const authorization = request.headers.get("authorization") ?? "";

  return (
    !productionBlocked &&
    process.env.VRDEX_ENABLE_E2E_HELPERS === "true" &&
    process.env.VRDEX_ENABLE_E2E_ADAPTER_HELPERS === "true" &&
    Boolean(expectedToken) &&
    authorization === `Bearer ${expectedToken}`
  );
}

export async function POST(request: NextRequest) {
  if (!requireAdapterRequest(request)) {
    return adapterError("E2E proof adapter is not enabled for this request.");
  }

  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== "object") {
    return adapterError("Invalid JSON body.", 400);
  }

  const body = rawBody as Record<string, unknown>;
  const targetType = String(body.targetType ?? "");
  const targetExternalId = String(body.targetExternalId ?? "");
  const proofCode = String(body.proofCode ?? "");
  const recognizedTarget =
    targetExternalId.startsWith("e2e-") ||
    targetExternalId.startsWith("usr_e2e") ||
    targetExternalId.startsWith("grp_e2e");

  // VRCLinking asks a different question. There is no proof code to look for —
  // the answer comes from a delegated credential — and the control plane
  // requires the match to name which delegation produced it, re-checking that
  // row before it grants. Held to the proof-code shape, this stub could only
  // ever answer "not verified", so the hosted lane exercised the entry point
  // and never the grant.
  if (targetType === "vrclinking") {
    const delegations = Array.isArray(body.delegations) ? body.delegations : [];
    const verified = recognizedTarget && delegations.length > 0;
    const consultedDelegationIndexes = delegations.map((_, index) => index);

    return NextResponse.json({
      verified,
      evidenceSource: "vrclinking",
      evidenceSummary: verified
        ? `E2E adapter reports a verified VRCLinking link for ${targetExternalId}.`
        : `E2E adapter reports no verified VRCLinking link for ${targetExternalId}.`,
      consultedDelegationIndexes,
      ...(verified
        ? {
            matchedDelegationIndex: 0,
            matchedGuildId: String(
              (delegations[0] as Record<string, unknown> | undefined)?.guildId ?? "",
            ),
          }
        : {}),
    });
  }

  const verified = recognizedTarget && proofCode.startsWith("VRDEX-");

  return NextResponse.json({
    verified,
    evidenceSource: "vrchat_api",
    evidenceSummary: verified
      ? `E2E adapter found proof code ${proofCode} for ${targetType} ${targetExternalId}.`
      : `E2E adapter did not find proof code for ${targetType} ${targetExternalId}.`,
  });
}
