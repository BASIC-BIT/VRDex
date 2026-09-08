import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { profileLinkPresentation, type ProfileLinkDestinationMetadata } from "../../convex/_profileLinkPresentation";
import { FIELD_PRESENT_INPUT, profileFieldsPayload } from "../../apps/web/src/app/_components/profile-fields-model";

const groupUrl = "https://vrchat.com/home/group/grp_11111111-2222-3333-4444-555555555555";
const destination: ProfileLinkDestinationMetadata = {
  targetKey: "vrchat_group:grp_11111111-2222-3333-4444-555555555555", kind: "vrchat_group",
  entityId: "grp_11111111-2222-3333-4444-555555555555", status: "resolved", name: "Velvet Circuit",
  artworkUrl: "/api/profile-link-artwork/group", observedAt: 100,
};
const group = { type: "other", url: groupUrl, label: "VRChat group", destination };

describe("destination names across public and preview presentation", () => {
  it("replaces known generic labels but preserves ambiguous wording and explicit overrides", () => {
    assert.equal(profileLinkPresentation(group).label, "Velvet Circuit");
    assert.equal(profileLinkPresentation({ ...group, label: "My community" }).label, "My community");
    assert.equal(profileLinkPresentation({ ...group, label: "VRChat group", labelMode: "custom" }).label, "VRChat group");
    assert.equal(profileLinkPresentation({ ...group, label: "Old wording", labelMode: "automatic" }).label, "Velvet Circuit");
    assert.equal(profileLinkPresentation({ ...group, label: "My community" }).artworkUrl, destination.artworkUrl);
  });

  it("follows provider renames only for automatic labels and keeps last known transient branding", () => {
    const renamed = { ...group, destination: { ...destination, name: "The New Name", status: "unavailable" as const } };
    assert.equal(profileLinkPresentation(renamed).label, "The New Name");
    assert.equal(profileLinkPresentation(renamed).artworkUrl, destination.artworkUrl);
    assert.equal(profileLinkPresentation({ ...renamed, label: "Our home", labelMode: "custom" }).label, "Our home");
  });

  it("drops both fetched name and artwork after URL edits, kind mismatch, or invalidation", () => {
    const cases = [
      { ...group, url: groupUrl.replace("555555555555", "666666666666") },
      { ...group, destination: { ...destination, kind: "vrchat_user" as const } },
      { ...group, destination: { ...destination, status: "invalid" as const } },
    ];
    for (const link of cases) {
      const shown = profileLinkPresentation(link);
      assert.notEqual(shown.label, destination.name);
      assert.equal(shown.artworkUrl, undefined);
      assert.equal(link.destination.name, "Velvet Circuit", "presentation must not mutate cached metadata");
    }
  });

  it("distinguishes unresolved groups and people while leaving unsupported links alone", () => {
    const first = profileLinkPresentation({ ...group, destination: undefined });
    const second = profileLinkPresentation({ ...group, url: groupUrl.replace("555555555555", "666666666666"), destination: undefined });
    assert.notEqual(first.label, second.label);
    assert.equal(first.platform, "VRChat group");
    assert.equal(profileLinkPresentation({ type: "vrchat_profile", url: groupUrl.replace("group/grp_", "user/usr_"), label: "VRChat" }).kind, "vrchat_user");
    assert.deepEqual(profileLinkPresentation({ type: "website", url: "https://example.com", label: "My sets", destination }), { label: "My sets" });
  });

  it("presents a Discord invite as a server even when custom text resembles a personal handle", () => {
    const shown = profileLinkPresentation({ type: "discord", url: "https://discord.gg/room", label: "my.handle", labelMode: "custom" });
    assert.equal(shown.kind, "discord_guild");
    assert.equal(shown.platform, "Discord server");
    assert.equal(shown.label, "my.handle");
    assert.equal(profileLinkPresentation({ type: "discord", url: "https://discord.com/users/123", label: "my.handle" }).kind, undefined);
  });
});

function editForm() {
  const form = new FormData();
  for (const [name, value] of Object.entries({
    [FIELD_PRESENT_INPUT]: "outboundLinks", displayName: "Example", linkType: "other", linkOriginalType: "other",
    linkUrl: groupUrl, linkOriginalUrl: groupUrl, linkOriginalIndex: "0", linkLabel: "Our group",
    linkLabelMode: "custom", linkLabelEdited: "false", linkSource: "owner_authored",
  })) form.set(name, value);
  return form;
}

describe("destination label editor submission", () => {
  it("round-trips an untouched override and emits an explicit automatic reset", () => {
    const form = editForm();
    assert.deepEqual(profileFieldsPayload(form, "person").outboundLinks, [{
      type: "other", url: groupUrl, label: "Our group", labelMode: "custom", source: "owner_authored",
    }]);
    form.set("linkLabel", "");
    form.set("linkLabelMode", "automatic");
    form.set("linkLabelEdited", "true");
    assert.deepEqual(profileFieldsPayload(form, "person").outboundLinks, [{
      type: "other", url: groupUrl, labelMode: "automatic", source: "owner_authored",
    }]);
  });

  it("drops old authored metadata on destination edits but keeps a newly typed override", () => {
    const form = editForm();
    const nextUrl = groupUrl.replace("555555555555", "666666666666");
    form.set("linkUrl", nextUrl);
    const changed = profileFieldsPayload(form, "person").outboundLinks?.[0];
    assert.equal(changed?.label, undefined);
    assert.equal(changed?.labelMode, undefined);
    form.set("linkLabel", "Another group");
    form.set("linkLabelEdited", "true");
    assert.equal(profileFieldsPayload(form, "person").outboundLinks?.[0]?.label, "Another group");
    assert.equal(profileFieldsPayload(form, "person").outboundLinks?.[0]?.labelMode, "custom");
  });

  it("never accepts fetched metadata from hidden form fields", () => {
    const form = editForm();
    form.set("linkDestination", JSON.stringify(destination));
    form.set("destination", JSON.stringify(destination));
    assert.equal(profileFieldsPayload(form, "person").outboundLinks?.[0]?.destination, undefined);
  });
});
