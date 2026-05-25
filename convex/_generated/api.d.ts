/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as _profilePermissions from "../_profilePermissions.js";
import type * as _profilePublic from "../_profilePublic.js";
import type * as _profileSlugs from "../_profileSlugs.js";
import type * as _profileStates from "../_profileStates.js";
import type * as _profileSubmissions from "../_profileSubmissions.js";
import type * as _profileWorldCredits from "../_profileWorldCredits.js";
import type * as _worldEvents from "../_worldEvents.js";
import type * as _worldIds from "../_worldIds.js";
import type * as _worldPublic from "../_worldPublic.js";
import type * as _worldSlugs from "../_worldSlugs.js";
import type * as health from "../health.js";
import type * as profiles from "../profiles.js";
import type * as worlds from "../worlds.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  _profilePermissions: typeof _profilePermissions;
  _profilePublic: typeof _profilePublic;
  _profileSlugs: typeof _profileSlugs;
  _profileStates: typeof _profileStates;
  _profileSubmissions: typeof _profileSubmissions;
  _profileWorldCredits: typeof _profileWorldCredits;
  _worldEvents: typeof _worldEvents;
  _worldIds: typeof _worldIds;
  _worldPublic: typeof _worldPublic;
  _worldSlugs: typeof _worldSlugs;
  health: typeof health;
  profiles: typeof profiles;
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
