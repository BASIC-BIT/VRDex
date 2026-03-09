# VRDex

Working folder for `VRDex`, a VRChat-first scene directory product centered on people, communities, and public identity pages.

## What is in here

- `research.md` - ecosystem scan and adjacent-code notes
- `product-spec.md` - MVP scope, user flows, and product rules
- `architecture.md` - suggested system design, data model, and integrations
- `prd.md` - product requirements draft for v1 and near-term expansion
- `engineering-strategy.md` - stack, payments, testing, and agentic factory plan
- `docs-strategy.md` - Docusaurus and source-of-truth documentation plan
- `epics.md` - phased epic breakdown for v0.5, v1, and v1.5
- `issue-seeding.md` - how to split epics into GitHub issues and milestones
- `dependency-map.md` - hard/soft dependency map across the seeded backlog
- `issue-drafts.md` - drafted GitHub issue bodies captured from planning interviews

## Current direction

Important planning note:

- some items in this folder are still first-pass assumptions
- where a product decision is not locked, it should be treated as a candidate direction to validate in later interviews

Currently locked stack direction:

- `Next.js`
- `Convex`
- `AWS`
- `Stripe`
- `Docusaurus`
- `Vercel`

Currently locked product posture:

- open source
- self-hostable
- public documentation
- public-facing API with clear rate limiting
- infrastructure as code in the repo

The strongest opening is not "another event calendar."

The strongest opening is a canonical public profile layer for VRChat people and communities:

- person profiles for DJs, VJs, hosts, photographers, performers, and scene staff
- community profiles for clubs, VRChat groups, Discord servers, brands, and venues
- community-created entries that can later be claimed by the actual owner
- Discord and VRChat verification so claimed profiles become trusted
- export and integration surfaces for Discord bots, booking tools, and event sites

The product can also act like a VR-native Linktree with richer identity, events, and trust signals.

One especially strong moat candidate is VRCLinking integration for trusted Discord<->VRChat identity linkage.

Current working domain: `vrdex.net`.

That lets the product complement tools like VRC Pop, Decked Out, and VRCLinking instead of immediately fighting them on their home turf.

## Recommended starting point

If you build this as a real product next, the best local references are `D:\bench\vrchat-mcp` for VRChat integration patterns and `D:\bench\vrc-in-world-schedule` for simple public endpoints.

Do not depend on VRCTL / vrc.tl access from this environment.

## Suggested first build slice

1. Public person and community profile pages
2. Community submission flow
3. Claim profile with Discord OAuth
4. Claim profile with VRChat proof code
5. Discord bot commands that return profile cards
6. Field-level privacy controls and profile customization
7. Basic import/export hooks for partners
