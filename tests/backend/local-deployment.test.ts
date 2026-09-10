import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isLocalDeploymentUrl, requireLocalDeployment } from "../../convex/_localDeployment";

describe("local deployment gate", () => {
  it("accepts loopback cloud URLs", () => {
    for (const url of [
      "http://127.0.0.1:3210",
      "http://localhost:3210",
      "http://[::1]:3210",
      "http://127.0.0.2:3210",
    ]) {
      assert.equal(isLocalDeploymentUrl(url), true, url);
      assert.doesNotThrow(() => requireLocalDeployment({ CONVEX_CLOUD_URL: url }));
    }
  });

  it("rejects cloud, lookalike, empty, and unparseable URLs", () => {
    for (const url of [
      "https://scrupulous-corgi-247.convex.cloud",
      "https://superb-pig-954.convex.cloud",
      "http://localhost.example.com:3210",
      "http://127.0.0.1.example.com",
      "",
      "not a url",
    ]) {
      assert.equal(isLocalDeploymentUrl(url), false, url);
      assert.throws(
        () => requireLocalDeployment({ CONVEX_CLOUD_URL: url }),
        /Local fixtures only run on a local deployment/,
        url,
      );
    }
    assert.throws(() => requireLocalDeployment({}), /Local fixtures only run on a local deployment/);
  });
});
