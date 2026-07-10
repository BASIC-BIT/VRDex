import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import type { Doc, Id } from "../../convex/_generated/dataModel";
import {
  accountFeatureAccessFromGrants,
  isAccountFeatureGrantActive,
} from "../../convex/_accountFeatures";
import {
  canIncludePrivateSeedCandidate,
  projectSafePrivateSeedField,
} from "../../convex/_seedAccess";
import {
  buildConciergeProfileFieldPatch,
  hashHandoffToken,
  requireSecureHandoffToken,
  selectHandoffFields,
} from "../../convex/_seedHandoffs";
import {
  createSeedImportDocuments,
  normalizePermissionedSeedImport,
} from "../../convex/_seedImports";

function seedField(
  overrides: Partial<Doc<"seedImportCandidateFields">> = {},
): Doc<"seedImportCandidateFields"> {
  return {
    _id: "field-1" as Id<"seedImportCandidateFields">,
    _creationTime: 1,
    candidateId: "candidate-1" as Id<"seedImportCandidateProfiles">,
    fieldKey: "aliases",
    value: ["DJ Example"],
    sourceLabel: "Example Partner",
    sourceType: "partner",
    confidence: "medium",
    reviewState: "unreviewed",
    visibility: "private",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("account feature access", () => {
  it("honors expiry and lets super-admin imply seed lookup", () => {
    assert.equal(
      isAccountFeatureGrantActive(
        { feature: "view_private_seed_lookup", state: "active", expiresAt: 99 },
        100,
      ),
      false,
    );
    assert.deepEqual(
      accountFeatureAccessFromGrants(
        [{ feature: "super_admin", state: "active", expiresAt: 101 }],
        100,
      ),
      { superAdmin: true, canViewPrivateSeedLookup: true },
    );
    assert.deepEqual(
      accountFeatureAccessFromGrants(
        [{ feature: "view_private_seed_lookup", state: "revoked" }],
        100,
      ),
      { superAdmin: false, canViewPrivateSeedLookup: false },
    );
  });
});

describe("permissioned seed import", () => {
  const payload = {
    permissioned: true,
    batchId: "partner_2026_07_09",
    sourceName: "Example Partner",
    sourceType: "partner",
    receivedAt: "2026-07-09T12:00:00.000Z",
    sourceObservedAt: "2026-07-01T00:00:00.000Z",
    candidates: [
      {
        candidateId: "example-dj-1",
        proposedDisplayName: "DJ Example",
        fields: [
          {
            fieldKey: "outboundLinks",
            value: [
              {
                type: "soundcloud",
                label: "SoundCloud",
                url: "https://example.invalid/dj-example",
              },
            ],
            sourceLabel: "Example Partner",
            sourceType: "partner",
            sourceObservedAt: "2026-07-01T00:00:00.000Z",
            lastCheckedAt: "2026-07-08T00:00:00.000Z",
            confidence: "medium",
            visibility: "private",
          },
        ],
      },
    ],
  };

  it("normalizes real input into private unclaimed records with freshness", async () => {
    const normalized = normalizePermissionedSeedImport(payload);
    assert.equal(normalized.sourceObservedAt, Date.parse("2026-07-01T00:00:00.000Z"));
    assert.equal(normalized.candidates[0]?.publicationState, "draft_private");
    assert.equal(normalized.candidates[0]?.claimState, "unclaimed");
    assert.equal(
      normalized.candidates[0]?.fields[0]?.lastCheckedAt,
      Date.parse("2026-07-08T00:00:00.000Z"),
    );

    const inserts: Array<{ table: string; document: Record<string, unknown> }> = [];
    await createSeedImportDocuments(
      {
        async insert(table: string, document: Record<string, unknown>) {
          inserts.push({ table, document });
          return `${table}-${inserts.length}`;
        },
      } as never,
      normalized,
      { now: 10 },
    );

    assert.equal(
      inserts.find((insert) => insert.table === "seedImportBatches")?.document.sourceObservedAt,
      Date.parse("2026-07-01T00:00:00.000Z"),
    );
    assert.equal(
      inserts.find((insert) => insert.table === "seedImportCandidateFields")?.document.lastCheckedAt,
      Date.parse("2026-07-08T00:00:00.000Z"),
    );
  });

  it("rejects unpermissioned, extra, and private-contact fields", () => {
    assert.throws(
      () => normalizePermissionedSeedImport({ ...payload, permissioned: false }),
      /permissioned: true/,
    );
    assert.throws(
      () => normalizePermissionedSeedImport({ ...payload, privateNotes: "do not ingest" }),
      /unsupported key/,
    );
    const privateContact = structuredClone(payload) as Record<string, any>;
    privateContact.candidates[0].fields[0].fieldKey = "privateContactEmail";
    privateContact.candidates[0].fields[0].value = "private@example.invalid";
    assert.throws(
      () => normalizePermissionedSeedImport(privateContact),
      /Unsupported permissioned seed field/,
    );
  });
});

describe("private seed projection", () => {
  it("shows unreviewed candidates only to super-admins and allowlists fields", () => {
    const candidate = {
      profileType: "person" as const,
      publicationState: "draft_private" as const,
      reviewState: "unreviewed" as const,
    };
    assert.equal(canIncludePrivateSeedCandidate(candidate as never, true), true);
    assert.equal(canIncludePrivateSeedCandidate(candidate as never, false), false);
    assert.equal(projectSafePrivateSeedField(seedField())?.fieldKey, "aliases");
    assert.equal(
      projectSafePrivateSeedField(
        seedField({ fieldKey: "privateContactEmail", value: "private@example.invalid" }),
      ),
      null,
    );
  });
});

describe("seed handoff helpers", () => {
  it("hashes strong invitation tokens with SHA-256 and rejects weak tokens", async () => {
    const token = "A".repeat(43);
    assert.equal(
      await hashHandoffToken(token),
      createHash("sha256").update(token).digest("hex"),
    );
    assert.throws(() => requireSecureHandoffToken("short"), /invalid/);
  });

  it("allows recipients to remove every optional field explicitly", () => {
    assert.deepEqual(selectHandoffFields([seedField()], []), []);
  });

  it("rejects fields outside the invitation and builds private profile fields", () => {
    const aliasField = seedField();
    assert.throws(
      () =>
        selectHandoffFields(
          [aliasField],
          ["not-offered" as Id<"seedImportCandidateFields">],
        ),
      /not offered/,
    );
    assert.deepEqual(buildConciergeProfileFieldPatch([aliasField]), {
      aliases: ["DJ Example"],
      fieldVisibility: { aliases: "private" },
    });
  });
});
