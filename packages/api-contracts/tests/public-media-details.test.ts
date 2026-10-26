import assert from "node:assert/strict";
import { it } from "node:test";
import { PublicProfileMediaDetailsSchema } from "../src/public-media-details";
const actor = {
  displayName: "Public A",
  profileSlug: "public-a",
  profileUrl: "/public-a",
};
const details = {
  profileSlug: "target",
  asset: { assetId: "asset", detailsUrl: "/target#media-asset" },
  referenceUrl: "https://example.test/source",
  credit: "Artist",
  uploadedBy: actor,
  history: [{ kind: "uploaded", at: 10, actor }],
};
it("accepts the allowlisted details model", () =>
  assert.deepEqual(PublicProfileMediaDetailsSchema.parse(details), details));
it("rejects private fields at every nested boundary", () => {
  for (const value of [
    { ...details, sourceUrl: "private" },
    { ...details, asset: { ...details.asset, sourceUrl: "private" } },
    { ...details, uploadedBy: { ...actor, email: "private" } },
    {
      ...details,
      history: [{ ...details.history[0], privateReason: "private" }],
    },
  ])
    assert.equal(
      PublicProfileMediaDetailsSchema.safeParse(value).success,
      false,
    );
});
it("caps history at three and permits unknown event dates and actors", () => {
  assert.equal(
    PublicProfileMediaDetailsSchema.safeParse({
      ...details,
      history: Array(4).fill(details.history[0]),
    }).success,
    false,
  );
  assert.equal(
    PublicProfileMediaDetailsSchema.safeParse({
      ...details,
      history: [{ kind: "published", at: null, actor: null }],
    }).success,
    true,
  );
});
