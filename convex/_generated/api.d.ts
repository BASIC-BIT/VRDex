/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as _accountFeatureModel from "../_accountFeatureModel.js";
import type * as _accountFeatures from "../_accountFeatures.js";
import type * as _apiPlatformObservability from "../_apiPlatformObservability.js";
import type * as _apiRateLimitEvents from "../_apiRateLimitEvents.js";
import type * as _apiTokens from "../_apiTokens.js";
import type * as _apiWriteAuditEvents from "../_apiWriteAuditEvents.js";
import type * as _billing from "../_billing.js";
import type * as _boundedFetch from "../_boundedFetch.js";
import type * as _browserSessionAuthority from "../_browserSessionAuthority.js";
import type * as _claimErrors from "../_claimErrors.js";
import type * as _claimObservability from "../_claimObservability.js";
import type * as _claimSession from "../_claimSession.js";
import type * as _communityAuthority from "../_communityAuthority.js";
import type * as _communityTelemetry from "../_communityTelemetry.js";
import type * as _communityTelemetryPublic from "../_communityTelemetryPublic.js";
import type * as _delegationCapability from "../_delegationCapability.js";
import type * as _discordTimestamps from "../_discordTimestamps.js";
import type * as _eventCalendarImports from "../_eventCalendarImports.js";
import type * as _eventDiscordExport from "../_eventDiscordExport.js";
import type * as _eventInputs from "../_eventInputs.js";
import type * as _eventMediaControl from "../_eventMediaControl.js";
import type * as _eventOperations from "../_eventOperations.js";
import type * as _eventPaths from "../_eventPaths.js";
import type * as _eventPublic from "../_eventPublic.js";
import type * as _eventSlots from "../_eventSlots.js";
import type * as _eventSlugs from "../_eventSlugs.js";
import type * as _externalControl from "../_externalControl.js";
import type * as _globalSlugs from "../_globalSlugs.js";
import type * as _identity from "../_identity.js";
import type * as _inputValidation from "../_inputValidation.js";
import type * as _mcpToolEvents from "../_mcpToolEvents.js";
import type * as _mcpWriteReceipts from "../_mcpWriteReceipts.js";
import type * as _oauth from "../_oauth.js";
import type * as _oauthConsentTransactions from "../_oauthConsentTransactions.js";
import type * as _previewPersistence from "../_previewPersistence.js";
import type * as _profileAppearance from "../_profileAppearance.js";
import type * as _profileAssets from "../_profileAssets.js";
import type * as _profileClaimCreation from "../_profileClaimCreation.js";
import type * as _profileFieldVisibility from "../_profileFieldVisibility.js";
import type * as _profileLinks from "../_profileLinks.js";
import type * as _profileLookup from "../_profileLookup.js";
import type * as _profileOwnership from "../_profileOwnership.js";
import type * as _profilePermissions from "../_profilePermissions.js";
import type * as _profilePrivacy from "../_profilePrivacy.js";
import type * as _profilePublic from "../_profilePublic.js";
import type * as _profileShareCard from "../_profileShareCard.js";
import type * as _profileSlugs from "../_profileSlugs.js";
import type * as _profileStates from "../_profileStates.js";
import type * as _profileSubmissions from "../_profileSubmissions.js";
import type * as _profileSurfacing from "../_profileSurfacing.js";
import type * as _profileUpdates from "../_profileUpdates.js";
import type * as _profileWorldCredits from "../_profileWorldCredits.js";
import type * as _publicFields from "../_publicFields.js";
import type * as _publicSearch from "../_publicSearch.js";
import type * as _searchDocuments from "../_searchDocuments.js";
import type * as _secureUrl from "../_secureUrl.js";
import type * as _seedAccess from "../_seedAccess.js";
import type * as _seedHandoffs from "../_seedHandoffs.js";
import type * as _seedImportValidators from "../_seedImportValidators.js";
import type * as _seedImports from "../_seedImports.js";
import type * as _shortLinks from "../_shortLinks.js";
import type * as _supportDigest from "../_supportDigest.js";
import type * as _supportEnv from "../_supportEnv.js";
import type * as _supportIntake from "../_supportIntake.js";
import type * as _suppressions from "../_suppressions.js";
import type * as _vocabulary from "../_vocabulary.js";
import type * as _vrcdnLinks from "../_vrcdnLinks.js";
import type * as _vrcdnOutputAccounts from "../_vrcdnOutputAccounts.js";
import type * as _vrchatIdentity from "../_vrchatIdentity.js";
import type * as _vrclinkingSecretRef from "../_vrclinkingSecretRef.js";
import type * as _worldEvents from "../_worldEvents.js";
import type * as _worldIds from "../_worldIds.js";
import type * as _worldPublic from "../_worldPublic.js";
import type * as _worldSlugs from "../_worldSlugs.js";
import type * as accountFeatureGrants from "../accountFeatureGrants.js";
import type * as accounts from "../accounts.js";
import type * as apiPlatformObservability from "../apiPlatformObservability.js";
import type * as apiRateLimitEvents from "../apiRateLimitEvents.js";
import type * as apiTokens from "../apiTokens.js";
import type * as communityTelemetry from "../communityTelemetry.js";
import type * as crons from "../crons.js";
import type * as discordVerification from "../discordVerification.js";
import type * as e2e from "../e2e.js";
import type * as events from "../events.js";
import type * as health from "../health.js";
import type * as hostedSmokeFixtures from "../hostedSmokeFixtures.js";
import type * as http from "../http.js";
import type * as mcpToolEvents from "../mcpToolEvents.js";
import type * as migrations from "../migrations.js";
import type * as oauthApps from "../oauthApps.js";
import type * as oauthConsentTransactions from "../oauthConsentTransactions.js";
import type * as profileArchival from "../profileArchival.js";
import type * as profileAssets from "../profileAssets.js";
import type * as profileClaims from "../profileClaims.js";
import type * as profileConnections from "../profileConnections.js";
import type * as profileIdentity from "../profileIdentity.js";
import type * as profileMediaSubmissions from "../profileMediaSubmissions.js";
import type * as profilePrivacy from "../profilePrivacy.js";
import type * as profiles from "../profiles.js";
import type * as search from "../search.js";
import type * as seedAccess from "../seedAccess.js";
import type * as seedHandoffs from "../seedHandoffs.js";
import type * as seedImports from "../seedImports.js";
import type * as shortLinks from "../shortLinks.js";
import type * as slugAudit from "../slugAudit.js";
import type * as supportRequestDigest from "../supportRequestDigest.js";
import type * as supportRequests from "../supportRequests.js";
import type * as suppressions from "../suppressions.js";
import type * as temporalParsing from "../temporalParsing.js";
import type * as temporalParsingActions from "../temporalParsingActions.js";
import type * as users from "../users.js";
import type * as vrclinkingCredentials from "../vrclinkingCredentials.js";
import type * as worlds from "../worlds.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  _accountFeatureModel: typeof _accountFeatureModel;
  _accountFeatures: typeof _accountFeatures;
  _apiPlatformObservability: typeof _apiPlatformObservability;
  _apiRateLimitEvents: typeof _apiRateLimitEvents;
  _apiTokens: typeof _apiTokens;
  _apiWriteAuditEvents: typeof _apiWriteAuditEvents;
  _billing: typeof _billing;
  _boundedFetch: typeof _boundedFetch;
  _browserSessionAuthority: typeof _browserSessionAuthority;
  _claimErrors: typeof _claimErrors;
  _claimObservability: typeof _claimObservability;
  _claimSession: typeof _claimSession;
  _communityAuthority: typeof _communityAuthority;
  _communityTelemetry: typeof _communityTelemetry;
  _communityTelemetryPublic: typeof _communityTelemetryPublic;
  _delegationCapability: typeof _delegationCapability;
  _discordTimestamps: typeof _discordTimestamps;
  _eventCalendarImports: typeof _eventCalendarImports;
  _eventDiscordExport: typeof _eventDiscordExport;
  _eventInputs: typeof _eventInputs;
  _eventMediaControl: typeof _eventMediaControl;
  _eventOperations: typeof _eventOperations;
  _eventPaths: typeof _eventPaths;
  _eventPublic: typeof _eventPublic;
  _eventSlots: typeof _eventSlots;
  _eventSlugs: typeof _eventSlugs;
  _externalControl: typeof _externalControl;
  _globalSlugs: typeof _globalSlugs;
  _identity: typeof _identity;
  _inputValidation: typeof _inputValidation;
  _mcpToolEvents: typeof _mcpToolEvents;
  _mcpWriteReceipts: typeof _mcpWriteReceipts;
  _oauth: typeof _oauth;
  _oauthConsentTransactions: typeof _oauthConsentTransactions;
  _previewPersistence: typeof _previewPersistence;
  _profileAppearance: typeof _profileAppearance;
  _profileAssets: typeof _profileAssets;
  _profileClaimCreation: typeof _profileClaimCreation;
  _profileFieldVisibility: typeof _profileFieldVisibility;
  _profileLinks: typeof _profileLinks;
  _profileLookup: typeof _profileLookup;
  _profileOwnership: typeof _profileOwnership;
  _profilePermissions: typeof _profilePermissions;
  _profilePrivacy: typeof _profilePrivacy;
  _profilePublic: typeof _profilePublic;
  _profileShareCard: typeof _profileShareCard;
  _profileSlugs: typeof _profileSlugs;
  _profileStates: typeof _profileStates;
  _profileSubmissions: typeof _profileSubmissions;
  _profileSurfacing: typeof _profileSurfacing;
  _profileUpdates: typeof _profileUpdates;
  _profileWorldCredits: typeof _profileWorldCredits;
  _publicFields: typeof _publicFields;
  _publicSearch: typeof _publicSearch;
  _searchDocuments: typeof _searchDocuments;
  _secureUrl: typeof _secureUrl;
  _seedAccess: typeof _seedAccess;
  _seedHandoffs: typeof _seedHandoffs;
  _seedImportValidators: typeof _seedImportValidators;
  _seedImports: typeof _seedImports;
  _shortLinks: typeof _shortLinks;
  _supportDigest: typeof _supportDigest;
  _supportEnv: typeof _supportEnv;
  _supportIntake: typeof _supportIntake;
  _suppressions: typeof _suppressions;
  _vocabulary: typeof _vocabulary;
  _vrcdnLinks: typeof _vrcdnLinks;
  _vrcdnOutputAccounts: typeof _vrcdnOutputAccounts;
  _vrchatIdentity: typeof _vrchatIdentity;
  _vrclinkingSecretRef: typeof _vrclinkingSecretRef;
  _worldEvents: typeof _worldEvents;
  _worldIds: typeof _worldIds;
  _worldPublic: typeof _worldPublic;
  _worldSlugs: typeof _worldSlugs;
  accountFeatureGrants: typeof accountFeatureGrants;
  accounts: typeof accounts;
  apiPlatformObservability: typeof apiPlatformObservability;
  apiRateLimitEvents: typeof apiRateLimitEvents;
  apiTokens: typeof apiTokens;
  communityTelemetry: typeof communityTelemetry;
  crons: typeof crons;
  discordVerification: typeof discordVerification;
  e2e: typeof e2e;
  events: typeof events;
  health: typeof health;
  hostedSmokeFixtures: typeof hostedSmokeFixtures;
  http: typeof http;
  mcpToolEvents: typeof mcpToolEvents;
  migrations: typeof migrations;
  oauthApps: typeof oauthApps;
  oauthConsentTransactions: typeof oauthConsentTransactions;
  profileArchival: typeof profileArchival;
  profileAssets: typeof profileAssets;
  profileClaims: typeof profileClaims;
  profileConnections: typeof profileConnections;
  profileIdentity: typeof profileIdentity;
  profileMediaSubmissions: typeof profileMediaSubmissions;
  profilePrivacy: typeof profilePrivacy;
  profiles: typeof profiles;
  search: typeof search;
  seedAccess: typeof seedAccess;
  seedHandoffs: typeof seedHandoffs;
  seedImports: typeof seedImports;
  shortLinks: typeof shortLinks;
  slugAudit: typeof slugAudit;
  supportRequestDigest: typeof supportRequestDigest;
  supportRequests: typeof supportRequests;
  suppressions: typeof suppressions;
  temporalParsing: typeof temporalParsing;
  temporalParsingActions: typeof temporalParsingActions;
  users: typeof users;
  vrclinkingCredentials: typeof vrclinkingCredentials;
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
