import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  partitionLinks,
  profileFieldsPayload,
} from "../../apps/web/src/app/_components/profile-fields-model";

function formData(entries: Array<[string, string]>): FormData {
  const data = new FormData();

  for (const [name, value] of entries) {
    data.append(name, value);
  }

  return data;
}

describe("stream link partitioning", () => {
  const links = [
    { type: "vrcdn", url: "https://vrcdn.live/snekwtf" },
    { type: "twitch", url: "https://twitch.tv/snekwtf" },
    { type: "twitch", url: "https://twitch.tv/snekwtf-alt" },
    { type: "soundcloud", url: "https://soundcloud.com/snekwtf" },
  ] as const;

  it("promotes the first of each type and leaves the rest in rows", () => {
    const { featured, rows } = partitionLinks([...links], true);

    assert.deepEqual(featured, {
      vrcdn: "https://vrcdn.live/snekwtf",
      twitch: "https://twitch.tv/snekwtf",
    });
    // The second Twitch link stays a row rather than being dropped for having
    // nowhere to go.
    assert.deepEqual(rows.map((link) => link.url), [
      "https://twitch.tv/snekwtf-alt",
      "https://soundcloud.com/snekwtf",
    ]);
  });

  it("leaves every link in rows when the dedicated inputs are not rendered", () => {
    // A community profile has no roles, so it never shows the stream inputs.
    // Promoting a link into a field that is not on the page would drop it on the
    // next save, silently, with no error anywhere.
    const { featured, rows } = partitionLinks([...links], false);

    assert.deepEqual(featured, {});
    assert.equal(rows.length, links.length);
  });
});

describe("profile fields payload", () => {
  it("merges the dedicated stream inputs into the link list", () => {
    const payload = profileFieldsPayload(
      formData([
        ["displayName", "Snek"],
        ["vrcdnUrl", "https://panel.vrcdn.live/preview/snekwtf"],
        ["twitchUrl", "https://twitch.tv/snekwtf"],
        ["linkType", "soundcloud"],
        ["linkUrl", "https://soundcloud.com/snekwtf"],
      ]),
      "person",
    );

    assert.deepEqual(payload.outboundLinks, [
      { type: "vrcdn", url: "https://panel.vrcdn.live/preview/snekwtf" },
      { type: "twitch", url: "https://twitch.tv/snekwtf" },
      { type: "soundcloud", url: "https://soundcloud.com/snekwtf" },
    ]);
  });

  it("drops blank rows and blank stream inputs rather than rejecting them", () => {
    const payload = profileFieldsPayload(
      formData([
        ["displayName", "Snek"],
        ["vrcdnUrl", "   "],
        ["linkType", "website"],
        ["linkUrl", ""],
        ["linkType", "website"],
        ["linkUrl", "https://example.com/snek"],
      ]),
      "person",
    );

    assert.deepEqual(payload.outboundLinks, [
      { type: "website", url: "https://example.com/snek" },
    ]);
  });

  it("combines checked roles with the freeform field, without repeating one", () => {
    const payload = profileFieldsPayload(
      formData([
        ["displayName", "Snek"],
        ["roleTag", "DJ"],
        ["roleTag", "VJ"],
        // Someone will type a role next to the box they already ticked.
        ["roleTagsOther", "dj, Lighting design"],
      ]),
      "person",
    );

    assert.deepEqual(
      payload.profileType === "person" ? payload.person.roleTags : [],
      ["DJ", "VJ", "Lighting design"],
    );
  });

  it("ignores person fields on a community profile", () => {
    const payload = profileFieldsPayload(
      formData([
        ["displayName", "Afterglow"],
        ["roleTag", "DJ"],
        ["subtype", "Club"],
        ["categoryTags", "events, music"],
      ]),
      "community",
    );

    assert.equal(payload.profileType, "community");
    assert.deepEqual(
      payload.profileType === "community" ? payload.community : null,
      { subtype: "Club", categoryTags: ["events", "music"] },
    );
  });
});
