---
name: vrdex-manual-profile-ops
description: Safely perform manual VRDex profile data operations before durable admin/MCP tooling exists, including consented concierge profile creation or correction, bios, aliases, genres, links, public surfacing, avatars, profile images, media-kit assets, and production Convex/S3 operator workflows.
compatibility: opencode
metadata:
  audience: maintainers
  domain: operations
---

## Goal

Perform narrow, reversible manual profile edits without leaking private user data or leaving temporary operator code deployed.

Use this only when product/admin tooling does not yet cover the operation. Prefer existing public or owner-authenticated mutations whenever they are sufficient.

## Guardrails

- Confirm the target environment before every write. Production profile, asset, IAM, billing, or provider mutations need explicit human approval.
- Confirm the data source and consent for personal profile data. Do not commit private profile data, Discord IDs, deploy keys, image files, upload tokens, or one-off payloads to the public repo.
- Keep temporary payloads under ignored local storage such as `C:\tmp` and delete them after verification.
- Keep temporary Convex operator mutations untracked or in a short-lived branch only while executing the operation. Delete and redeploy after the data change succeeds.
- Do not use placeholder text to fill empty public profile sections. If a profile has no bio, events, media, or worlds, leave data empty and expect the UI to hide the section.
- Do not invent descriptors. Use `headline`, `bio`, `about`, role tags, and genres only when supplied or clearly approved.

## Profile Data Pattern

1. Read the current schema and projection behavior before writing:
   - `docs/backend/profile-schema.md`
   - `convex/schema.ts`
   - `convex/profiles.ts`
   - `convex/search.ts`
2. Look up by canonical slug. Preserve `_id`, `slug`, claim state, publication state, and ownership records unless the task is specifically about those fields.
3. For person profiles, keep public identity fields narrow:
   - `displayName`, `aliases`, `searchAliases`
   - `person.roleTags` for roles such as DJ
   - `genres` for structured genre facts
   - `outboundLinks` for public links only
   - `headline`, `bio`, and `about` only when intentionally provided
4. Patch `updatedAt` on every profile write.
5. Refresh derived search state after any public field, visibility, asset, link, alias, tag, genre, or surfacing change.
6. Insert a profile audit event for operator edits. The note should explain the operation class, not expose private payload details.

## Temporary Convex Operator Pattern

Use a temporary mutation only when existing mutations cannot express the operation.

- Require an exact `confirm` string containing the operation class and date.
- Make the mutation idempotent by slug and stable external identifiers.
- Validate URLs and MIME types instead of trusting operator input.
- Use existing helpers such as slug lookup, public projection/search document builders, upload-intent consumption, and asset helpers.
- Typecheck before deploy.
- Deploy the temporary function, execute it once, verify public behavior, then delete the temporary file and redeploy clean.
- Verify the deleted temporary function is no longer callable.

Typical production Convex CLI setup on Windows:

```powershell
$envPath = 'D:\bench\VRDex\.env.local'
$deployLine = Get-Content -LiteralPath $envPath | Where-Object { $_.StartsWith('CONVEX_DEPLOYMENT_PROD=') } | Select-Object -First 1
$keyLine = Get-Content -LiteralPath $envPath | Where-Object { $_.StartsWith('CONVEX_DEPLOY_KEY_PROD=') } | Select-Object -First 1
$env:CONVEX_DEPLOYMENT = $deployLine.Substring('CONVEX_DEPLOYMENT_PROD='.Length)
$env:CONVEX_DEPLOY_KEY = $keyLine.Substring('CONVEX_DEPLOY_KEY_PROD='.Length)
node node_modules\convex\bin\main.js deploy --yes --typecheck=try --codegen=disable
```

Never print the deploy key. Prefer sanitized summaries of mutation output.

## Avatar And Media Assets

Profile images should use the managed profile asset system, not public S3 objects or random external image URLs.

1. Create or reuse a profile asset upload intent.
2. Upload the file through the app route when possible:
   - `POST /api/v0/profile-assets/upload-intents/:intentId`
3. If an emergency direct S3 upload is approved, write only to the private profile-assets bucket and preserve the intended content type, byte size, and cache-control metadata.
4. Mark the upload intent uploaded, attach a `profileAssets` row, and create an active `profile_image` placement.
5. Ensure old `profile_image` placements are deactivated if the new image replaces the avatar.
6. Serve public reads through `/api/v0/profiles/:slug/assets/:assetId/file`.
7. Verify:
   - the asset route returns `200`
   - `Content-Type` and length match the uploaded file
   - the public profile API includes the media-kit/profile image
   - search or discovery surfaces show the expected image when relevant

Pitfalls:

- Do not make the profile asset bucket public to fix rendering.
- A `500` from the asset route after a successful S3 upload can mean the hosted runtime cannot assume the Vercel OIDC role. Check CloudTrail claims against the IAM trust policy, but get explicit approval before changing a production trust policy.
- Prefer Terraform or checked-in docs for durable infrastructure state after any manual IAM repair.
- Upload tokens and intent files are sensitive until consumed; keep them local and delete them.

## Closeout Checklist

- Public profile page and API show only intended fields.
- Empty profile sections are hidden, not filled with "none yet" copy.
- Profile links are public-safe and omit community-only or credential-bearing links.
- Search/discovery results are refreshed if public fields changed.
- Temporary operator functions are removed and production is redeployed clean.
- Local temp files containing private payloads, tokens, or images are removed unless the human explicitly wants them retained locally.
- Any manual provider or infrastructure drift is documented or converted into IaC follow-up.
