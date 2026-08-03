import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";

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
// The third element is an index whose *leading* column is that field, or null.
// With one, the check is a keyed existence probe per legacy user. Without one it
// is a full scan, so the eight entries carrying null are exactly the ones that
// must stay bounded by entity count rather than by request volume: applications,
// their secrets, community credentials, profile links, handoff invitations,
// prewarm leases, and who revoked a token. Every table that grows per request —
// `apiWriteAuditEvents`, `mcpToolEvents`, `apiTokenEvents`, `oauthClientEvents`,
// `oauthAccessTokens` — has an index here, which is why `oauthAccessTokens`
// gained `by_userId` in `schema.ts`: it was the one unbounded table with no way
// to look a user up.
//
// `tests/backend/convex-auth-purge.test.ts` checks each named index exists in
// the schema and leads with that field, because a wrong name is a runtime throw
// in the middle of a purge rather than a type error.
export const USER_REFERENCES = [
  ["accountFeatureGrants", "userId", "by_userId_feature_state"],
  ["apiTokenEvents", "ownerUserId", "by_ownerUserId_createdAt"],
  ["apiTokens", "ownerUserId", "by_ownerUserId_createdAt"],
  ["apiTokens", "revokedByUserId", null],
  ["apiWriteAuditEvents", "ownerUserId", "by_ownerUserId_createdAt"],
  ["billingCustomerMappings", "userId", "by_userId_state"],
  ["billingEntitlementSnapshots", "userId", "by_userId_entitlementKey_status"],
  ["billingSubscriptionSnapshots", "userId", "by_userId_status"],
  ["communityVrclinkingCredentials", "delegatedByUserId", null],
  ["discordVerificationStates", "userId", "by_userId_createdAt"],
  ["discordVerificationWatermarks", "userId", "by_userId_discordUserId"],
  ["externalControlProofs", "userId", "by_userId_assetType_assetExternalId"],
  ["mcpEventWriteReceipts", "ownerUserId", "by_owner_client_tool_key"],
  ["mcpToolEvents", "ownerUserId", "by_ownerUserId_createdAt"],
  ["oauthAccessTokens", "userId", "by_userId"],
  ["oauthApplicationSecrets", "revokedByUserId", null],
  ["oauthApplications", "ownerUserId", "by_ownerUserId_createdAt"],
  ["oauthApplications", "revokedByUserId", null],
  ["oauthAuthorizationCodes", "userId", "by_userId_createdAt"],
  ["oauthClientEvents", "ownerUserId", "by_ownerUserId_createdAt"],
  ["oauthConsentTransactions", "userId", "by_userId_expiresAt"],
  ["oauthRefreshTokens", "userId", "by_userId_expiresAt"],
  ["profileAssetAccessibilityGenerationEvents", "userId", "by_userId_createdAt"],
  ["profileClaimRequests", "userId", "by_userId_state"],
  ["profileExternalLinks", "linkedByUserId", null],
  ["profileOwners", "userId", "by_userId_state"],
  ["profileVerificationAttempts", "userId", "by_userId_state"],
  ["seedHandoffInvitations", "acceptedByUserId", null],
  ["temporalParseJobs", "ownerUserId", "by_ownerUserId_idempotencyKeyHash"],
  ["temporalParsingPreferences", "userId", "by_userId"],
  ["temporalPrewarmLeases", "ownerUserId", null],
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

/** Just enough of a Convex query to probe one index for one value. */
type IndexedTableQuery = {
  withIndex: (
    index: string,
    build: (q: { eq: (field: string, value: string) => unknown }) => unknown,
  ) => { first: () => Promise<{ _id: string } | null> };
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
    const legacyPage = await ctx.db
      .query("users")
      .withIndex("clerkUserId", (q) => q.eq("clerkUserId", undefined))
      .take(LEGACY_USER_PAGE + 1);
    const moreLegacy = legacyPage.length > LEGACY_USER_PAGE;
    const legacy = moreLegacy ? legacyPage.slice(0, LEGACY_USER_PAGE) : legacyPage;
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

      // A Clerk row is the only valid destination. Naming a legacy row would
      // move the grants onto something this same run then deletes.
      if (!legacyIds.has(args.regrantGrantsFrom as string)) {
        throw new Error(
          `regrantGrantsFrom ${args.regrantGrantsFrom} is not a legacy users row. Only rows without a clerkUserId are purged, so only their grants need moving.`,
        );
      }

      regrantTarget = target._id;
    }

    // Re-point before scanning, so a grant that moved off a legacy row stops
    // counting as a reason to keep it.
    const regranted: string[] = [];

    if (regrantTarget !== undefined) {
      const grants = await ctx.db
        .query("accountFeatureGrants")
        .withIndex("by_userId_feature_state", (q) => q.eq("userId", args.regrantGrantsFrom as Id<"users">))
        .collect();

      for (const grant of grants) {
        // Revoked grants stay put and block. Moving one would write a history
        // in which the Clerk account held and lost a feature it never had, and
        // deleting one would discard the record of a revocation.
        if (grant.state !== "active") {
          continue;
        }

        regranted.push(`${grant.feature}:${grant._id}`);

        if (!dryRun) {
          await ctx.db.patch(grant._id, { userId: regrantTarget, updatedAt: Date.now() });
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
            const grants = await ctx.db
              .query("accountFeatureGrants")
              .withIndex("by_userId_feature_state", (q) => q.eq("userId", user._id))
              .collect();

            if (grants.some((grant) => !regrantedGrantIds.has(grant._id))) {
              block(user._id, `${table}.${field}`);
            }
          }

          continue;
        }

        if (index !== null) {
          // Existence, not enumeration: one keyed probe per legacy user, which is
          // a handful of reads regardless of how large the table has grown. The
          // report names what blocks a row, not how many times.
          for (const user of legacy) {
            // `table` is a union, so TypeScript intersects the index names valid
            // for every member and is left with `by_id`/`by_creation_time`. It
            // cannot express "this index belongs to this table" across a loop.
            // Narrowed here rather than with `any`, and the pairing is checked
            // for real by `convex-auth-purge.test.ts`, which reads each index out
            // of the schema and asserts it leads with this field — a stronger
            // guarantee than the collapsed union would have given.
            const hit = await (ctx.db.query(table) as unknown as IndexedTableQuery)
              .withIndex(index, (q) => q.eq(field, user._id))
              .first();

            if (hit !== null) {
              block(user._id, `${table}.${field}`);
            }
          }

          continue;
        }

        // No index leads with this field. Every such table is bounded by entity
        // count rather than request volume, so a scan stays small — and `collect`
        // throws past the transaction limit rather than silently returning a
        // prefix, so an unforeseen one fails the purge instead of under-reporting
        // references and deleting a row that still has them.
        for (const row of await ctx.db.query(table).collect()) {
          const value = (row as Record<string, unknown>)[field];

          if (typeof value === "string" && legacyIds.has(value)) {
            block(value, `${table}.${field}`);
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
      // True when the batch budget ran out *or* legacy rows remain beyond this
      // page. Rerun with the same arguments until it is false; the regrant is
      // idempotent because a moved grant no longer sits on a legacy row.
      moreRemaining: usersDeferred || moreLegacy,
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
      clerkUsers:
        legacy.length === 0
          ? []
          : (
              await ctx.db
                .query("users")
                .withIndex("clerkUserId", (q) => q.gt("clerkUserId", undefined))
                .take(CLERK_USER_REPORT_LIMIT)
            ).map((user) => ({ clerkUserId: user.clerkUserId, email: user.email })),
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
