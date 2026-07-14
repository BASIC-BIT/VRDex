import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_SIGN_IN_RETURN_TO,
  validateSignInReturnTo,
} from "../../apps/web/src/lib/safe-return-to";

describe("sign-in return routing", () => {
  it("preserves root-relative destinations, queries, and fragments", () => {
    assert.equal(validateSignInReturnTo("/handoff/invite-token"), "/handoff/invite-token");
    assert.equal(
      validateSignInReturnTo("/handoff/invite-token?step=review#fields"),
      "/handoff/invite-token?step=review#fields",
    );
  });

  it("uses only the first search parameter value", () => {
    assert.equal(
      validateSignInReturnTo(["/handoff/invite-token", "https://attacker.invalid"]),
      "/handoff/invite-token",
    );
  });

  it("rejects external, protocol-relative, and non-path destinations", () => {
    for (const value of [
      "https://attacker.invalid",
      "//attacker.invalid/path",
      "javascript:alert(1)",
      "account",
    ]) {
      assert.equal(validateSignInReturnTo(value), DEFAULT_SIGN_IN_RETURN_TO);
    }
  });

  it("rejects encoded separators, backslashes, control characters, and malformed escapes", () => {
    for (const value of [
      "/%2F%2Fattacker.invalid",
      "/%5C%5Cattacker.invalid",
      "/\\attacker.invalid",
      "/handoff/%0d%0aLocation:%20https://attacker.invalid",
      "/handoff/%",
    ]) {
      assert.equal(validateSignInReturnTo(value), DEFAULT_SIGN_IN_RETURN_TO);
    }
  });

  it("falls back for missing values", () => {
    assert.equal(validateSignInReturnTo(undefined), DEFAULT_SIGN_IN_RETURN_TO);
    assert.equal(validateSignInReturnTo(null), DEFAULT_SIGN_IN_RETURN_TO);
    assert.equal(validateSignInReturnTo(""), DEFAULT_SIGN_IN_RETURN_TO);
  });
});
