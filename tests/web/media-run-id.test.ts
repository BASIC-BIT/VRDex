import assert from "node:assert/strict";
import { it } from "node:test";
import { mediaFixtureRunId } from "../../apps/web/e2e/media-run-id";

it("reconstructs media recovery handles from workflow metadata and separates attempts", () => {
  const env = { GITHUB_RUN_ID: "33934099777", GITHUB_RUN_ATTEMPT: "1" };
  assert.equal(mediaFixtureRunId(env), "media-33934099777-1");
  assert.notEqual(mediaFixtureRunId(env), mediaFixtureRunId({ ...env, GITHUB_RUN_ATTEMPT: "2" }));
  assert.ok(`${mediaFixtureRunId(env)}-contributor`.length <= 48);
});

it("requires explicit stable local handles and refuses malformed or incomplete metadata", () => {
  assert.equal(mediaFixtureRunId({ VRDEX_E2E_MEDIA_RUN_ID: "media-local-operator-1" }), "media-local-operator-1");
  assert.throws(() => mediaFixtureRunId({}));
  assert.throws(() => mediaFixtureRunId({ GITHUB_RUN_ID: "123" }));
  assert.throws(() => mediaFixtureRunId({ VRDEX_E2E_MEDIA_RUN_ID: `media-${"x".repeat(27)}` }));
});
