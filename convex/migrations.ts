import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";

import { ACCOUNT_FEATURES, isAccountFeatureGrantActive } from "./_accountFeatureModel";
import { components, internal } from "./_generated/api";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import {
  createProfileSearchDocument,
  upsertSearchDocument,
  vocabularyForProfile,
} from "./_searchDocuments";
import { isLiveHandoffInvitation } from "./_seedHandoffs";
import { hasAcceptedSuppression, surfacedProfileNames } from "./_suppressions";
import { recordVocabularyTerms } from "./_vocabulary";

type LegacyProfile = Doc<"profiles"> & {
  publicSurfacingState?: Doc<"profiles">["publicSurfacingState"];
  publicSurfacingUpdatedAt?: number;
};

export const migrations = new Migrations<DataModel>(components.migrations, {
  internalMutation,
  defaultBatchSize: 50,
  migrationsLocationPrefix: "migrations:",
});

export const backfillProfilePublicSurfacingState = migrations.define({
  table: "profiles",
  migrateOne: async (_ctx, profile) => {
    const legacyProfile = profile as LegacyProfile;

    if (
      legacyProfile.publicSurfacingState !== undefined &&
      legacyProfile.publicSurfacingUpdatedAt !== undefined
    ) {
      return;
    }

    return {
      publicSurfacingState: legacyProfile.publicSurfacingState ?? "public",
      publicSurfacingUpdatedAt: legacyProfile.publicSurfacingUpdatedAt ?? Date.now(),
    };
  },
});

/**
 * Give every active handoff invitation a `profileId`.
 *
 * An invitation created before its candidate was matched carries none, which makes
 * every profile-indexed liveness check blind to it. Backfilling from the
 * candidate's `matchedProfileId` lets all publication paths use one cheap
 * `by_profileId_state` lookup instead of walking sibling candidates.
 */
export const backfillHandoffInvitationProfileIds = migrations.define({
  table: "seedHandoffInvitations",
  migrateOne: async (ctx, invitation) => {
    if (invitation.profileId !== undefined || invitation.state !== "active") {
      return;
    }

    const candidate = await ctx.db.get(invitation.candidateId);

    if (candidate?.matchedProfileId === undefined) {
      return;
    }

    return { profileId: candidate.matchedProfileId };
  },
});

export const runBackfillHandoffInvitationProfileIds = migrations.runner(
  internal.migrations.backfillHandoffInvitationProfileIds,
);

export const runBackfillProfilePublicSurfacingState = migrations.runner(
  internal.migrations.backfillProfilePublicSurfacingState,
);

/**
 * Take previously gated profiles live.
 *
 * Flips default-private profiles to published and reindexes them for search and
 * vocabulary (a flipped profile that is not reindexed stays invisible to
 * discovery).
 *
 * Only `draft_private` + `public` profiles are touched: that combination is the
 * default-private state with no explicit surfacing decision attached.
 *
 * Deliberately preserved:
 * - `opted_out` profiles. This is the canonical "keep off ordinary public
 *   surfaces" signal, and it is what `seedHandoffs` writes on a prepared
 *   concierge profile, including *unclaimed* ones that have been prepared for
 *   outreach but never accepted. Those were offered on the explicit promise that
 *   nothing is published, so claim state cannot be used to discard the opt-out.
 * - `suppressed` profiles, which are a moderation state.
 * - Any profile with an accepted `profileSuppressionRequests` row, which is the
 *   record of someone asking not to be listed.
 * - Claimed profiles, since publication of an owned profile is the owner's call.
 * - Profiles with a live concierge handoff invitation, whose recipient is holding
 *   a private review link.
 */
