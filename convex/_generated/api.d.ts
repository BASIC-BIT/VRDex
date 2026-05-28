/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as _communityAuthority from "../_communityAuthority.js";
import type * as _eventInputs from "../_eventInputs.js";
import type * as _eventPublic from "../_eventPublic.js";
import type * as _eventSlugs from "../_eventSlugs.js";
import type * as _profilePermissions from "../_profilePermissions.js";
import type * as _profilePublic from "../_profilePublic.js";
import type * as _profileSlugs from "../_profileSlugs.js";
import type * as _profileStates from "../_profileStates.js";
import type * as _profileSubmissions from "../_profileSubmissions.js";
import type * as _profileWorldCredits from "../_profileWorldCredits.js";
import type * as _publicFields from "../_publicFields.js";
import type * as _searchDocuments from "../_searchDocuments.js";
import type * as _vocabulary from "../_vocabulary.js";
import type * as _worldEvents from "../_worldEvents.js";
import type * as _worldIds from "../_worldIds.js";
import type * as _worldPublic from "../_worldPublic.js";
import type * as _worldSlugs from "../_worldSlugs.js";
import type * as events from "../events.js";
import type * as health from "../health.js";
import type * as migrations from "../migrations.js";
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
  _communityAuthority: typeof _communityAuthority;
  _eventInputs: typeof _eventInputs;
  _eventPublic: typeof _eventPublic;
  _eventSlugs: typeof _eventSlugs;
  _profilePermissions: typeof _profilePermissions;
  _profilePublic: typeof _profilePublic;
  _profileSlugs: typeof _profileSlugs;
  _profileStates: typeof _profileStates;
  _profileSubmissions: typeof _profileSubmissions;
  _profileWorldCredits: typeof _profileWorldCredits;
  _publicFields: typeof _publicFields;
  _searchDocuments: typeof _searchDocuments;
  _vocabulary: typeof _vocabulary;
  _worldEvents: typeof _worldEvents;
  _worldIds: typeof _worldIds;
  _worldPublic: typeof _worldPublic;
  _worldSlugs: typeof _worldSlugs;
  events: typeof events;
  health: typeof health;
  migrations: typeof migrations;
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

export declare const components: {};
