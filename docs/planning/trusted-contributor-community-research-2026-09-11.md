# Community contribution models for VRDex

Status: research findings and candidate directions, not locked policy. Sources checked on 2026-09-11. This note supplies external evidence for the trusted-contributor design; it does not verify VRDex code or production behavior.

## Findings from primary sources

### English Wikipedia separates reliable creation from reviewing others

Autopatrolled marks a contributor's new pages as reviewed without changing the creation interface. It does not grant the separate right to review other contributors' pages. English Wikipedia suggests 25 valid articles as evidence, but administrators can decline despite meeting that number. Policy understanding and a reliable contribution history matter; high volume alone does not qualify. The right can be removed for core policy violations. An autopatrolled contributor can request outside review for a particular page, and others can return a page to the review queue. This is an information page describing Wikipedia practice, not itself a policy or guideline. [Wikipedia:Autopatrolled](https://en.wikipedia.org/wiki/Wikipedia:Autopatrolled)

The analogy has a limit: ordinary eligible Wikipedia contributors can already create articles directly in mainspace. Autopatrol reduces subsequent review and affects indexing; it is not a precedent for turning private media proposals into public assets without a separate product decision. [Wikipedia:Autopatrolled](https://en.wikipedia.org/wiki/Wikipedia:Autopatrolled)

Administrators can grant listed permissions temporarily or permanently. They inspect contributions and logs even when automated qualification checks find no problem, record a decision, and maintain separate channels for permission review or removal. [Wikipedia:Requests for permissions](https://en.wikipedia.org/wiki/Wikipedia:Requests_for_permissions#Process)

### OpenStreetMap treats a bulk import as an accountable project

OSM requires an import plan covering transformation, reconciliation with existing records, division of work, changeset size, quality checks, and reversion. Its guidance requires source permissions, community involvement, progress tracking, and a review period before importing. Imports use a dedicated account, making their changes distinguishable. The guidance explicitly addresses duplicate and conflicting existing records. Importers must respond to concerns and know how to revert a failed import. [OSM Import/Guidelines](https://wiki.openstreetmap.org/wiki/Import/Guidelines)

VRDex need not copy the dedicated-account rule or OSM's 14-day process. The transferable lesson is to make a collection independently identifiable, inspectable, and correctable. A batch ID tied to the ordinary submitting identity can provide that accountability without forcing a new login or toolset. This is a design inference from OSM's workflow, not an OSM recommendation for VRDex. [OSM Import/Guidelines](https://wiki.openstreetmap.org/wiki/Import/Guidelines)

### Discourse combines graduated limits with specific permissions

Discourse gives established members larger daily allowances. Its Regular level considers sustained participation and confirmed moderation history, can be lost, and has a grace period to avoid repeated promotion and demotion. Leader status requires manual staff promotion. The official guide, updated in December 2025, describes migration of many feature settings from trust levels to allowed groups so administrators can grant one capability without raising all of a user's permissions. [Understanding Discourse Trust Levels](https://blog.discourse.org/2018/06/understanding-discourse-trust-levels/)

The useful inference for VRDex is to keep submission capacity, approval authority, and ownership distinct. A forum's reading and likes thresholds do not establish skill at identity reconciliation or image provenance. [Understanding Discourse Trust Levels](https://blog.discourse.org/2018/06/understanding-discourse-trust-levels/)

## Current recommendation for the design brief

Use a small manually granted trusted-contributor capability first. Make the qualification route available to any contributor. Evaluate samples of accepted work, correct source attribution, identity matching, handling of duplicate records, and response to corrections. Counts can identify candidates for review; they should not automatically grant trust. Record the grantor, reason, supporting examples, time, and any expiry. Support suspension, revocation, and reconsideration with recorded reasons.

Keep bulk submission through the ordinary tools. A batch should have a stable identifier, contributor identity, source description, intended scope, item statuses, and a summary of conflicts. Resuming a batch should retry only items that need work. Store private source evidence privately, even when the resulting profile or media is public.

Raise baseline capacity enough for useful community donations. Then give trusted contributors more pending capacity and throughput. None of these external sources establishes suitable numeric limits for VRDex. Choose those numbers from expected donation size, asset size, moderation capacity, and measured costs. Keep pending-review backlog, concurrent downloads, daily accepted creations, and stored bytes as distinct controls.

The initial research recommendation favored independent review throughout. BASIC subsequently approved a separate bounded trusted-publisher permission, recorded in [the canonical design](./trusted-contributors-and-bulk-contributions.md). It permits clearly sourced own contributions into empty slots on public unclaimed profiles; replacements and uncertain, disputed, or previously rejected/suppressed material still need independent review. Reviewers should see per-item previews, target identity, sources, duplicates, and conflicts, and select the exact accepted subset. Approval of a batch plan must not silently approve later items.

## Alternatives and owner decisions

| Candidate | Benefit | Cost or unresolved issue |
| --- | --- | --- |
| Larger baseline plus manual trust grants | Simple, attainable, easy to explain | Needs a small recurring review process for trust applications |
| Automatic reputation score | Less manual qualification work at scale | Gaming, opaque outcomes, and extra implementation before evidence justifies it |
| Trusted media publication without independent review | Removes reviewer throughput constraint | Requires explicit owner acceptance, stronger correction tooling, and evidence of reliable outcomes |
| Batch-scoped capacity grant | Welcomes a newcomer with a large credible collection | Needs expiry and clear handling when a batch exceeds its approved scope |

The owner chose separate bounded publication authority rather than attaching it automatically to contributor capacity. Temporary batch capacity for well-supported first-time donations remains a recommendation. The external examples support separating these decisions; the VRDex policy choice comes from BASIC's approval.

## Research limitations

These sources document how their communities operate. They do not demonstrate that those practices cause better outcomes, establish VRDex-specific abuse thresholds, or resolve permissions to reuse any particular image. Wikipedia's editorial governance, OSM's shared database, and Discourse's forum participation differ from VRDex's owner-centered profiles. Treat the comparisons as design evidence rather than copied policy.
