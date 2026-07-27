import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  containsProofCode,
  isValidProofCode,
  normalizeProofText,
  proofSurfaceFields,
} from "./proof-matching.mjs";

const CODE = "VRDEX-AB12CD34EF56";

describe("VRChat proof matching", () => {
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
