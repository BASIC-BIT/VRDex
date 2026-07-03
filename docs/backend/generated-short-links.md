# Generated Short Links

## Status

Current recommendation and first implementation for `#92`.

## Locked Decision

Generated short links are durable pointer records, not vanity slugs.

Canonical public routes stay unchanged:

- profiles use `/p/<slug>` for people and `/c/<slug>` for communities
- worlds use `/w/<slug>`
- events use `/e/<slug>`

Generated short links use `/l/<code>` and redirect to the current canonical
route for the target. If a target slug changes later, the short link remains
stable because it stores the target id, not the slug.

## Short Link Records

`shortLinks` stores:

- immutable generated `code`
- `targetType`: `profile`, `world`, or `event`
- exactly one target id field for the selected target type
- `createdAt`

The first generated code format is lowercase alphanumeric, 5 to 12 characters,
with a 7-character default. The generator uses an ambiguity-reduced alphabet,
while validation accepts ordinary lowercase alphanumeric codes so old generated
codes remain easy to preserve if the alphabet changes.

Reserved codes such as `admin`, `api`, `health`, `privacy`, `qr`, `search`, and
other product route words are rejected. Code reservation retries when a
generated candidate is reserved or already taken.

## Public Redirect Behavior

`/l/<code>` resolves through Convex and returns `404` instead of redirecting
when:

- the code is invalid, reserved, absent, or not currently reserved
- the target row no longer exists
- the target profile is not publicly readable
- the target profile is opted out or suppressed
- the target world or event is not published
- the event no longer has a public slug

The resolver returns only the target type and canonical path. Public short-link
reads do not expose source attribution, private event operation fields, media
control internals, or moderation notes.

## Creation Contract

Profile community submissions and community event creation now reserve a short
link in the same Convex mutation that creates the target row. The mutation
return payload includes `shortLinkCode` and `shortLinkPath` as additive fields.

World records do not yet have a public write mutation. The backend exposes
`shortLinks.ensureForWorld` for the future world creation flow, and that flow
should call it in the same mutation that creates a world row.

Calling an ensure mutation for a target that already has a short link returns
the existing code without changing it. There is no update mutation for a code.

## Out Of Scope

- vanity or custom short links
- link analytics
- QR codes
- expiring links
- custom domains
- broad slug refactors
- changing canonical route patterns
