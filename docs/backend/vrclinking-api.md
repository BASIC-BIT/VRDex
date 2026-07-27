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

## Blocker before implementing

The shape is not the obstacle; access is.

`/generate_api_key` mints a key for a logged-in VRCLinking account, and
`/members/{guildId}` is guild-scoped. So reading a community's linkage appears
to require a VRCLinking account with standing access to that guild. VRDex cannot
satisfy that for arbitrary communities without either:

- each community operator generating a key and delegating it to VRDex, which
  moves a credential with broad guild read access into our custody; or
- a partnership granting VRDex an application-level credential.

There is also no published ToS covering third-party server-to-server use.

**Recommendation:** keep the adapter seam and do not implement a client until
one of those access paths exists, because neither is a code decision. If the
per-community key route is taken, the credential should be stored per community
and scoped to that guild, never as one global VRDex key.

Note that the OAuth guild verification already shipped covers the Discord side
of community claiming without VRCLinking, so this is an enrichment path — VRChat
identity attestation for *person* profiles — rather than a blocker for anything
currently broken.
