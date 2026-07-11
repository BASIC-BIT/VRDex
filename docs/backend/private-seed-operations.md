# Private Seed Operations

## Status

Operator runbook for permissioned private seed imports, reviewed lookup access,
and concierge handoff invitations.

## Safety Boundary

Locked behavior:

- Real source files stay outside the repository.
- The operator must confirm permission to use the source before importing it.
- Permissioned JSON imports receive `private_only` publication policy.
- Imported candidates do not enter public profiles, search documents, public
  APIs, or anonymous lookup.
- Operator review, source freshness, link reachability, and owner confirmation
  remain separate states.
- PostHog flags never authorize private Convex reads.

NWinn data uses this private-only path. It must not be converted directly into
reviewed public unclaimed profiles.

## Input Shape

Omit `sourceObservedAt` when the source date is unknown. Add `lastCheckedAt` to
an individual field only after a real recheck.

```json
{
  "permissioned": true,
  "batchId": "nwinn_2026_07_10_001",
  "sourceName": "NWinn",
  "sourceType": "partner",
  "receivedAt": "2026-07-10T00:00:00.000Z",
  "candidates": [
    {
      "candidateId": "nwinn-dj-001",
      "proposedDisplayName": "DJ Example",
      "fields": [
        {
          "fieldKey": "outboundLinks",
          "value": [
            {
              "type": "twitch",
              "label": "Twitch",
              "url": "https://twitch.tv/example"
            }
          ],
          "sourceLabel": "NWinn DJ master list",
          "sourceType": "partner",
          "confidence": "medium",
          "visibility": "private"
        }
      ]
    }
  ]
}
```

Allowed profile fields are `aliases`, `tags`, `genres`, `headline`, `bio`,
`about`, `outboundLinks`, `region`, `timezone`, `person.pronouns`, and
`person.roleTags`. Private contacts, raw account identifiers, private notes,
unknown fields, embedded URL credentials, non-HTTPS links, and unsupported link
types are rejected.

## Import

Run from a non-protected worktree. The script rejects files inside the repo,
keeps each Convex CLI invocation below a conservative Windows command-line
limit, and safely resumes a partially completed batch by skipping existing
candidate IDs only when their normalized import fingerprints match. A changed
payload under an existing candidate ID fails instead of silently retaining
stale data. Imported observation and checked timestamps cannot be in the future.

```powershell
pnpm ops:seed-import:json -- `
  --file C:\private\nwinn-djs.json `
  --actor-token operator:vrdex `
  --actor-issuer vrdex `
  --actor-subject seed-import `
  --actor-name "VRDex operator" `
  --prod
```

The command prints counts only. It does not print source rows or field values.
For a named development or preview deployment, replace `--prod` with
`--deployment <deployment-name>`.

## Review And Freshness

Use the internal review mutations with the IDs returned by the Convex operator
tools or review snapshot query:

- `seedImports:setBatchReviewState`
- `seedImports:setCandidateReviewState`
- `seedImports:setCandidateFieldReviewState`
- `seedImports:getBatchReviewSnapshot`

`Reviewed` means accepted for the intended private use. It does not mean
current or owner-verified. The field review mutation accepts `lastCheckedAt`
only when an actual recheck occurred and rejects future timestamps.

## Lookup Grants

The first grant for the operator is `super_admin`. Beta users receive only
`view_private_seed_lookup`; beta lookup returns reviewed candidates and accepted
fields only from `private_only` import batches, while a super-admin can inspect
unreviewed private staging records across import policies.

```powershell
pnpm exec convex run --prod accountFeatureGrants:grant `
  '{"userId":"<convex-user-id>","feature":"view_private_seed_lookup","grantedBy":{"tokenIdentifier":"operator:vrdex","issuer":"vrdex","subject":"seed-access"}}'
```

Add `expiresAt` as epoch milliseconds for a temporary grant. Revoke with
`accountFeatureGrants:revoke`. Grant, expiry, and revocation are enforced in
Convex even when PostHog is unavailable or stale.

## Handoff Invitations

Create an invitation after selecting a private person candidate. `--field-ids`
is optional, so a recipient can claim a prepared display-name identity without
keeping any optional imported fields.

```powershell
pnpm ops:seed-handoff:create -- `
  --candidate-id <candidate-id> `
  --field-ids <field-id>,<field-id> `
  --actor-token operator:vrdex `
  --actor-issuer vrdex `
  --actor-subject concierge-handoff `
  --actor-name "VRDex operator" `
  --base-url https://vrdex.gg `
  --prod
```

For a named development or preview deployment, replace `--prod` with
`--deployment <deployment-name>`.

The script generates a 256-bit token and prints the link once. Convex stores
only its SHA-256 hash. Invitations expire within 90 days, are revocable through
`seedHandoffs:revokeInvitation`, and can be accepted once.

The recipient can inspect every prepared link, remove any optional field, sign
in through a same-origin return path, and explicitly confirm the selected
details only after verified email. The
result is a private `claimed_unverified` profile with owner authority. Accepted
fields become `owner_confirmed`; deselected fields are not copied and are
removed from a reused concierge profile.

## Outreach Copy

Close friend:

> Hey, I made a thing called VRDex and put together a private starting profile
> for you using links already shared with NWinn for events. It is not public.
> This link lets you review it, make an account, and claim it if you want:
> `<handoff-link>`

Broader contact:

> Hi - I am building VRDex, a VRChat-first directory for people, communities,
> and events. I prepared a private starting profile from links already shared
> for event operations. Nothing is published by accepting it; the link lets you
> review the details, create an account, and take control of the profile:
> `<handoff-link>`

Do not send raw import files, internal candidate IDs, or review notes with an
invitation.

## Analytics

Authorized lookup mirrors `seed_lookup_beta=true` to PostHog and evaluates the
Terraform-managed `seed-lookup-beta` UI flag. Beta UI fails closed until the
flag resolves true; super-admins bypass the UI flag. Convex remains
authoritative.
Events include only result-count buckets and access scope; they exclude names,
queries, links, source rows, handoff tokens, and raw account identifiers.

Handoff, lookup, sign-in, account, submission, and editor routes are excluded
from session replay. URL sanitization removes queries and normalizes handoff
tokens before pageview capture.
