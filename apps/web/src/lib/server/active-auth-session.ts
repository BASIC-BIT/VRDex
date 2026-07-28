import { makeFunctionReference } from "convex/server";

import type { Id } from "../../../../../convex/_generated/dataModel";

export const activeAuthSessionViewerQuery = makeFunctionReference<
  "query",
  Record<string, never>,
  | {
      sessionId: Id<"authSessions">;
      user: {
        id: Id<"users">;
        name?: string;
        email?: string;
        emailVerified: boolean;
        image?: string;
      };
    }
  | null
>("authSessionAuthority:viewer");

export const revokeAuthSessionMutation = makeFunctionReference<
  "mutation",
  { sessionId: Id<"authSessions"> },
  { current: boolean; revoked: boolean }
>("accountSessions:revokeMine");

export const beginRecentAuthChallengeMutation = makeFunctionReference<
  "mutation",
  {
    actionClass:
      | "developer_oauth_application"
      | "developer_token"
      | "session_revocation";
    challengeId: string;
  },
  | {
      originalSessionId: Id<"authSessions">;
      prunedChallengeIds: string[];
      state: "created";
      userId: Id<"users">;
    }
  | { state: "invalid" }
>("recentAuthChallenges:begin");

export const cancelRecentAuthChallengeMutation = makeFunctionReference<
  "mutation",
  { challengeId: string },
  null
>("recentAuthChallenges:cancel");

export const failRecentAuthChallengeMutation = makeFunctionReference<
  "mutation",
  { challengeId: string },
  {
    clearAuth: boolean;
    state: "cancelled" | "missing" | "preserved" | "revoked" | "unrelated";
  }
>("recentAuthChallenges:fail");

export const completeRecentAuthChallengeMutation = makeFunctionReference<
  "mutation",
  { bindingConfirmed: boolean; challengeId: string },
  | {
      actionClass:
        | "developer_oauth_application"
        | "developer_token"
        | "session_revocation";
      clearAuth: false;
      state: "completed";
    }
  | {
      clearAuth: boolean;
      state: "already_completed" | "mismatch" | "missing";
    }
>("recentAuthChallenges:complete");
