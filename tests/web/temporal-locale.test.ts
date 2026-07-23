import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { defaultCountryForLocale } from "../../apps/web/src/lib/temporal-locale";

describe("temporal locale defaults", () => {
  it("uses only two-letter inferred regions as country defaults", () => {
    assert.equal(defaultCountryForLocale("en-US"), "US");
    assert.equal(defaultCountryForLocale("es-419"), "");
    assert.equal(defaultCountryForLocale("en-001"), "");
    assert.equal(defaultCountryForLocale("not_a_locale"), "");
  });
});
