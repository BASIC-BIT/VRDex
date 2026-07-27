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
`secretRef` (`arn:aws:secretsmanager:…` or `secret://…`), matching
`collectorAccounts` and the event media-control credential. The adapter resolves
the reference through its own IAM role. This is why the token is not encrypted
in Convex: it is never there.

Constraints enforced in `vrclinkingCredentials.ts`:

- registering requires **both** profile ownership and a current
  `externalControlProofs` row proving the caller manages that guild, so nobody
  can delegate a key for a server they do not control;
- each delegation records the single `guildId` it is authorized for, so a key
  that could technically read other guilds is never used to;
- the reference itself is bound to that guild: the only accepted values are
  `secret://vrdex/vrclinking/<guildId>` or an
  `arn:aws:secretsmanager:<region>:<account>:secret:vrdex/vrclinking/<guildId>`
  (with the optional Secrets Manager suffix). Syntax is not authorization — the
  adapter resolves whatever it is given through its own IAM role, so accepting
  arbitrary well-formed names would let the owner of one guild register another
  tenant's reference and have VRDex spend that tenant's key;
- `secretRef` is returned by exactly one internal query (`getAdapterContext`),
  consumed by the action
  that calls the adapter, and never by a client-facing query;
- every consultation stamps `lastConsultedAt`, and a consultation that produced
  the match additionally stamps `lastUsedAt` and a short result summary. Both are
  surfaced under the profile's connections, so an operator can tell a key that
  has never been asked from one that has been asked and never matched;
- owners can revoke, which takes effect immediately for subsequent reads.

## What VRDex asks the adapter

The `VRCLINKING_PROOF_ADAPTER_URL` seam is the credential boundary. Convex sends
the guild, the Discord user id, the claimed VRChat id, and the `secretRef` — no
token — and the adapter answers the narrow question:

> Does VRCLinking report this Discord user as linked to this VRChat account in
> this guild, and is that link verified?

The adapter resolves the secret, calls
`GET /members/{guildId}?search=<discordUserId>&searchBy=DiscordId`, and returns
the existing `{ verified, evidenceSource, evidenceSummary }` contract with
`evidenceSource: "vrclinking"`. A match requires `isVerified === true` **and**
`vrcId` equal to the claimed account.

## Trust posture

A VRCLinking attestation is a different signal from our own proof code: it is a
third party asserting linkage rather than VRDex observing it directly. It is
recorded with `evidenceSource: "vrclinking"` so the two never become
indistinguishable in the audit trail, and so a future decision to weight them
differently does not need a migration.

## Remaining work

The adapter service is built at `workers/vrclinking-adapter` (see its README),
and delegation is manageable from `/account/connections`. What is left needs
something outside the codebase:

1. **Deploying the adapter.** It needs somewhere to run with either the Secrets
   Manager task-role policy or a mounted secret directory, and
   `VRCLINKING_PROOF_ADAPTER_URL` in Convex pointed at it.
   `VRCHAT_PROOF_ADAPTER_BEARER_TOKEN` must be set to the same value on both
   sides — the adapter refuses to start without it and Convex refuses to call
   an adapter without it. Its README documents the configuration and a local
   run.
2. **Putting a real key in the secret store** and recording its reference
   against a community.
3. **Talking to VRCLinking** about third-party server-to-server use, which has
   no published terms. Currently deferred.

The OAuth guild verification already shipped covers Discord community claiming
without VRCLinking, so this remains an enrichment path — VRChat identity
attestation for *person* profiles, without a proof code — rather than a fix for
anything currently broken.
