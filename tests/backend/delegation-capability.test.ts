import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import { capabilityPayload, signDelegation } from "../../convex/_delegationCapability";

const KEY = "test-capability-key";
const GUILD_ID = "123456789012345671";
const SECRET_REF = `secret://vrdex/vrclinking/${GUILD_ID}`;

describe("delegation capability", () => {
  // The adapter recomputes this with `node:crypto` and rejects the delegation
  // on any mismatch, so the two sides drifting is a silent outage: every
  // verification would answer unavailable. Pinning the exact bytes is the point
  // of this test — `verifyCapability` in `workers/vrclinking-adapter` must keep
  // producing the same digest.
  it("signs the guild, reference, and expiry the adapter verifies", async () => {
    process.env.VRCLINKING_ADAPTER_CAPABILITY_KEY = KEY;

    const now = Date.UTC(2026, 0, 1);
    const { expiresAt, capability } = await signDelegation(GUILD_ID, SECRET_REF, now);

    assert.ok(expiresAt > now, "capability must expire in the future");
    assert.equal(
      capability,
      createHmac("sha256", KEY)
        .update(`${GUILD_ID}\n${SECRET_REF}\n${expiresAt}`)
        .digest("hex"),
    );
    assert.equal(capabilityPayload(GUILD_ID, SECRET_REF, expiresAt), `${GUILD_ID}\n${SECRET_REF}\n${expiresAt}`);
  });

  // A signer that silently no-ops without its key would ship an adapter
  // accepting unsigned delegations, which is the state the capability exists to
  // prevent.
  it("refuses to sign without a configured key", async () => {
    delete process.env.VRCLINKING_ADAPTER_CAPABILITY_KEY;

    await assert.rejects(
      signDelegation(GUILD_ID, SECRET_REF),
      /VRCLINKING_ADAPTER_CAPABILITY_KEY/,
    );
  });
});