export const publishGatedProfiles = migrations.define({
  table: "profiles",
  // ponytail: smaller than the 50-row default because migrateOne has no page hook
  // to preload the accepted-suppression set, so each row re-reads it. Raise this
  // once suppression requests carry a canonical name/type index that allows a
  // targeted lookup instead of a full scan.
  batchSize: 10,
  migrateOne: async (ctx, profile) => {
    if (profile.claimState !== "unclaimed") {
      return;
    }

    if (profile.publicationState !== "draft_private" || profile.publicSurfacingState !== "public") {
      return;
    }

    // The migration bypasses both publication gates, so it repeats their live
    // handoff check: an invitation can reuse a legacy draft_private profile whose
    // surfacing state is still public, and publishing it would expose the profile
    // while its private review link is live.
    const activeInvitations = await ctx.db
      .query("seedHandoffInvitations")
      .withIndex("by_profileId_state", (query) =>
        query.eq("profileId", profile._id).eq("state", "active"),
      )
      .collect();

    if (activeInvitations.some((invitation) => isLiveHandoffInvitation(invitation, Date.now()))) {
      // Recorded as an explicit opt-out rather than skipped. A bare return advances
      // the migration cursor, so a profile whose invitation later expires would stay
      // draft_private forever with no record of why. opted_out is the same state
      // seedHandoffs writes on a prepared concierge profile, and the ordinary
      // publication and suppression paths govern it from there.
      const now = Date.now();

      await ctx.db.patch(profile._id, {
        publicSurfacingState: "opted_out",
        publicSurfacingUpdatedAt: now,
        publicSurfacingReason: "Concierge handoff invitation pending.",
        updatedAt: now,
      });

      return;
    }

    const suppressed = await hasAcceptedSuppression(ctx.db, {
      profileId: profile._id,
      slugs: [profile.slug],
      // Every name this profile would surface, respecting alias field visibility.
      displayNames: surfacedProfileNames(profile),
      profileType: profile.profileType,
    });

    if (suppressed) {
      return;
    }

    const now = Date.now();

    await ctx.db.patch(profile._id, {
      publicationState: "published",
      publicSurfacingUpdatedAt: now,
      publishedAt: profile.publishedAt ?? now,
      updatedAt: now,
    });

    const published = await ctx.db.get(profile._id);

    if (published !== null) {
      // Search and vocabulary are updated together everywhere else profiles
      // publish. Indexing search alone would surface the profile while leaving
      // its tags and genres missing from discovery vocabulary and usage counts.
      await Promise.all([
        upsertSearchDocument(ctx.db, createProfileSearchDocument(published)),
        recordVocabularyTerms(ctx.db, vocabularyForProfile(published), now),
      ]);

    }
  },
});

// Runs the surfacing backfill first: a legacy profile with no publicSurfacingState
// would be skipped by publishGatedProfiles while its cursor advanced, and running
// the backfill afterwards cannot make a completed migration revisit it.
//
// This deliberately does not reindex worlds per row. Scheduling one reindex per
// migrated profile would mean a full worlds scan each; run
// `search:rebuildWorldSearchDocuments` once afterwards instead, which covers every
// newly visible attribution and records world vocabulary with it.
export const runPublishGatedProfiles = migrations.runner([
  internal.migrations.backfillProfilePublicSurfacingState,
  internal.migrations.backfillHandoffInvitationProfileIds,
  internal.migrations.publishGatedProfiles,
]);

/**
 * Stamp `appliedAt` on Discord watermarks written before that field existed.
 *
 * A positive `appliedGeneration` is proof reconciliation completed, but those
 * rows carry no success timestamp, and `updatedAt` is not a substitute:
 * `reserveGuildVerificationGeneration` bumps it before reading guilds, so a
 * later failed attempt on an older account would make it outrank a newer
 * successful one and hand claiming the wrong Discord identity.
 *
 * `updatedAt` is the best evidence available for rows already written, and it is
 * correct unless a reservation failed after the last success — freezing it into
 * the immutable field at least stops future failures from moving it.
 */
export const backfillDiscordWatermarkAppliedAt = migrations.define({
  table: "discordVerificationWatermarks",
  migrateOne: async (_ctx, watermark) => {
    if (watermark.appliedAt !== undefined || watermark.appliedGeneration <= 0) {
      return;
    }

    return { appliedAt: watermark.updatedAt };
  },
});

export const runBackfillDiscordWatermarkAppliedAt = migrations.runner(
  internal.migrations.backfillDiscordWatermarkAppliedAt,
);

// Deliberately not in runAll: publishGatedProfiles publishes profiles publicly,
// which is outward-facing and not cleanly reversible. An operator triggers it when
// they mean to, rather than it firing as a side effect of a function deploy.
export const runAll = migrations.runner([
  internal.migrations.backfillProfilePublicSurfacingState,
  internal.migrations.backfillHandoffInvitationProfileIds,
  internal.migrations.backfillDiscordWatermarkAppliedAt,
]);

// ---------------------------------------------------------------------------
// Convex Auth purge, phase two.
//
// Clerk owns authentication. What is left behind is the Convex Auth component's
// six tables, VRDex's own `recentAuthChallenges` and `e2eAuthCodes`, and the
// `users` rows created before the cutover — inert, because a row without a
// `clerkUserId` matches the index for nobody, but still blocking the schema
// change that drops those declarations. Convex rejects a push that leaves a
// populated table undeclared.
//
// Deliberately not in `runAll`. This deletes rows and cannot be undone, so it
// runs when an operator means it, not as a side effect of a function deploy.
// `dryRun` defaults to true for the same reason: the first run reports, the
// second acts.

export const CONVEX_AUTH_TABLES = [
  "authRefreshTokens",
  "authVerificationCodes",
  "authVerifiers",
  "authSessions",
  "authAccounts",
  "authRateLimits",
  "recentAuthChallenges",
  "e2eAuthCodes",
] as const;

