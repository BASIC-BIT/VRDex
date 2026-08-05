import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FIELD_PRESENT_INPUT,
  partitionLinks,
  profileFieldsPayload,
} from "../../apps/web/src/app/_components/profile-fields-model";

/**
 * `present` names the field groups the form rendered, which is what the real
 * form emits as hidden markers. Anything not listed is absent from the payload
 * rather than present and empty.
 */
function formData(entries: Array<[string, string]>, present: string[] = []): FormData {
  const data = new FormData();

  for (const field of present) {
    data.append(FIELD_PRESENT_INPUT, field);
  }

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
      ], ["outboundLinks"]),
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
      ], ["outboundLinks"]),
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
      ], ["person"]),
      "person",
    );

    assert.deepEqual(
      payload.profileType === "person" ? payload.person.roleTags : [],
      ["DJ", "VJ", "Lighting design"],
    );
  });

  it("omits narrative fields the form never rendered", () => {
    // The update path treats a key it receives as an instruction, so sending an
    // empty string for a control nobody rendered would clear a headline the
    // editor never showed. The submit form does not carry these at all.
    const submitted = profileFieldsPayload(formData([["displayName", "Snek"]]), "person");

    assert.equal("headline" in submitted, false);
    assert.equal("bio" in submitted, false);

    const edited = profileFieldsPayload(
      formData([
        ["displayName", "Snek"],
        ["headline", "Bass in VRChat"],
        ["bio", ""],
        ["region", "EU"],
        ["timezone", ""],
      ], ["headline", "bio", "region", "timezone"]),
      "person",
    );

    // Present-but-empty is a clear, and has to survive as a key to mean one.
    assert.equal(edited.headline, "Bass in VRChat");
    assert.equal(edited.bio, "");
    assert.equal(edited.region, "EU");
    assert.equal(edited.timezone, "");
  });

  it("omits a field group the form did not render", () => {
    // The editor hides fields this writer may not edit, and the update path
    // reads every key it receives as an instruction. Without the marker, "no
    // link rows" is indistinguishable from "the links section was not shown",
    // so saving a typo fix would delete links the editor never displayed.
    const payload = profileFieldsPayload(
      formData([["displayName", "Snek"]], ["tags"]),
      "person",
    );

    assert.deepEqual(payload.tags, []);
    assert.equal("aliases" in payload, false);
    assert.equal("outboundLinks" in payload, false);
    assert.equal("person" in payload, false);
  });

  it("keeps an emptied group as an explicit clear", () => {
    // The other half: rendered and emptied has to reach the backend, or removing
    // your last link would silently do nothing.
    const payload = profileFieldsPayload(
      formData([["displayName", "Snek"]], ["outboundLinks", "aliases"]),
      "person",
    );

    assert.deepEqual(payload.outboundLinks, []);
    assert.deepEqual(payload.aliases, []);
  });

  it("ignores person fields on a community profile", () => {
    const payload = profileFieldsPayload(
      formData([
        ["displayName", "Afterglow"],
        ["roleTag", "DJ"],
        ["subtype", "Club"],
        ["categoryTags", "events, music"],
      ], ["person", "community"]),
      "community",
    );

    assert.equal(payload.profileType, "community");
    assert.deepEqual(
      payload.profileType === "community" ? payload.community : null,
      { subtype: "Club", categoryTags: ["events", "music"] },
    );
  });
});
