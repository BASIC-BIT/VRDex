# VRCLinking API shape

Research notes for the VRCLinking adapter seam behind
`VRCLINKING_PROOF_ADAPTER_URL`. This resolves the "open research" item in
[`profile-claim-journey.md`](../planning/profile-claim-journey.md).

## Provenance and confidence

**This is reverse-engineered, not documented.** VRCLinking publishes user docs at
`docs.vrclinking.com` covering only Introduction, Group Sync, and World Sync —
there is no API reference, no developer portal, and no stated partner programme.

Everything below is read from the OpenAPI-generated C# client committed to the
public [VRCLinking/VRCLinkingSDK](https://github.com/VRCLinking/VRCLinkingSDK)
repository, under
`Packages/com.vrclinking.vrclinking-sdk/VRCLinkingAPI/src/VRCLinkingAPI/`. The
generator emitted the routes, verbs, auth scheme, and model field names
verbatim, so the shapes are accurate for the SDK's pinned API version. No
request was made against the live API during this research.

Treat it as accurate about *shape* and unverified about *availability*:
behaviour, rate limits, stability, and whether third-party server-to-server use
is permitted are all unknown.

## Base URL and auth

- Base URL: `https://vrclinking.com/api`
- Auth: `Authorization: Bearer <token>` on every non-login route.
- `GET /generate_api_key` returns `{ "token": string }`, but is itself
  authenticated — a key is minted from an existing logged-in VRCLinking session,
  so it appears to be account-scoped rather than an application credential.

Session/auth routes: `POST /login`, `/login/callback`, `/discord_auth`,
`/logout`. The Unity SDK uses `/sdk-login` and `/oauth-approve` to obtain its own
token.

## The endpoint that matters for claiming

`GET /members/{guildId}` — search a Discord guild's members and read their
VRChat linkage.

Query parameters:

| Parameter | Values |
| --- | --- |
| `search` | free text / id |
| `searchBy` | `DiscordId`, `DiscordName`, `VrcId`, `VrcName` |
| `sort` | `SortType` |
| `page` | integer |

Response `MemberSearchResponse`:

```jsonc
{
  "count": 1,
  "page": 1,
  "totalCount": 1,
  "totalPages": 1,
  "results": [
    {
      "id": "discord-user-id",
      "username": "name",
      "avatar": "…",
      "discordRoles": ["role-id"],
      "vrcId": "usr_…",
      "vrcName": "VRChat Name",
      "isVerified": true,
      "linkLastChanged": "…",
      "linkCount": 1,
      "ageVerified": false
    }
  ]
}
```

`vrcId` + `isVerified` on a `SearchMember` is exactly the attestation VRDex
wants: a trusted third party asserting that a given Discord identity controls a
given VRChat account. `searchBy=VrcId` also allows the reverse lookup.

`GET /members/{guildId}/{memberId}` returns a thinner `SearchDetailsMember` of
just `{ id, discordRoles[] }` — it does **not** include `vrcId`, so the search
route is the useful one.

## Also relevant to the link model

`GET /guilds/{guildId}` returns `Guild`, which carries `grpId` — the VRChat
group bound to that Discord guild — alongside `owner`, `members`,
`linkedMembers`, and `roles`. That is a ready-made Discord-guild-to-VRChat-group
association, directly relevant to
[`profile-claim-journey.md`](../planning/profile-claim-journey.md)'s
many-to-many modelling. Related: `GET /guilds`,
`GET /guilds/{guildId}/guild_roles`, `GET /guilds/{guildId}/worlds`.

## User-scoped linking flow

For completeness, VRCLinking's own proof flow mirrors ours: `POST /users/link`
and `GET /users/check` return `LinkingResponse { verificationCode, status }`
where `status` is `Success`, `Conflict`, or `SuccessVerified`. `/users/verify`,
`/users/unlink`, `/users/refresh`, and `/users/search` (returning
`VRChatUser { id, displayName, profileUrl }`) complete the set. These are scoped
to the authenticated VRCLinking user, so they are not a route for VRDex to
verify *someone else's* linkage.

## Access model

The shape was never the obstacle; access is. `/generate_api_key` mints a key
from a logged-in VRCLinking account and `/members/{guildId}` is guild-scoped, so
reading a community's linkage needs a VRCLinking account with standing access to
that guild.

**Accepted approach (product decision, 2026-07-27): per-community delegation.**
A community operator generates a VRCLinking key and delegates it to VRDex.
This is knowingly accepted despite the key granting broad read across every
guild the granting account can see; VRDex constrains its own use rather than
relying on the credential being narrow.

The rejected alternative was one global VRDex key, which concentrates the same
risk without the per-community revocation story.

There is still no published ToS covering third-party server-to-server use.

## Credential handling

VRDex holds a delegated credential that is broader than the use it is put to, so
the containment is in how it is stored and used, not in the token itself.

**Convex never sees the token.** `communityVrclinkingCredentials` stores only a
`secretRef` (`secret://…`), matching
`collectorAccounts` and the event media-control credential. The adapter resolves
the reference through its own IAM role. This is why the token is not encrypted
in Convex: it is never there.

The owner pastes the key into `/account/connections` and
`POST /api/account/vrclinking-delegation` is the only thing that handles it: it
asks Convex whether the caller controls that guild, writes the key to
`vrdex/vrclinking/<guildId>` in Secrets Manager, and only then registers the
delegation. The order is deliberate — registering revokes whatever key the
community had before it, so a failed write after a register would leave them
worse off than before they tried. The write needs
`VRDEX_VRCLINKING_DELEGATION_ROLE_ARN`, a Vercel-OIDC role scoped to
`PutSecretValue`/`CreateSecret` on that prefix and given no read access at all;
`infra/terraform/vrclinking-adapter/delegation-writer.tf` declares it, and the
form reports the feature unavailable wherever it is unset.

Constraints enforced in `vrclinkingCredentials.ts`:

- registering requires **both** profile ownership and a current
  `externalControlProofs` row proving the caller manages that guild, so nobody
  can delegate a key for a server they do not control;
- each delegation records the single `guildId` it is authorized for, so a key
  that could technically read other guilds is never used to;
- the reference is **derived** from that guild, never supplied:
  `registerCredential` takes no `secretRef` argument and computes
  `secret://vrdex/vrclinking/<guildId>` itself. It was an argument, validated to
  that single legal value, which made the delegation form ask a community owner
  for a pointer into a secret store only operators can write — the one value
  they could enter was the one the system already knew, and every delegation
  registered that way resolved to nothing. Deriving it also settles the
  authorization question the validation was standing in for: the adapter
  resolves whatever it is handed through its own IAM role, so an argument at all
  meant the owner of one guild could name another tenant's reference and have
  VRDex spend that tenant's key;
- `secretRef` leaves the table through exactly one internal function,
  the mutation `reserveAdapterDelegations`, consumed by the action that calls
  the adapter and never by a client-facing query. A mutation rather than a query
  because selecting delegations and advancing their rotation cursor have to be
  one transaction — concurrent attempts reading a stale cursor all pick the same
  few communities;
- every consultation stamps `lastConsultedAt`, and a consultation that produced
  the match additionally stamps `lastUsedAt` and a short result summary. Both are
  surfaced under the profile's connections, so an operator can tell a key that
  has never been asked from one that has been asked and never matched;
- owners can revoke, which takes effect immediately for subsequent reads.

## What VRDex asks the adapter

The `VRCLINKING_PROOF_ADAPTER_URL` seam is the credential boundary. Convex sends
the Discord user id, the claimed VRChat id, and per delegation the `guildId`,
the `secretRef`, an `expiresAt`, and a `capability` — no token — and the adapter
answers the narrow question:

> Does VRCLinking report this Discord user as linked to this VRChat account in
> this guild, and is that link verified?

The `capability` is an HMAC-SHA256 over `guildId\nsecretRef\nexpiresAt`, hex
encoded, minted by `convex/_delegationCapability.ts` and verified by the
adapter. It exists because the bearer token authenticates the channel rather
than the request: secret names are derived from the guild id, so a caller
holding that token could otherwise name any guild and have the adapter spend
that community's key. The signing key is a second, separate secret —
`VRCLINKING_ADAPTER_CAPABILITY_KEY` in Convex and
`VRDEX_VRCLINKING_CAPABILITY_KEY` in the adapter, same value — so leaking the
bearer token does not confer the ability to mint one. Both sides refuse to
start or sign without it, and a delegation lacking a valid, unexpired
capability is dropped before any secret is resolved.

The adapter resolves the secret, calls
`GET /members/{guildId}?search=<discordUserId>&searchBy=DiscordId`, and returns
the existing `{ verified, evidenceSource, evidenceSummary }` contract with
`evidenceSource: "vrclinking"`. A match requires `isVerified === true` **and**
`vrcId` equal to the claimed account.

A positive result must additionally carry `matchedDelegationIndex` — the
position in the `delegations` array that answered — and may carry
`matchedGuildId`. Convex re-reads that delegation before accepting the
attestation, checking it is still active, still holds the reference the answer
came from, and still has a live control proof behind it; a positive naming no
delegation, or an index outside the batch, is refused as unavailable rather than
granted. Every response also carries `consultedDelegationIndexes`, the
delegations a provider question actually reached, which is what the
operator-visible "last queried" stamp is written from.

## Trust posture

A VRCLinking attestation is a different signal from our own proof code: it is a
third party asserting linkage rather than VRDex observing it directly. It is
recorded with `evidenceSource: "vrclinking"` so the two never become
indistinguishable in the audit trail, and so a future decision to weight them
differently does not need a migration.

## Remaining work

The adapter service is built at `workers/vrclinking-adapter`, deployed by
`infra/terraform/vrclinking-adapter`, offered on the claim form, and manageable
from `/account/connections`. Two secrets must match across the boundary, and
both sides refuse to start or call without them:

- `VRCHAT_PROOF_ADAPTER_BEARER_TOKEN`, the same name on both sides.
- the capability signing key — `VRCLINKING_ADAPTER_CAPABILITY_KEY` in Convex,
  `VRDEX_VRCLINKING_CAPABILITY_KEY` in the adapter. Keep it a different value
  from the bearer token; that separation is the whole point of it.

What is left needs something outside the codebase:

1. **A community actually delegating a key**, which now means an owner pasting
   one into `/account/connections` on a deployment where
   `VRDEX_VRCLINKING_DELEGATION_ROLE_ARN` is set. Until one has, the method is offered
   wherever the adapter is configured and every attempt short-circuits to
   `unavailable` — `verifyVrchatProofViaAdapter` has nothing to ask, so it never
   posts the claimant's Discord id. A genuine no-match is a different state and
   only becomes reachable once a delegation exists.
2. **Talking to VRCLinking** about third-party server-to-server use, which has
   no published terms. Currently deferred.

The OAuth guild verification already shipped covers Discord community claiming
without VRCLinking, so this remains an enrichment path — VRChat identity
attestation for *person* profiles, without a proof code — rather than a fix for
anything currently broken.
