/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as _authRedirects from "../_authRedirects.js";
import type * as _communityAuthority from "../_communityAuthority.js";
import type * as _discordTimestamps from "../_discordTimestamps.js";
import type * as _eventInputs from "../_eventInputs.js";
import type * as _eventMediaControl from "../_eventMediaControl.js";
import type * as _eventPublic from "../_eventPublic.js";
import type * as _eventSlots from "../_eventSlots.js";
import type * as _eventSlugs from "../_eventSlugs.js";
import type * as _profileAssets from "../_profileAssets.js";
import type * as _profileFieldVisibility from "../_profileFieldVisibility.js";
import type * as _profileLookup from "../_profileLookup.js";
import type * as _profileOwnership from "../_profileOwnership.js";
import type * as _profilePermissions from "../_profilePermissions.js";
import type * as _profilePublic from "../_profilePublic.js";
import type * as _profileSlugs from "../_profileSlugs.js";
import type * as _profileStates from "../_profileStates.js";
import type * as _profileSubmissions from "../_profileSubmissions.js";
import type * as _profileWorldCredits from "../_profileWorldCredits.js";
import type * as _publicFields from "../_publicFields.js";
import type * as _searchDocuments from "../_searchDocuments.js";
import type * as _vocabulary from "../_vocabulary.js";
import type * as _vrcdnLinks from "../_vrcdnLinks.js";
import type * as _vrcdnOutputAccounts from "../_vrcdnOutputAccounts.js";
import type * as _worldEvents from "../_worldEvents.js";
import type * as _worldIds from "../_worldIds.js";
import type * as _worldPublic from "../_worldPublic.js";
import type * as _worldSlugs from "../_worldSlugs.js";
import type * as accounts from "../accounts.js";
import type * as auth from "../auth.js";
import type * as e2e from "../e2e.js";
import type * as events from "../events.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as migrations from "../migrations.js";
import type * as profileAssets from "../profileAssets.js";
import type * as profileClaims from "../profileClaims.js";
import type * as profiles from "../profiles.js";
import type * as search from "../search.js";
import type * as suppressions from "../suppressions.js";
import type * as worlds from "../worlds.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  _authRedirects: typeof _authRedirects;
  _communityAuthority: typeof _communityAuthority;
  _discordTimestamps: typeof _discordTimestamps;
  _eventInputs: typeof _eventInputs;
  _eventMediaControl: typeof _eventMediaControl;
  _eventPublic: typeof _eventPublic;
  _eventSlots: typeof _eventSlots;
  _eventSlugs: typeof _eventSlugs;
  _profileAssets: typeof _profileAssets;
  _profileFieldVisibility: typeof _profileFieldVisibility;
  _profileLookup: typeof _profileLookup;
  _profileOwnership: typeof _profileOwnership;
  _profilePermissions: typeof _profilePermissions;
  _profilePublic: typeof _profilePublic;
  _profileSlugs: typeof _profileSlugs;
  _profileStates: typeof _profileStates;
  _profileSubmissions: typeof _profileSubmissions;
  _profileWorldCredits: typeof _profileWorldCredits;
  _publicFields: typeof _publicFields;
  _searchDocuments: typeof _searchDocuments;
  _vocabulary: typeof _vocabulary;
  _vrcdnLinks: typeof _vrcdnLinks;
  _vrcdnOutputAccounts: typeof _vrcdnOutputAccounts;
  _worldEvents: typeof _worldEvents;
  _worldIds: typeof _worldIds;
  _worldPublic: typeof _worldPublic;
  _worldSlugs: typeof _worldSlugs;
  accounts: typeof accounts;
  auth: typeof auth;
  e2e: typeof e2e;
  events: typeof events;
  health: typeof health;
  http: typeof http;
  migrations: typeof migrations;
  profileAssets: typeof profileAssets;
  profileClaims: typeof profileClaims;
  profiles: typeof profiles;
  search: typeof search;
  suppressions: typeof suppressions;
  worlds: typeof worlds;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  migrations: {
    lib: {
      cancel: FunctionReference<
        "mutation",
        "internal",
        { name: string },
        {
          batchSize?: number;
          cursor?: string | null;
          error?: string;
          isDone: boolean;
          latestEnd?: number;
          latestStart: number;
          name: string;
          next?: Array<string>;
          processed: number;
          state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
        }
      >;
      cancelAll: FunctionReference<
        "mutation",
        "internal",
        { sinceTs?: number },
        Array<{
          batchSize?: number;
          cursor?: string | null;
          error?: string;
          isDone: boolean;
          latestEnd?: number;
          latestStart: number;
          name: string;
          next?: Array<string>;
          processed: number;
          state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
        }>
      >;
      clearAll: FunctionReference<
        "mutation",
        "internal",
        { before?: number },
        null
      >;
      getStatus: FunctionReference<
        "query",
        "internal",
        { limit?: number; names?: Array<string> },
        Array<{
          batchSize?: number;
          cursor?: string | null;
          error?: string;
          isDone: boolean;
          latestEnd?: number;
          latestStart: number;
          name: string;
          next?: Array<string>;
          processed: number;
          state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
        }>
      >;
      migrate: FunctionReference<
        "mutation",
        "internal",
        {
          batchSize?: number;
          cursor?: string | null;
          dryRun: boolean;
          fnHandle: string;
          name: string;
          next?: Array<{ fnHandle: string; name: string }>;
          oneBatchOnly?: boolean;
          reset?: boolean;
        },
        {
          batchSize?: number;
          cursor?: string | null;
          error?: string;
          isDone: boolean;
          latestEnd?: number;
          latestStart: number;
          name: string;
          next?: Array<string>;
          processed: number;
          state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
        }
      >;
    };
  };
};
