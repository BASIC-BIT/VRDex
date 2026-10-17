import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { it } from "node:test";
import {
  selectEventPerformer,
  eventPerformerLabel,
  savedEventPerformer,
  personIdentityOption,
  searchIdentityOption,
  type EventPersonResult,
} from "../../apps/web/src/lib/event-editor-identity";

const person: EventPersonResult = {
  slug: "aurora-one",
  displayName: "Aurora",
  profilePath: "/aurora-one",
  aliases: [],
  tags: ["House", "DJ"],
  genres: [],
  roleTags: ["DJ"],
  avatarImageUrl: "https://example.test/aurora.png",
  avatarImageKind: "profile",
  avatarAppearance: {
    borderEnabled: false,
    borderColor: "#ffffff",
    borderWidthPx: 0,
    borderSoftnessPx: 0,
    radiusPercent: 12,
  },
  trustLabel: "claimed_verified",
  outboundLinks: [],
};
it("retains public role, image, appearance and routing identity", () => {
  const option = personIdentityOption(person);
  assert.equal(option.kind, "person");
  assert.equal(option.title, "Aurora");
  assert.equal(option.href, "/aurora-one");
  assert.equal(option.imageUrl, "https://example.test/aurora.png");
  assert.deepEqual(option.appearance, person.avatarAppearance);
  assert.equal(option.context, "DJ / House");
  assert.equal(option.trustLabel, "claimed_verified");
});
it("does not manufacture raw-path context when a person has no public context", () => {
  assert.equal(
    personIdentityOption({ ...person, roleTags: [], tags: [] }).context,
    undefined,
  );
});
it("rejects events and unsupported profiles while containing community logos", () => {
  assert.equal(
    searchIdentityOption({
      entityType: "event",
      slug: "event",
      routePath: "/club/events/event",
      title: "Aurora",
      score: 1,
    }),
    null,
  );
  assert.equal(
    searchIdentityOption({
      entityType: "profile",
      slug: "unknown",
      routePath: "/unknown",
      title: "Unknown",
      score: 1,
    }),
    null,
  );
  const community = searchIdentityOption({
    entityType: "profile",
    profileType: "community",
    slug: "club",
    routePath: "/club",
    title: "Club",
    imageUrl: "https://example.test/logo.png",
    logoImageUrl: "https://example.test/logo.png",
    score: 1,
  });
  assert.equal(community?.imageKind, "logo");
  assert.equal(
    searchIdentityOption({
      entityType: "world",
      slug: "harbor",
      routePath: "/harbor",
      title: "Harbor",
      score: 1,
    })?.kind,
    "world",
  );
});
it("renders contained logos, verified trust and context without printing routing slugs", () => {
  const output = execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import assert from "node:assert/strict";
    import { createElement } from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { ProfileSuggestion } from "./src/app/_components/profile-suggestion.tsx";
    const html = renderToStaticMarkup(createElement(ProfileSuggestion, { option: { kind: "community", slug: "routing-secret", href: "/routing-secret", title: "Afterglow", imageKind: "logo", imageUrl: "https://example.test/logo.png", context: "Music", trustLabel: "claimed_verified" } }));
    assert.match(html, /object-contain/);
    assert.match(html, /Afterglow/);
    assert.match(html, /Music/);
    assert.match(html, /Verified profile/);
    assert.doesNotMatch(html, /routing-secret/);
    console.log("presentation pass");
  `,
    ],
    {
      cwd: path.resolve("apps/web"),
      encoding: "utf8",
      env: { ...process.env, TSX_TSCONFIG_PATH: "tsconfig.json" },
    },
  );
  assert.match(output, /presentation pass/);
});

it("preserves manual billing through links and replacements, while default follows the selected profile", () => {
  const aurora = personIdentityOption(person);
  const lumen = { ...aurora, slug: "lumen", title: "Lumen" };
  const linked = selectEventPerformer({ current: { kind: "manual", label: "Guest A" }, person: aurora });
  assert.deepEqual(linked, { kind: "linked", personSlug: "aurora-one", billing: { kind: "override", label: "Guest A" } });
  const changed = selectEventPerformer({ current: linked, person: lumen });
  assert.equal(eventPerformerLabel({ value: changed, profileName: "Lumen" }), "Guest A");
  const cleared = { kind: "linked", personSlug: "aurora-one", billing: { kind: "default" } } as const;
  assert.equal(eventPerformerLabel({ value: cleared, profileName: "Aurora" }), "Aurora");
  assert.equal(eventPerformerLabel({ value: selectEventPerformer({ current: cleared, person: lumen }), profileName: lumen.title }), "Lumen");
  assert.deepEqual(selectEventPerformer({ current: { kind: "manual", label: "" }, person: aurora }), { kind: "linked", personSlug: aurora.slug, billing: { kind: "default" } });
});
it("hydrates saved label intent without erasing unknown or unavailable linked identities", () => {
  assert.deepEqual(savedEventPerformer({ label: "Aurora", personSlug: "aurora-one" }), { kind: "linked", personSlug: "aurora-one", billing: { kind: "override", label: "Aurora" } });
  assert.deepEqual(savedEventPerformer({ label: "Aurora", personSlug: "aurora-one", profileName: "Aurora" }), { kind: "linked", personSlug: "aurora-one", billing: { kind: "default" } });
  assert.equal(eventPerformerLabel({ value: savedEventPerformer({ label: "Guest A", personSlug: "unavailable" }) }), "Guest A");
  const override = { kind: "linked", personSlug: "aurora-one", billing: { kind: "override", label: "Aurora" } } as const;
  assert.deepEqual(selectEventPerformer({ current: override, person: { ...personIdentityOption(person), slug: "lumen" } }), { ...override, personSlug: "lumen" });
});

it("equal manual names establish default billing while explicit equal overrides retain intent", () => {
  const aurora = personIdentityOption(person);
  const lumen = { ...aurora, slug: "lumen", title: "Lumen" };
  for (const label of ["Aurora", ""]) {
    const linked = selectEventPerformer({ current: { kind: "manual", label }, person: aurora });
    assert.deepEqual(linked, { kind: "linked", personSlug: "aurora-one", billing: { kind: "default" } });
    const changed = selectEventPerformer({ current: linked, person: lumen });
    assert.equal(eventPerformerLabel({ value: changed, profileName: lumen.title }), "Lumen");
  }
  for (const label of ["Guest A", "Aurora"]) {
    const linked = selectEventPerformer({ current: { kind: "linked", personSlug: aurora.slug, billing: { kind: "override", label } }, person: lumen });
    assert.equal(eventPerformerLabel({ value: linked, profileName: lumen.title }), label);
    assert.deepEqual(linked, { kind: "linked", personSlug: "lumen", billing: { kind: "override", label } });
  }
});