// Every `v.id("users")` field outside the tables above, derived from
// `convex/schema.ts`. A legacy row referenced by any of them is NOT deleted:
// Convex does not enforce referential integrity, so removing it would leave a
// dangling id that reads as a valid reference and resolves to nothing.
//
// Kept as data rather than 38 hand-written queries because the whole point is
// that the list is exhaustive — a missed entry is silent corruption, and a
// table is far easier to check against the schema than a wall of lookups.
//
// The third element is an index whose *leading* column is that field. Every
// entry has one, so the check is always a keyed existence probe and there is no
// scanning branch left to reason about.
//
// It used to allow null, meaning "scan this table instead", defended by the
// claim that those tables were bounded by entity count rather than by request
// volume. The claim was wrong for `apiTokens.revokedByUserId`: token creation
// has no per-account cap and revocation patches the row rather than deleting it,
// so the table grows with churn. Rather than re-argue the remaining cases one at
// a time, `schema.ts` gained the seven missing indexes, alongside the
// `oauthAccessTokens` one added earlier. Deleting the branch is a smaller change
// than defending it, and it removes a whole class of "is this table really
// bounded" reasoning from a destructive migration.
//
// `tests/backend/convex-auth-purge.test.ts` checks each named index exists in
// the schema and leads with that field, because a wrong name is a runtime throw
// in the middle of a purge rather than a type error.
export const USER_REFERENCES = [
  ["accountFeatureGrants", "userId", "by_userId_feature_state"],
  ["apiTokenEvents", "ownerUserId", "by_ownerUserId_createdAt"],
  ["apiTokens", "ownerUserId", "by_ownerUserId_createdAt"],
  ["apiTokens", "revokedByUserId", "by_revokedByUserId"],
  ["apiWriteAuditEvents", "ownerUserId", "by_ownerUserId_createdAt"],
  ["billingCustomerMappings", "userId", "by_userId_state"],
  ["billingEntitlementSnapshots", "userId", "by_userId_entitlementKey_status"],
  ["billingSubscriptionSnapshots", "userId", "by_userId_status"],
  ["communityVrclinkingCredentials", "delegatedByUserId", "by_delegatedByUserId"],
  ["discordVerificationStates", "userId", "by_userId_createdAt"],
  ["discordVerificationWatermarks", "userId", "by_userId_discordUserId"],
  ["externalControlProofs", "userId", "by_userId_assetType_assetExternalId"],
  ["mcpEventWriteReceipts", "ownerUserId", "by_owner_client_tool_key"],
  ["mcpToolEvents", "ownerUserId", "by_ownerUserId_createdAt"],
  ["oauthAccessTokens", "userId", "by_userId"],
  ["oauthApplicationSecrets", "revokedByUserId", "by_revokedByUserId"],
  ["oauthApplications", "ownerUserId", "by_ownerUserId_createdAt"],
  ["oauthApplications", "revokedByUserId", "by_revokedByUserId"],
  ["oauthAuthorizationCodes", "userId", "by_userId_createdAt"],
  ["oauthClientEvents", "ownerUserId", "by_ownerUserId_createdAt"],
  ["oauthConsentTransactions", "userId", "by_userId_expiresAt"],
  ["oauthRefreshTokens", "userId", "by_userId_expiresAt"],
  ["profileAssetAccessibilityGenerationEvents", "userId", "by_userId_createdAt"],
  ["profileClaimRequests", "userId", "by_userId_state"],
  ["profileExternalLinks", "linkedByUserId", "by_linkedByUserId"],
  ["profileOwners", "userId", "by_userId_state"],
  ["profileVerificationAttempts", "userId", "by_userId_state"],
  ["seedHandoffInvitations", "acceptedByUserId", "by_acceptedByUserId"],
  ["temporalParseJobs", "ownerUserId", "by_ownerUserId_idempotencyKeyHash"],
  ["temporalParsingPreferences", "userId", "by_userId"],
  ["temporalPrewarmLeases", "ownerUserId", "by_ownerUserId"],
] as const;

// Documents read or deleted per invocation across the eight tables. Well under
// Convex's transaction limits with room for the reference scan that runs first,
// and large enough that any deployment this repository has produced clears in a
// single pass.
const PURGE_BATCH = 2_000;

// Legacy `users` rows examined per invocation. Much smaller than `PURGE_BATCH`
// because these cost differently: clearing an auth table is one read and one
// delete per row, while each legacy row is probed against all 31 references. At
// the delete budget that is tens of thousands of reads in one transaction — over
// the limit, and a limit this exists to stay under.
const LEGACY_USER_PAGE = 50;

// Clerk identities echoed back so an operator can find their own without reading
// the dashboard. Capped because it is a convenience, not an inventory.
const CLERK_USER_REPORT_LIMIT = 25;

// Ceiling on the informational authority scan. Past it the count is reported as
// unknown rather than undercounted from a truncated page.
const STALE_AUTHORITY_SCAN_LIMIT = 1_000;

