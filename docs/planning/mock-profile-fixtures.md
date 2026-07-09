# Mock Profile Fixtures

## Status

Current recommendation for deterministic profile demos, tests, and showcase
data. This extends the reviewed seed-import model without authorizing real
confidential data in git.

## Locked Decisions

- Do not commit real friend, partner, roster, contact, or profile data to git.
- Fake fixtures must stay obviously fake and use `.invalid` URLs or checked-in
  local fixture assets.
- Consented real production profiles are operational data, not repository
  fixtures.
- Public profile, search, API, MCP, export, and discovery queries should exclude
  mock records unless a caller intentionally requests the mock fixture surface.

## Current Recommendation

Add `isMock` to root public entities that can be seeded for deterministic
fixtures:

- `profiles`
- `events`
- `worlds`
- future root entities that can appear independently in public search or public
  pages

Default `isMock` to `false`. Treat missing values as false during migrations so
existing production data remains visible. Shared query helpers should filter
`isMock !== true` by default, and fixture routes or test helpers should opt into
mock data through an explicit option instead of ad hoc query rewrites.

For public/demo substitution, prefer an explicit request shape such as
`?data=mock` on the profile list/discovery surface. That mode should return
mock results instead of ordinary production results, not silently blend the two,
unless a future demo surface deliberately asks for a mixed result set.

## Consented Real Showcase Profiles

Do not add a broad `appearsInMockResults` field to every entity. Use a narrow
allowlist table for the rare case where a real, consented profile should appear
in a mock/demo surface:

- `entityType`: initially `profile`
- `entityId`
- `surface`: for example `dj_list_demo`
- `enabled`
- `reason` or internal note
- `createdBy`
- `createdAt`
- optional `expiresAt`

This keeps ordinary profile records clean, avoids polluting every table with a
showcase flag, and lets operators revoke demo inclusion without editing the
profile itself. The allowlist must never imply that the profile is fake; it only
means the real profile may appear on an explicitly requested mock/demo surface.

## Query Rules

- Default public reads: exclude `isMock === true`.
- Explicit mock reads: include only `isMock === true` plus explicitly allowlisted
  real records for that surface.
- Tests: seed fake records with `isMock === true` and assert default queries do
  not return them.
- Production manual profile operations: keep real consented data as `isMock ===
  false`; use the showcase allowlist only when the real profile is approved for
  a demo surface.

## Group Representation

Current recommendation:

- Keep `person` and `community` as the two root profile types.
- Model artist groups, collectives, labels, venues, and clubs as `community`
  profiles with flexible subtype/category tags.
- Add relationship edges rather than overloading person profiles when a person
  represents or performs as part of a group.

Candidate direction:

- Add a `profileRepresentations` or broader `profileRelationships` table with
  `fromProfileId`, `toProfileId`, `relationshipType`, `label`, visibility,
  source, claim/review state, and timestamps.
- Use relationship types such as `member_of`, `represents`, `resident_at`, and
  `booking_contact_for` only after real workflows justify them.
- Let public pages render selected relationships as concise links, not as
  explanatory trust copy.

Interview later:

- Whether artist duos should usually be community profiles, person aliases, or
  both.
- Whether an individual owner account should be able to claim both a person
  profile and an artist-group profile in one flow.
- Whether demo surfaces need mixed fake-plus-real results, or whether strict
  substitution is enough.

## Suggested Slices

1. Add `isMock` to root public entities and centralize default filtering.
2. Add a mock/demo profile query mode for the DJ list using existing fake
   fixtures.
3. Add a narrow real-profile demo allowlist table and operator mutation.
4. Add tests proving default public reads exclude mock records.
5. Add profile relationship planning or schema once group representation is
   needed by a real profile workflow.
