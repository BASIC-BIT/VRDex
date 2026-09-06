import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  containsProofCode,
  isValidProofCode,
  normalizeProofText,
  proofSurfaceFields,
} from "./proof-matching.mjs";
import { RequestBudget } from "./runtime.mjs";
import { VrchatClient } from "./vrchat-client.mjs";

const CODE = "VRDEX-AB12CD34EF56";

it("the provider client reads the bound user or group and returns only a match", async () => {
  const paths = [];
  const client = new VrchatClient({
    authCookie: "fixture-cookie", userAgent: "VRDex-test/1",
    fetcher: async (url) => {
      const path = new URL(url).pathname;
      paths.push(path);
      return Response.json(path.includes("/groups/")
        ? { description: "VRDEX00001", bio: "VRDEX99999" }
        : { bio: "bio: vrdex19825.", description: "VRDEX99999" });
    },
  });
  assert.equal(await client.findProofCode("vrchat_user", "usr_fixture", "VRDEX19825"), true);
  assert.equal(await client.findProofCode("vrchat_group", "grp_fixture", "VRDEX00001"), true);
  assert.equal(await client.findProofCode("vrchat_user", "usr_fixture", "VRDEX99999"), false);
  assert.deepEqual(paths, ["/api/1/users/usr_fixture", "/api/1/groups/grp_fixture", "/api/1/users/usr_fixture"]);
});

describe("VRChat proof matching", () => {
  it("accepts ten-character codes without matching a longer token", () => {
    const short = "VRDEX19825";
    assert.equal(isValidProofCode(short), true);
    assert.equal(isValidProofCode("VRDEX00000"), true);
    for (const text of [short, "vrdex19825", `bio: ${short}.`, `🎵${short}🎵`]) {
      assert.equal(containsProofCode([text], short), true);
    }
    for (const text of ["VRDEX1982", "VRDEX198250", "xVRDEX19825", "éVRDEX19825", "VRDEX19825９", "VRDEX-19825", "VRDEX 19825", "VRDEX198 25", "VRDEX-19825ABCDEF", "VRDEX19825ABCDEF"]) {
      assert.equal(containsProofCode([text], short), false);
    }
  });
  it("finds the code despite surrounding text, case, and punctuation", () => {
    assert.equal(containsProofCode([`verifying: ${CODE}`], CODE), true);
    assert.equal(containsProofCode(["vrdex-ab12cd34ef56"], CODE), true);
    assert.equal(containsProofCode(["VRDEX‑AB12 CD34·EF56"], CODE), true);
    assert.equal(containsProofCode(["line one", `\n${CODE}\n`], CODE), true);
  });

  it("does not match a different or absent code", () => {
    assert.equal(containsProofCode(["VRDEX-ZZZZZZZZZZZZ"], CODE), false);
    assert.equal(containsProofCode(["no code here"], CODE), false);
    assert.equal(containsProofCode([], CODE), false);
    assert.equal(containsProofCode([undefined, null, 42], CODE), false);
  });

  it("refuses malformed codes so empty input cannot verify against any text", () => {
    assert.equal(isValidProofCode(""), false);
    assert.equal(isValidProofCode("VRDEX-"), false);
    assert.equal(isValidProofCode("NOTVRDEX-AB12CD34EF56"), false);
    // Without the guard, a normalized empty needle is a substring of everything.
    assert.equal(containsProofCode(["anything at all"], ""), false);
    assert.equal(containsProofCode(["anything at all"], "VRDEX-"), false);
  });

  it("does not match a truncated prefix of a longer issued code", () => {
    assert.equal(containsProofCode(["VRDEX-AB12"], CODE), false);
  });

  it("normalizes only to alphanumerics", () => {
    assert.equal(normalizeProofText("a-b_c 1!2"), "ABC12");
    assert.equal(normalizeProofText(undefined), "");
  });

  it("reads group descriptions and user bios from the right fields", () => {
    assert.deepEqual(proofSurfaceFields("vrchat_group"), ["description", "name"]);
    assert.deepEqual(proofSurfaceFields("vrchat_user"), ["bio", "statusDescription"]);
  });
});

// Proof reads run before telemetry because a proof expires in 24 hours and a
// deferred telemetry batch does not. That ordering only holds if it stays an
// ordering: with a backlog larger than one window, taking the whole budget
// would defer every integration indefinitely.
describe("request budget sharing", () => {
  it("leaves half the window after the proof share is spent", () => {
    const now = Date.now();
    const account = new RequestBudget(30);
    const proofs = new RequestBudget(Math.max(1, Math.floor(account.limit / 2)));

    for (let index = 0; index < 15; index += 1) {
      assert.equal(proofs.retryAfterMs(1, now), 0);
      account.tryConsume(1, now);
      proofs.tryConsume(1, now);
    }

    // Proofs are done for this window; telemetry still has the other half.
    assert.ok(proofs.retryAfterMs(1, now) > 0);
    assert.equal(account.remaining(now), 15);
  });
});
