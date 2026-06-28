import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Id } from "../../convex/_generated/dataModel";
import type { DatabaseReader } from "../../convex/_generated/server";
import {
  subjectHasAnyCommunityCapability,
  subjectHasCommunityCapability,
  type AuthSubject,
  type CommunityCapability,
} from "../../convex/_communityAuthority";

type AuthorityRow = {
  communityProfileId: Id<"profiles">;
  subjectTokenIdentifier: string;
  state: "active" | "revoked";
  capabilities: CommunityCapability[];
};

function createCommunityAuthorityDb(authorities: AuthorityRow[]) {
  return {
    query(table: string) {
      assert.equal(table, "communityAuthorities");

      return {
        withIndex(_index: string, builder: (query: unknown) => unknown) {
          const values: Record<string, unknown> = {};
          const query = {
            eq(field: string, value: unknown) {
              values[field] = value;
              return query;
            },
          };

          builder(query);

          return {
            async take(limit: number) {
              return authorities
                .filter((authority) => Object.entries(values).every(([field, value]) => authority[field as keyof AuthorityRow] === value))
                .slice(0, limit);
            },
          };
        },
      };
    },
  } as unknown as DatabaseReader;
}

describe("community authority helpers", () => {
  const communityProfileId = "community123" as Id<"profiles">;
  const subject: AuthSubject = {
    tokenIdentifier: "issuer|subject",
    issuer: "issuer",
    subject: "subject",
  };

  it("keeps legacy profile-management capabilities compatible with the new edit capability", async () => {
    const db = createCommunityAuthorityDb([
      {
        communityProfileId,
        subjectTokenIdentifier: subject.tokenIdentifier,
        state: "active",
        capabilities: ["manage_profile"],
      },
    ]);

    assert.equal(await subjectHasCommunityCapability(db, communityProfileId, subject, "edit_community_profile"), true);
    assert.equal(await subjectHasCommunityCapability(db, communityProfileId, subject, "manage_events"), false);
  });

  it("checks all active role rows for split event operations capabilities", async () => {
    const db = createCommunityAuthorityDb([
      {
        communityProfileId,
        subjectTokenIdentifier: subject.tokenIdentifier,
        state: "active",
        capabilities: ["manage_roster"],
      },
      {
        communityProfileId,
        subjectTokenIdentifier: subject.tokenIdentifier,
        state: "active",
        capabilities: ["manage_event_media"],
      },
    ]);

    assert.equal(
      await subjectHasAnyCommunityCapability(db, communityProfileId, subject, [
        "view_event_operations",
        "manage_event_media",
      ]),
      true,
    );
  });
});