// Cursors carry the mode that produced them.
//
// A destructive walk must begin at the first legacy row: starting it from a
// cursor an operator paged to during discovery skips everything before that
// point, and if the remainder fits one page the run reports itself finished with
// those rows still present. Forbidding cursors outright was tried and wedged the
// loop on a fully blocked page, so the rule is narrower — a destructive run
// accepts only cursors a destructive run produced, and the first one has none.
const CURSOR_MODES = { dry: "dry:", live: "live:" } as const;

function tagCursor(dryRun: boolean, cursor: string | null): string | null {
  return cursor === null ? null : `${dryRun ? CURSOR_MODES.dry : CURSOR_MODES.live}${cursor}`;
}

/** Just enough of a Convex query to read one index for one value. */
type IndexedTableQuery = {
  withIndex: (
    index: string,
    build: (q: { eq: (field: string, value: string) => unknown }) => unknown,
  ) => {
    first: () => Promise<{ _id: string } | null>;
    collect: () => Promise<{ _id: string }[]>;
  };
};

export const purgeConvexAuthLeftovers = internalMutation({
  args: {
    // Both ends of the grant transfer, named explicitly. Neither is inferred.
    //
    // Not by email: a rule that moves privileges to whoever holds a matching
    // address is a privilege-escalation primitive. Not "every grant on every
    // legacy row" either, which was the first version of this and was worse —
    // `view_private_seed_lookup` and `use_temporal_parsing_beta` are issued to
    // individual beta users, so a deployment holding grants for several of them
    // would have had all of those collapse onto one account.
    //
    // Only `from`'s active grants move. Grants on any other legacy row are left
    // alone and block that row's deletion, which is the outcome worth having:
    // someone else's privileges are a reason to stop, not to reassign.
    regrantGrantsFrom: v.optional(v.id("users")),
    regrantGrantsToClerkUserId: v.optional(v.string()),
    // Convex's own pagination cursor, from a previous run's `nextLegacyCursor`.
    //
    // A destructive run advances on its own, because the rows it deletes stop
    // matching. A dry run deletes nothing, so without this it re-reads the same
    // first page forever — and the runbook tells an operator to take
    // `regrantGrantsFrom` out of a dry run's `blockedUsers`. On a deployment with
    // more legacy rows than one page, the grant-bearing row could sit beyond it
    // and be undiscoverable without starting to delete first.
    //
    // An opaque cursor rather than a `_creationTime` to resume after. Convex
    // guarantees `_creationTime` is strictly increasing within a transaction, so
    // the obvious tie case — rows written by one mutation — cannot collide, but
    // that guarantee is per-transaction and a hand-rolled `gt` bound is not the
    // index's full position. The purpose-built cursor is the same amount of code
    // and carries no assumption at all.
    legacyCursor: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;

    if ((args.regrantGrantsFrom === undefined) !== (args.regrantGrantsToClerkUserId === undefined)) {
      throw new Error(
        "regrantGrantsFrom and regrantGrantsToClerkUserId go together. Pass both to move grants, or neither to leave every grant alone.",
      );
    }


    // Indexed, not scanned. `undefined` is a queryable index value in Convex —
    // it matches documents lacking the field — so the legacy rows come straight
    // off `clerkUserId` rather than out of a full `users` read. That matters for
    // the same reason the reference probes did: `users` grows with the product,
    // and reading all of it to derive a handful of pre-cutover rows would put the
    // purge back over the transaction limit on the deployments that still need it.
    //
    // Bounded as well, so a deployment with more legacy rows than one pass can
    // hold makes progress instead of failing identically forever. One extra row
    // is fetched purely to answer "is there another page" — without it,
    // `moreRemaining` would be false whenever the auth tables happened to fit,
    // ending the rerun loop with legacy rows still present and the schema change
    // that requires `clerkUserId` failing later for no visible reason.
    // A destructive run takes only its own cursors, so its walk always starts at
    // the first legacy row. A dry run may resume from either, since it reads.
    let rawCursor: string | null = null;

    if (args.legacyCursor !== undefined) {
      if (args.legacyCursor.startsWith(CURSOR_MODES.live)) {
        rawCursor = args.legacyCursor.slice(CURSOR_MODES.live.length);
      } else if (args.legacyCursor.startsWith(CURSOR_MODES.dry)) {
        if (!dryRun) {
          throw new Error(
            "That cursor came from a dry run. A destructive walk must start with no cursor so no legacy row is skipped, then carry the nextLegacyCursor it returns.",
          );
        }

        rawCursor = args.legacyCursor.slice(CURSOR_MODES.dry.length);
      } else {
        throw new Error("legacyCursor must be a nextLegacyCursor from a previous run.");
      }
    }

    const legacyPage = await ctx.db
      .query("users")
      .withIndex("clerkUserId", (q) => q.eq("clerkUserId", undefined))
      .paginate({ numItems: LEGACY_USER_PAGE, cursor: rawCursor });
    const legacy = legacyPage.page;
    const moreLegacy = !legacyPage.isDone;
    const legacyIds = new Set<string>(legacy.map((user) => user._id));

    // What `auth.config.ts` trusts today. An authority whose subject carries this
    // issuer was granted under Clerk and still matches its owner.
    const currentIssuer = process.env.CLERK_JWT_ISSUER_DOMAIN ?? "";

    let regrantTarget: Id<"users"> | undefined;

    if (args.regrantGrantsToClerkUserId !== undefined) {
      const target = await ctx.db
        .query("users")
        .withIndex("clerkUserId", (q) => q.eq("clerkUserId", args.regrantGrantsToClerkUserId))
        .unique();

      if (target === null) {
        throw new Error(
          `No users row carries clerkUserId ${args.regrantGrantsToClerkUserId}. Sign in through Clerk first so ensureUser provisions one.`,
        );
      }

      // Validated against the row, not against `legacyIds`. That set is one page
      // of legacy users, so checking membership conflated three different
      // situations and rejected two of them wrongly.
      const source = await ctx.db.get(args.regrantGrantsFrom as Id<"users">);

      if (source === null) {
        // Already deleted by an earlier pass. The documented workflow is to rerun
        // with the same arguments until `moreRemaining` is false, and pagination
        // means the source can be purged on pass one while later pages remain —
        // so throwing here would make the advertised loop impossible to complete.
        // Its grants moved when it was deleted, which makes this a no-op.
        regrantTarget = undefined;
      } else if (source.clerkUserId !== undefined) {
        // A Clerk row is never a valid source: moving its grants onto another
        // Clerk row is a privilege transfer between live accounts, which is not
        // what this function is for.
        throw new Error(
          `regrantGrantsFrom ${args.regrantGrantsFrom} carries a clerkUserId, so it is not a legacy row. Only pre-cutover rows are purged, so only their grants need moving.`,
        );
      } else {
        // A legacy row, whether or not it landed on this page. The regrant reads
        // grants by user id rather than off the page, so it is correct either way.
        regrantTarget = target._id;
      }
    }

    // Re-point before scanning, so a grant that moved off a legacy row stops
    // counting as a reason to keep it.
    const regranted: string[] = [];

    if (regrantTarget !== undefined) {
      const now = Date.now();

      // One read per feature rather than the user's whole grant history. That
      // history is unbounded: `accountFeatureGrants.grant` inserts a fresh row
      // once the previous one has expired, and `revoke` patches rather than
      // deletes, so repeated grant/revoke cycles accumulate rows for the same
      // feature and user.
      //
      // Newest-active-first is exactly right because of `grant`'s own invariant:
      // it refuses to insert while an unexpired active grant exists, so if a live
      // grant exists for a feature it is the most recent active row. Anything
      // older is expired or revoked, and neither transfers.
      for (const feature of ACCOUNT_FEATURES) {
        const newest = await ctx.db
          .query("accountFeatureGrants")
          .withIndex("by_userId_feature_state", (q) =>
            q
              .eq("userId", args.regrantGrantsFrom as Id<"users">)
              .eq("feature", feature)
              .eq("state", "active"),
          )
          .order("desc")
          .first();

        // The codebase's own definition of a live grant, not a reimplementation
        // of it. `isAccountFeatureGrantActive` requires an unexpired `expiresAt`
        // as well as `state === "active"`, and checking state alone would move an
        // expired grant that conveys no privilege — rewriting its ownership onto
        // the Clerk account for exactly the reason revoked grants are left alone.
        //
        // Anything not live stays put and blocks. Moving one writes a history in
        // which the Clerk account held and lost a feature it never had; deleting
        // one discards the record of a revocation or an expiry.
        if (newest === null || !isAccountFeatureGrantActive(newest, now)) {
          continue;
        }

        regranted.push(`${newest.feature}:${newest._id}`);

        if (!dryRun) {
          await ctx.db.patch(newest._id, { userId: regrantTarget, updatedAt: Date.now() });
        }
      }
    }

    // A dry run reports what a real run would refuse to delete. Because the
    // patches above have not been applied yet, grants still sit on legacy rows,
    // so exclude the ones already accounted for rather than reporting them twice.
    const regrantedGrantIds = new Set(regranted.map((entry) => entry.split(":")[1]));
    const blocked = new Map<string, string[]>();

    const block = (userId: string, reference: string) => {
      blocked.set(userId, [...(blocked.get(userId) ?? []), reference]);
    };

    // Skipped entirely when there is nothing to delete. A deployment that never
    // ran Convex Auth — every self-hosted one — reaches this with no legacy rows,
    // and reading 31 tables to confirm a no-op is the one case where the scan
    // could exceed a transaction limit for no reason at all.
    if (legacy.length > 0) {
      for (const [table, field, index] of USER_REFERENCES) {
        // `accountFeatureGrants` is the one table where a hit is not necessarily
        // a blocker, because the regrant above moves some of its rows. An
        // existence probe cannot express that: a user with a reissued feature has
        // an active grant *and* an older revoked one, `first()` returns whichever
        // the index orders first, and excluding the regranted active row would
        // hide the revoked row still pointing at the user. The dry run would then
        // report the row deletable while the real run — which patches before it
        // scans, so the probe sees the revoked row — refused to delete it.
        //
        // Enumerated instead, which is safe because it is keyed by user and
        // `accountFeature` has three members: a handful of rows each.
        if (table === "accountFeatureGrants") {
          for (const user of legacy) {
            // Bounded, and provably enough. At most one grant per feature is
            // transferred, so `regrantedGrantIds` holds at most
            // `ACCOUNT_FEATURES.length` ids for this user. Read one more row than
            // that: if every row read were regranted the count would exceed the
            // maximum, so any full page contains a blocker, and a short page is
            // the user's entire grant set.
            //
            // The previous version read the whole history, which is unbounded —
            // `grant` inserts again after expiry and `revoke` keeps the old row.
            const grants = await ctx.db
              .query("accountFeatureGrants")
              .withIndex("by_userId_feature_state", (q) => q.eq("userId", user._id))
              .take(ACCOUNT_FEATURES.length + 1);

            if (grants.some((grant) => !regrantedGrantIds.has(grant._id))) {
              block(user._id, `${table}.${field}`);
            }
          }

          continue;
        }

        // Existence, not enumeration: one keyed probe per legacy user, which is a
        // handful of reads regardless of how large the table has grown. The
        // report names what blocks a row, not how many times.
        for (const user of legacy) {
          // `table` is a union, so TypeScript intersects the index names valid
          // for every member and is left with `by_id`/`by_creation_time`. It
          // cannot express "this index belongs to this table" across a loop.
          // Narrowed here rather than with `any`, and the pairing is checked for
          // real by `convex-auth-purge.test.ts`, which reads each index out of
          // the schema and asserts it leads with this field — a stronger
          // guarantee than the collapsed union would have given.
          const hit = await (ctx.db.query(table) as unknown as IndexedTableQuery)
            .withIndex(index, (q) => q.eq(field, user._id))
            .first();

          if (hit !== null) {
            block(user._id, `${table}.${field}`);
          }
        }
      }
    }

    const deletableUsers = legacy.filter((user) => !blocked.has(user._id));
    const clearedTables: Record<string, number> = {};

    // Bounded per invocation, because this is the one part that scales with
    // history rather than with entity count: a deployment that ran Convex Auth
    // for a year holds a session and refresh-token row per sign-in, and reading —
    // let alone deleting — all of them in one transaction exceeds Convex's limits.
    // That would strand the tables permanently, since every retry fails the same
    // way and the schema drop needs them empty.
    //
    // Deleting always from the front means no cursor to carry: rerun until
    // `moreRemaining` is false.
    let budget = PURGE_BATCH;

    for (const table of CONVEX_AUTH_TABLES) {
      const rows = await ctx.db.query(table).take(budget);
      clearedTables[table] = rows.length;
      budget -= rows.length;

      if (!dryRun) {
        await Promise.all(rows.map((row) => ctx.db.delete(row._id)));
      }

      if (budget <= 0) {
        break;
      }
    }

    // Users last, and only once the tables above fit in one pass. Deleting a
    // legacy `users` row while `authAccounts` rows still reference it would leave
    // exactly the dangling reference the whole reference scan exists to prevent —
    // for the duration of however many reruns the tables take.
    const usersDeferred = budget <= 0;

    if (!dryRun && !usersDeferred) {
      await Promise.all(deletableUsers.map((user) => ctx.db.delete(user._id)));
    }

    // One extra beyond the cap, purely to know whether the list is the whole set.
    const clerkUserPage =
      legacy.length === 0
        ? []
        : await ctx.db
            .query("users")
            .withIndex("clerkUserId", (q) => q.gt("clerkUserId", undefined))
            .take(CLERK_USER_REPORT_LIMIT + 1);

    const authorityPage = await ctx.db
      .query("communityAuthorities")
      .take(STALE_AUTHORITY_SCAN_LIMIT + 1);
    const staleAuthorities =
      currentIssuer === "" || authorityPage.length > STALE_AUTHORITY_SCAN_LIMIT
        ? null
        : authorityPage.filter(
            (authority) => authority.state === "active" && authority.subject.issuer !== currentIssuer,
          ).length;

    return {
      dryRun,
      clearedTables,
      // True when the batch budget ran out *or* pages remain. Rerun passing
      // `nextLegacyCursor` back as `legacyCursor` until this is false; the
      // regrant is idempotent because a moved grant no longer sits on a legacy
      // row.
      moreRemaining: usersDeferred || moreLegacy,
      // Where to resume, for destructive runs as much as dry ones.
      //
      // Destructive runs used to be told to rerun from the beginning, on the
      // reasoning that deleting rows advances the page by itself. That is only
      // true when rows are actually deleted: a page where every legacy row is
      // blocked deletes nothing, so the same page comes back forever while
      // `moreLegacy` stays true, and later deletable rows are never reached.
      // Fifty blocked rows were enough to wedge the documented loop permanently.
      //
      // A cursor-driven walk advances regardless of what any page contains, and
      // it also removes the earlier hazard it was guarding against: skipping rows
      // now requires inventing a cursor rather than carrying a real one, because
      // every walk starts at null and moves forward.
      //
      // Held in place when the delete budget ran out. Those rows were examined
      // but not deleted, so advancing past them would leave them behind while
      // the walk reported itself finished.
      nextLegacyCursor: tagCursor(
        dryRun,
        // Held in place only when a *destructive* pass ran out of delete budget:
        // those rows were examined but not deleted, and advancing past them would
        // leave them behind while the walk reported itself finished.
        //
        // A dry run deletes nothing, so its budget is always spent on counting
        // and `usersDeferred` is always true once the auth tables exceed one
        // batch. Holding the cursor for it would pin discovery to the first page
        // forever — the exact failure the cursor was added to remove.
        !dryRun && usersDeferred
          ? rawCursor
          : moreLegacy
            ? legacyPage.continueCursor
            : null,
      ),
      // False whenever any legacy row survives, blocked or merely unreached. The
      // walk ending is not the same as the purge being finished: a page's
      // blockers are reported and then the cursor moves past them, so a walk can
      // reach its end with rows still present. Resolve the references, then start
      // a *new* walk from no cursor — the rows are behind this one.
      //
      // This is the flag the schema tightening depends on, not `moreRemaining`.
      purgeComplete:
        !dryRun &&
        !usersDeferred &&
        !moreLegacy &&
        (
          await ctx.db
            .query("users")
            .withIndex("clerkUserId", (q) => q.eq("clerkUserId", undefined))
            .take(1)
        ).length === 0,
      legacyUsers: legacy.length,
      deletedUsers: usersDeferred ? [] : deletableUsers.map((user) => user.email ?? user._id),
      regrantedGrants: regranted,
      // Non-empty means those rows survive on purpose. Resolve each reference
      // before rerunning; the schema drop stays blocked until this is empty.
      //
      // Keys are full `users._id` values, which is where `regrantGrantsFrom`
      // comes from: run once with no regrant arguments, read the blocked row out
      // of this, run again naming it. That is deliberately the only supported
      // way to find it — an operator who has not seen what a row is referenced by
      // should not be reassigning its privileges.
      blockedUsers: Object.fromEntries(blocked),
      // The other half of that round trip. Reported so the two ids the real run
      // needs both come out of the dry run, rather than sending someone to read
      // truncated cells in the dashboard and retype them.
      //
      // Only when there is something to regrant, and capped: this is a
      // convenience for finding your own account on a deployment with a few, not
      // a directory. `clerkUserId` sorts after `undefined` on the index, so this
      // reads Clerk rows only and never walks the legacy ones.
      clerkUsers: clerkUserPage
        .slice(0, CLERK_USER_REPORT_LIMIT)
        .map((user) => ({ clerkUserId: user.clerkUserId, email: user.email })),
      // Says so when the list is a sample rather than the set. Without this an
      // operator whose account fell outside the cap sees a list that does not
      // contain them and no indication that one exists — for the field the
      // runbook tells them to pick `regrantGrantsToClerkUserId` out of. When
      // true, read the id off Clerk's dashboard instead; it does not have to come
      // from here, it only usually can.
      clerkUsersTruncated: clerkUserPage.length > CLERK_USER_REPORT_LIMIT,
      // Keyed by token identifier rather than `users._id`, so these never block
      // the purge — but the issuer change stopped them matching their owners, and
      // nothing can derive which Clerk subject a Convex Auth one was. They have
      // to be re-granted by hand.
      //
      // Only active rows issued under a *different* issuer are reported. A count
      // of every row would sweep in revoked authorities and ones granted after
      // the cutover, and the runbook says to re-grant what appears here — so a
      // raw count would have someone restoring capabilities that were
      // deliberately revoked, or duplicating a grant that already works.
      //
      // Null rather than a number whenever the answer would be a guess: when the
      // issuer is unset, and when the table is longer than one bounded read.
      // Comparing against "" would mark every active authority stale, and
      // reporting the count from a truncated page would undercount — both are
      // plausible-looking numbers that are wrong, which is the failure this field
      // was already corrected for once.
      //
      // Bounded because it is informational and the purge is not. An unbounded
      // read here fails the whole mutation, so a deployment with enough authority
      // history could never delete a single row on account of a diagnostic.
      staleCommunityAuthorities: staleAuthorities,
    };
  },
});

