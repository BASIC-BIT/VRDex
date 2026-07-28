import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();
const convexRoot = path.join(root, "convex");
const webAppRoot = path.join(root, "apps", "web", "src", "app");

function source(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function filesBelow(
  directory: string,
  suffixes: readonly string[] = [".ts"],
): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return filesBelow(absolute, suffixes);
    }

    return entry.isFile() && suffixes.some((suffix) => entry.name.endsWith(suffix))
      ? [absolute]
      : [];
  });
}

function relative(absolutePath: string) {
  return path.relative(root, absolutePath).replaceAll("\\", "/");
}

describe("browser auth-session authorization boundary", () => {
  it("centralizes raw Convex browser identity access in reviewed auth modules", () => {
    const approvedGetAuthUserId = new Set([
      "convex/_authSessionGuard.ts",
      "convex/accountSessions.ts",
      "convex/recentAuthChallenges.ts",
    ]);
    const approvedIdentityReads = new Set([
      "convex/_browserSessionAuthority.ts",
    ]);

    for (const file of filesBelow(convexRoot)) {
      const name = relative(file);
      const contents = fs.readFileSync(file, "utf8");

      if (/\bgetAuthUserId\s*\(/.test(contents)) {
        assert.ok(
          approvedGetAuthUserId.has(name),
          `${name} must use requireActiveAuthSession instead of getAuthUserId`,
        );
      }

      if (/ctx\.auth\.getUserIdentity\s*\(/.test(contents)) {
        assert.ok(
          approvedIdentityReads.has(name),
          `${name} must use _browserSessionAuthority instead of reading the browser identity directly`,
        );
      }
    }
  });

  it("prevents eligible modules from bypassing the active-session guard through account helpers", () => {
    const approvedLegacyAccountAuthority = new Set([
      "convex/accounts.ts",
      "convex/accountSessions.ts",
      "convex/apiTokens.ts",
      "convex/oauthApps.ts",
    ]);

    for (const file of filesBelow(convexRoot)) {
      const name = relative(file);
      const contents = fs.readFileSync(file, "utf8");

      if (
        /\b(?:getCurrentUser|requireCurrentUser|requireVerifiedEmailUser)\s*\(/.test(
          contents,
        )
      ) {
        assert.ok(
          approvedLegacyAccountAuthority.has(name),
          `${name} must authorize browser work through requireActiveAuthSession`,
        );
      }
    }
  });

  it("guards every browser-authenticated Convex action before external work", () => {
    const actionInventory = new Map<string, string[]>([
      [
        "convex/accountSessions.ts",
        [
          "internal.accountSessions.authorizeAndBeginOwnedSessionRevocation",
          "requireRecentAuthSession(ctx)",
        ],
      ],
      [
        // Purpose-scoped Discord OAuth round-trip: every action here reads the
        // browser session before it exchanges a code or touches Discord.
        "convex/discordVerification.ts",
        [
          // Name the guarded mutations the actions call, not just the guard
          // helper: the helper appears in this file's internalMutations, so a
          // marker on it alone would be satisfied by a string that is not on
          // the path an action takes before it reaches Discord.
          "internal.discordVerification.consumeVerificationState",
          "internal.discordVerification.createVerificationState",
          "requireVerifiedActiveBrowserSession(ctx)",
        ],
      ],
      [
        "convex/profileClaims.ts",
        [
          "internal.profileClaims.getDiscordCommunityClaimForAdapter",
          "internal.profileClaims.getVerificationAttemptForAdapter",
          "requireVerifiedActiveBrowserSession(ctx)",
        ],
      ],
      [
        "convex/recentAuthPassword.ts",
        [
          "internal.recentAuthChallenges.validatePasswordVerification",
          "internal.recentAuthChallenges.verifyPassword",
        ],
      ],
    ]);
    const publicActionFiles = filesBelow(convexRoot)
      .filter((file) => /\baction\s*\(\s*\{/.test(fs.readFileSync(file, "utf8")))
      .map(relative)
      .sort();

    assert.deepEqual(publicActionFiles, [...actionInventory.keys()].sort());

    for (const [file, requiredMarkers] of actionInventory) {
      const contents = source(file);

      for (const marker of requiredMarkers) {
        assert.match(contents, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      }
    }
  });

  it("keeps the Convex HTTP router free of browser-session authority", () => {
    const contents = source("convex/http.ts");

    assert.doesNotMatch(
      contents,
      /getAuthUserId|ctx\.auth\.getUserIdentity|requireActiveAuthSession|convexAuthNextjsToken/,
    );
  });

  it("inventories every Next route or server page that forwards a browser JWT to Convex", () => {
    const inventory = new Map<string, string>([
      [
        "apps/web/src/app/api/account/media-kit/[profileId]/accessibility-description/route.ts",
        "api.profileAssets.claimOwnedAccessibilityGeneration",
      ],
      [
        "apps/web/src/app/api/account/media-kit/[profileId]/assets/[assetId]/file/route.ts",
        "api.profileAssets.getOwnedAssetForStorage",
      ],
      [
        "apps/web/src/app/api/developer/oauth-apps/route.ts",
        "api.oauthApps.createPersonalApplication",
      ],
      [
        "apps/web/src/app/api/developer/tokens/route.ts",
        "api.apiTokens.createPersonalToken",
      ],
      [
        "apps/web/src/app/api/discord/verify/callback/route.ts",
        "api.discordVerification.completeGuildVerification",
      ],
      [
        "apps/web/src/app/api/discord/verify/start/route.ts",
        "api.discordVerification.startGuildVerification",
      ],
      [
        "apps/web/src/app/api/time/parse/[continuationToken]/route.ts",
        "activeAuthSessionViewerQuery",
      ],
      [
        "apps/web/src/app/api/time/parse/route.ts",
        "activeAuthSessionViewerQuery",
      ],
      [
        "apps/web/src/app/api/time/prewarm/route.ts",
        "activeAuthSessionViewerQuery",
      ],
      [
        "apps/web/src/app/auth/reauth/cancel/route.ts",
        "cancelRecentAuthChallengeMutation",
      ],
      [
        "apps/web/src/app/auth/reauth/complete/route.ts",
        "activeAuthSessionViewerQuery",
      ],
      [
        "apps/web/src/app/auth/reauth/fail/route.ts",
        "failRecentAuthChallengeMutation",
      ],
      [
        "apps/web/src/app/auth/reauth/start/route.ts",
        "beginRecentAuthChallengeMutation",
      ],
      [
        "apps/web/src/app/auth/session-converge/route.ts",
        "activeAuthSessionViewerQuery",
      ],
      [
        "apps/web/src/app/oauth/authorize/consent/route.ts",
        "activeAuthSessionViewerQuery",
      ],
      [
        "apps/web/src/app/oauth/authorize/review/page.tsx",
        "api.oauthConsentTransactions.get",
      ],
      [
        "apps/web/src/app/oauth/authorize/route.ts",
        "activeAuthSessionViewerQuery",
      ],
    ]);
    const browserJwtFiles = filesBelow(webAppRoot, [".ts", ".tsx"])
      .filter((file) =>
        fs.readFileSync(file, "utf8").includes("convexAuthNextjsToken"),
      )
      .map(relative)
      .sort();

    assert.deepEqual(browserJwtFiles, [...inventory.keys()].sort());

    for (const [file, guardedCall] of inventory) {
      assert.match(source(file), new RegExp(guardedCall.replaceAll(".", "\\.")));
      if (guardedCall === "activeAuthSessionViewerQuery") {
        assert.match(source(file), /if \(viewer === null\)/);
      }
    }
  });
});
