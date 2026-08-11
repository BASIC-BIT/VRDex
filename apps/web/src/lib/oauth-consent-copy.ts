const oauthScopeLabels: Record<string, string> = {
  "assets:read": "Read profile asset data",
  "assets:write": "Upload and manage profile assets",
  "community:read": "Read community data",
  "community:write": "Manage your communities",
  "developer:read": "View your developer credentials and OAuth apps",
  "developer:write": "Create, update, and revoke developer credentials and OAuth apps",
  "events:read": "Read event data",
  "events:write": "Create and edit your events",
  "mcp:read": "Read public VRDex data through MCP",
  "mcp:write": "Use VRDex MCP write tools",
  "profile:read": "Read profile data",
  // Copy approved by BASIC on 2026-08-11, alongside the profile write tool
  // descriptions and API problem details added with the MCP profile writes.
  //
  // This line is the boundary between the two profile scopes. `profile:write`
  // promises only the user's own profiles, so reaching a profile they do not
  // own is granted here or not at all; a credential holding just the former is
  // refused with `PROFILE_CONTRIBUTE_SCOPE_REQUIRED`.
  "profile:contribute": "Add and correct community profiles",
  "profile:write": "Edit your profiles",
  "public:read": "Read public API data",
};

export const oauthConsentSummary = "This app is requesting access to your VRDex account.";

export function oauthScopeLabel(scope: string) {
  return oauthScopeLabels[scope] ?? scope;
}