// ---------------------------------------------------------------------------
// One-off identity reassignment, for the case the purge deliberately refuses.
//
// `ensureUser` binds a Clerk identity by inserting a *new* `users` row rather
// than adopting a legacy one, because nothing can derive which pre-cutover row a
// Clerk subject corresponds to. When the same person signed in before and after
// the cutover, their footprint therefore sits on a row nobody can authenticate
// as: on production that is `basicbit`, owned by the legacy row with an active
// `profileOwners` record, so the owner cannot edit their own profile.
//
// `purgeConvexAuthLeftovers` correctly refuses to delete such a row — deleting it
// would leave a dangling `v.id("users")` that reads as valid and resolves to
// nothing. This moves the footprint instead, which is what makes the row
// deletable and the purge completable.
//
// Deliberately a separate function from the purge's regrant. That one moves live
// `accountFeatureGrants` and nothing else, because "move every grant on every
// legacy row" is a privilege-escalation primitive. This is the opposite
// operation: an operator asserting that two rows are one person and merging
// them, with both ends named. Keeping them apart keeps the purge's narrow rule
// narrow.
//
// What it does NOT touch, on purpose:
//
// - `authSubject`-keyed rows. Nineteen tables carry them, and they are not
//   `v.id("users")` references. The two that govern authorization —
//   `communityAuthorities.subjectTokenIdentifier` and `events.submitter` via
//   `isSameAuthSubject` — were verified empty on production before this was
//   written; re-verify rather than assume. The rest are audit trails
//   (`profileAuditEvents` and friends) recording what a subject actually did, and
//   rewriting them would falsify history rather than repair ownership.
// - Any field other than the user reference. No `updatedAt` bump: these rows did
//   not change state, their owner was corrected.
export const reassignLegacyUserReferences = internalMutation({
  args: {
    // Both ends named, neither inferred — the same rule the regrant follows, for
    // the same reason. Matching by email would make this "whoever holds the
    // address inherits the profile".
    fromUserId: v.id("users"),
    toClerkUserId: v.string(),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;

    const source = await ctx.db.get(args.fromUserId);

    if (source === null) {
      throw new Error(`fromUserId ${args.fromUserId} does not exist.`);
    }

    if (source.clerkUserId !== undefined) {
      throw new Error(
        `fromUserId ${args.fromUserId} carries a clerkUserId, so it is reachable by signing in. This moves a footprint off an unreachable row; it is not a way to merge two live accounts.`,
      );
    }

    const target = await ctx.db
      .query("users")
      .withIndex("clerkUserId", (q) => q.eq("clerkUserId", args.toClerkUserId))
      .unique();

    if (target === null) {
      throw new Error(
        `No users row carries clerkUserId ${args.toClerkUserId}. Sign in through Clerk first so ensureUser provisions one.`,
      );
    }

    const moved: Record<string, number> = {};
    // What the destination already holds, per table. A reassignment can create a
    // logical duplicate — two `profileOwners` rows for one profile, two billing
    // mappings for one user — and Convex enforces no uniqueness, so nothing would
    // reject it. Reported rather than guessed at, so a dry run shows the collision
    // before a real run creates it.
    const targetAlreadyHas: Record<string, number> = {};

    for (const [table, field, index] of USER_REFERENCES) {
      const rows = await (ctx.db.query(table) as unknown as IndexedTableQuery)
        .withIndex(index, (q) => q.eq(field, args.fromUserId))
        .collect();

      if (rows.length > 0) {
        moved[`${table}.${field}`] = rows.length;
      }

      const existing = await (ctx.db.query(table) as unknown as IndexedTableQuery)
        .withIndex(index, (q) => q.eq(field, target._id))
        .collect();

      if (existing.length > 0) {
        targetAlreadyHas[`${table}.${field}`] = existing.length;
      }

      if (!dryRun) {
        // Same narrowing as the probe above: the row ids come back as strings
        // because `IndexedTableQuery` erases the table, and `patch` wants the
        // branded `Id`. The pairing is what `convex-auth-purge.test.ts` checks.
        await Promise.all(
          rows.map((row) =>
            ctx.db.patch(row._id as Id<"users">, { [field]: target._id } as never),
          ),
        );
      }
    }

    return {
      dryRun,
      from: source.email ?? source._id,
      to: { clerkUserId: target.clerkUserId, email: target.email },
      moved,
      targetAlreadyHas,
      // Left in place by design. Non-zero here is not a failure, it is the audit
      // trail staying truthful — but it does mean the legacy *subject* is still
      // referenced somewhere, which `purgeConvexAuthLeftovers` does not care about
      // because those are not `v.id("users")` fields.
      authorizationSubjectsLeft: {
        communityAuthorities: (await ctx.db.query("communityAuthorities").take(50)).filter(
          (authority) => authority.subject.subject.startsWith(args.fromUserId),
        ).length,
        events: (await ctx.db.query("events").take(50)).filter((event) =>
          (event.submitter?.subject ?? "").startsWith(args.fromUserId),
        ).length,
      },
    };
  },
});
