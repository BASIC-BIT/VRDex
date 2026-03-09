# Research Notes

## Core problem

VRChat DJs keep getting asked for the same packet of information:

- logo
- links
- genres
- contact path
- VRChat account
- stream link or media kit

That information is scattered across Discord DMs, club-specific bots, Google Docs, booking messages, and personal social pages. The gap is not just "can people book DJs" - the gap is "is there one trusted public place for a person's or club's scene identity?"

## What the existing scene already has

### VRC Pop

Observed from `https://vrcpop.com/` and `https://vrcpop.com/partners/decked-out`:

- public event schedule and live club activity view
- club onboarding through Discord login
- club analytics and discovery tooling
- partner integration with Decked Out
- emphasis on events, clubs, and live scene visibility

Important detail: VRC Pop's Decked Out partner page explicitly says Decked Out already stores DJ-facing data like stream links, genres, and preview sets, and can sync events into VRC Pop.

Implication: there is already demand for structured DJ data, but it currently lives inside booking workflows, not as a portable public identity layer.

### Decked Out

Observed from `https://vrcpop.com/partners/decked-out`:

- Discord-first booking bot
- one-click slot booking
- automatic reminders
- DJ profiles
- VRChat stream link conversion
- application workflows for clubs
- optional sync into VRC Pop

Important detail: the bot appears to be distributed manually through Bean on Discord, which suggests it is powerful but not an open public directory by itself.

Implication: your product should probably integrate with Decked Out instead of copying its booking flow first.

### VRCLinking / VRify class tools

Observed from `https://vrclinking.com/` and `https://buddelbubi.xyz/vrify/`:

- Discord-to-VRChat account linking is already a familiar pattern in the ecosystem
- verification is useful for roles, nicknames, group sync, and automation
- there is appetite for a shared identity layer across servers

Important detail: VRCLinking markets itself around creators, groups, role sync, age verification, and API access. VRify also describes linking Discord users to VRChat accounts and exposing user/world lookups.

Implication: your claim-and-verify flow is normal for this community, not weird. The real opportunity is to apply that pattern to performer identity and booking metadata.

Stronger implication: VRCLinking is not just adjacent infrastructure; it may be a key moat if it can act as a trusted identity attestation layer for profile claims, club ownership, and reduced re-verification friction.

Additional implication: Discord should be treated as one important identity and claim signal, not the whole account system. The product should stay flexible enough to support other login providers and other trust sources over time.

### Official VRChat Discord linking

Observed from `https://docs.vrchat.com/docs/vrchat-202612`:

- VRChat now supports linked Discord and VRChat accounts in the official product
- users can see Discord friends in VRChat when both sides have linked accounts
- VRChat added settings around visibility and Discord-friend discoverability

Implication: this is both a risk and an opportunity.

- risk: some of the identity-linking value proposition will become more standardized at the platform level
- opportunity: the ecosystem is being trained to accept Discord<->VRChat linkage as normal and valuable
- opportunity: VRDex can become the directory and trust layer that sits on top of that identity graph, whether the linkage signal comes from VRCLinking, native VRChat, or both

## VRChat service-account idea

Observed from ecosystem patterns you described:

- some tools use fleets of VRChat bot/service accounts to support group-linked operational actions such as instance invites
- the need for multiple accounts can come from platform constraints like group membership limits per account

Implication:

- VRDex could eventually grow a real operational service layer on top of VRChat, not just a directory layer
- but this is a later specialized capability and should be isolated from the first product slice

### VRCTL / vrc.tl

- treat this as off-limits from this environment
- do not use it as a dependency for product viability
- if anything ever happens there, it should only be through explicit human-to-human partnership later, not exploratory traffic from here

### Broader scene context

Observed from `https://medium.com/@andrew.horkan/djing-and-raving-in-vr-and-vrchat-8b7a49c2beaf` and public community references:

- the VRChat club scene is large and active across many time zones
- discovery still heavily runs through Discord communities and daily roundup channels
- Friday/Saturday density is high enough that fragmentation is a real problem
- people care about genre, venue vibe, crew reputation, and social proof as much as raw event listings

Implication: identity and trust matter. A public people-and-clubs rolodex can reduce repeated manual vetting and repeated data entry.

Another strong implication: people in this scene already think in terms of public-facing pages, promo assets, lineup cards, and shareable identity packets. That means a VR-native Linktree competitor is plausible as long as it stays better at identity, verification, clubs, and events than a generic link page.

## What your adjacent code already proves

### `D:\bench\vrchat-mcp`

This is the best clean local starting point.

Key takeaways from `D:\bench\vrchat-mcp\README.md` and nearby files:

- TypeScript MCP server with curated tool registration
- VRChat auth tools already exist
- user, group, world, event, and invite patterns already exist

Useful reusable patterns:

- safe auth flows
- local-first credential storage
- explicit read/write boundaries
- curated integration surfaces instead of raw scraping-first design

### `D:\bench\vrc-in-world-schedule`

This repo shows a good second pattern: very simple public endpoints for consumption by VRChat worlds or lightweight clients.

Useful reusable pattern:

- stable public URLs are valuable in VRChat contexts

## Product opportunity

The opening is not to replace every calendar, every booking bot, and every group tool at once.

The opening is to become the canonical profile layer that other systems can point to.

That means:

- public profile URLs
- structured and portable metadata
- verified identity
- media-kit friendly assets
- APIs, embeds, and bot lookups
- attribution and claim flows for community-added entries
- a first-class home for both people and communities
- a profile page that can double as a customizable link hub

## Strategic positioning

### Good angle

"The source of truth for VRChat scene identity."

### Bad first angle

"We are yet another event list."

Event lists are crowded. A profile graph with verification, ownership, club intelligence, and integrations is more defensible.

## Immediate differentiation ideas

1. Community-created profiles that people or clubs can later claim
2. Canonical short profile URLs for sharing in DMs and booking threads
3. Verification by Discord OAuth and VRChat proof code
4. Booking-friendly asset pack on one page: logos, links, contact, genres, time zone, availability notes
5. Export cards for Discord bots and partner sites
6. Club intelligence later: events, lineups, activity, collaborators, references
7. Upcoming events on a DJ page so users can check where someone is playing next
8. AI-assisted extraction of lineup/set-time data from event descriptions, subject to human confirmation
9. Longer-term graph discovery based on shared events, shared communities, repeated collaborations, and booking/network history

## Risks

- If you depend on scraping third-party sites, you inherit fragility and politics
- If you launch with too much moderation complexity, operations become painful fast
- If you try to out-feature booking bots on day one, you spread too thin
- If VRChat expands official account-linking and event tooling, pure identity plumbing becomes less defensible by itself
- If you allow unconstrained page customization too early, the product can become hard to moderate, slow to render, and inconsistent on mobile

## Best MVP framing

Ship a verified public profile system first.

Then add:

- Discord bot lookups
- partner import/export
- event participation history
- community-side talent discovery
- community profiles and community-owner tooling, with clubs as the main early subtype
- multi-source trust signals from VRCLinking, native VRChat linking, and direct proof flows
- upcoming events and event-history pages fed by multiple sources
