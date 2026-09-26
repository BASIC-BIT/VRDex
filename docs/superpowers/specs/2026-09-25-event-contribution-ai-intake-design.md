# Community event contribution and AI intake

Status: draft design for BASIC review, updated 2026-09-25. This incorporates BASIC's decisions that a useful contributed event can publish for any community after a reasonable preflight without prior staff or moderator acceptance, that a known-date event may publish with its time TBA, that any signed-in account may contribute without a separate verified-email gate, that contributors may make scoped self-edits, and that an uploaded source poster stays private unless separately published as artwork. Almost all fields may remain partial while drafting. Product implementation and exact public copy are not approved by this draft.

Research: [repo survey and approach comparison](../../planning/event-contribution-intake-research-2026-09-25.md), [AI platform findings](../../planning/event-intake-ai-platform-research-2026-09-25.md), [product direction](../../planning/product-direction.md).

## Outcome

An ordinary contributor can find any public community, enter an event manually or extract it from text or a poster, correct the result, and publish immediately. The event is available by URL, in public event search, and on the community's event listing. Website and MCP use one intake contract and the same server publication rules. Community staff and VRDex moderators can promptly correct or remove false or stale entries.

The agent interprets source material. It does not publish, create identities, write promotional copy, or select streams. A poster is extraction input and private evidence, not automatically public artwork. The existing owner/staff event editor and `vrdex_event_create` keep their current authority boundary. Contributor publication is a distinct API/OAuth scope and MCP path.

## Journey

```mermaid
flowchart LR
  subgraph Current
    A[Account] --> B[Events] --> C[Add event for managed community] --> D[Owner editor] --> E[Public event]
    M[Owner MCP event create] --> E
  end
  subgraph Proposed
    F[Events browse] --> G[Add event]
    H[Community page] --> G
    I[Direct contribute link] --> G
    J[MCP event intake] --> K[Shared editable intake]
    G --> L[Sign in] --> N[Pick any public community] --> O[Manual, text, or poster]
    O --> K
    K --> P[Check time, lineup, source] --> Q[Publish after preflight]
    Q --> R[Event page, search, community events]
    R --> S[Report or staff correction] --> T[Edit, cancel, or remove]
  end
  subgraph Later
    U[Calendar candidate] --> K
  end
```

`Add event` is visible even without a managed community. A community page or direct link preselects the target. Authentication returns the contributor to their intake. MCP offers explicit extract/preview and publish tools with idempotent receipts and readback. The public event source is shown in plain metadata without implying owner confirmation. Exact public-facing wording needs BASIC's review.

## Shared intake and agent

Manual, text, and poster inputs converge on a partial `EventIntakeDraft` type. Almost every event field is optional while drafting: community match, title, date, start/end/doors time, timezone, venue, source URL, summary, poster, worlds, and each performer and slot detail. A draft can begin with one meaningful field, a text description, or a poster; it need not pass publication validation to save. The draft records missing, tentative, and conflicting interpretations separately from contributor-confirmed values. It can hold ordered untimed lineup names and tentative person matches. It cannot be the current canonical `EventDraftInput`, which requires a title and timestamp.

Private drafts are resumable across website and MCP. They have an actor, version, timestamps, source reference, optional partial fields, and a bounded cleanup period. Save and update enforce size, access, and quota limits, not event publication minimums. Publication checks the current draft version, runs the ordinary preflight, creates one canonical event, and records a receipt so retries cannot create another event. This is draft persistence for unfinished work, not a community acceptance queue. A fully specified manual API submission may use the same normalization/publication path without creating a long-lived draft row.

Draft field semantics must be explicit across web and MCP: omitted in an update means unchanged; `null` clears a value; an empty string is normalized to unknown; `timeTba` is an affirmative schedule state rather than a guessed `startAt`; and an AI candidate remains tentative until the contributor accepts or replaces it. Saving a draft with a poster but no extracted fields is valid. Saving a wholly empty draft should not create a durable row. No placeholder title, person, time, venue, or timezone is silently generated to satisfy a schema.

The parser is a short VRDex-owned server loop using a vision-capable model, strict structured output, and a fixed budget of read-only calls. Candidate tools: `search_people`, `search_communities`, and `resolve_local_time`, all returning bounded public data. Time resolution reports zero, one, or multiple valid instants. The model separates directly observed facts, calculations, guesses, conflicts, and unknowns, and can propose lineup order and possible identities. VRDex revalidates every returned ID. A possible match is not silently confirmed.

The extraction output has `event`, `lineup[]`, `evidence[]`, and `questions[]` fields, with explicit nulls for unknown facts. Actor identity, approval state, and publication fields are server-owned. The contributor sees the source and populated fields, edits them, and deliberately invokes publish. Refusal, malformed output, provider failure, or incomplete extraction leave manual entry available. The agent has no mutation tools.

The existing VRDex Time endpoint is beta-gated. Benchmark its internal planner/executor against a model calling deterministic time utilities on a labeled poster set. Choose by measured accuracy, latency, and cost. Neither the model nor the current browser timezone helper may silently pick an instant during a repeated daylight-saving hour.

## Publication and authority

Locked decision: any signed-in account can contribute for any public community, whether claimed or unclaimed. Event contribution adds no separate verified-email gate. Browser mutations use the active user session; API and MCP publication require a user-scoped credential carrying a distinct event-contribution scope. A contributor receives no `manage_events` authority. Existing `events:write` remains owner/staff authoring.

Preflight checks actor and target, required event fields, bounded text and safe links, valid local time, account/target quotas, idempotency, duplicate or removed-event fingerprints, and content risk. Exact duplicates return the existing event; near matches are shown before publication rather than silently merged. A contributor cannot set trusted provenance, owner confirmation, private notes, live watch mode, selected streams, or event-media controls. Performer links derive from matched public profiles.

A passing contribution writes a published canonical `events` row, lineup, source/audit evidence, and the public search document as one operation. Current event creation already reindexes search on publication. The response returns a canonical URL and receipt. Publication does not wait for a community queue. The source is marked community-submitted. Current recommendation for the public minimum is a public community, identifying title, and event date; a source URL or poster strengthens the smell test but is not required for manual entry. A known date without a start time publishes with an explicit time-TBA state. Unknown-date extractions remain drafts. Other fields can remain unknown or be added later.

Date-only is a real schedule state, not a made-up midnight timestamp. Current `events`, public API contracts, search freshness, community/upcoming queries, event cards, Discord export, ICS export, and watch timing all assume a numeric `startAt`. Current recommendation: represent exact-time and date-only schedules distinctly, with a separate internal sort key for indexing. Existing events migrate as exact-time events. Date-only public data exposes the authored calendar date unchanged for every viewer and omits an exact start instant; only timed events convert to the viewer's local timezone. ICS uses `DTSTART;VALUE=DATE` plus a time-TBA description, following [RFC 5545's date-valued event form](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.6.1). A calendar may render this as all-day, so the text must say that the time is unknown, not that the event runs all day. Event cards show the date and time TBA, and watch/autoplay stays inactive until a real start is supplied. Search and community lists still include the event on the correct date. This is a deliberate cross-surface change, not a display-only label.

The public lineup can also be partial. Timed slots continue to use exact times when known. An untimed performer remains an ordered lineup entry. An unmatched name remains a plain label; a matched person can link to their public profile and provide their existing outbound links. Neither an approximate slot time nor a guessed person ID becomes canonical without explicit contributor review. The current canonical tables require a start time for slots and a person ID for participants, so publication needs a small public lineup representation for untimed/unmatched entries instead of discarding them.

## Smell test, correction, and removal

The baseline gate is deterministic: account and target limits, source/URL bounds, temporal sanity, duplicate/repost controls, and suppression checks. [OpenAI's moderation endpoint](https://developers.openai.com/api/docs/guides/moderation) classifies defined harmful-content categories, not event spam or factual authenticity. A separate low-cost event-spam classifier is a candidate after shadow-mode evaluation on genuine, duplicate, malicious-link, fabricated, and unusual-format events. Only high-confidence violations should block publication. Uncertain cases can publish with a prompt post-publication review flag. If the classifier is unavailable, deterministic preflight still permits publication and flags the event for prompt post-publication sampling; failures must be observable to operators and cannot quietly become a community-approval queue.

Community owners and `manage_events` staff can edit, cancel, or unpublish contributed events immediately. VRDex moderators need a separate audited removal path because current `canUpdateEvent` recognizes only community authority. Visitors need an event-specific report action. Reports do not automatically retract an event. Removal must affect page access, search, community lists, and feeds, and a bounded fingerprint prevents immediate recreation. These capabilities are part of the initial delivery slice because publication is immediate.

Locked decision: the original contributor can directly edit their published listing within a scoped field set. Current recommendation: title, date/time/TBA state, venue, source URL, summary, and lineup are editable; community attachment, source attribution, trust fields, live watch controls, and moderator state are not. Every edit checks the current event version, reruns the same publication preflight, records changed fields, and updates search/feed projections. A staff edit or explicit takeover closes direct contributor editing and makes future contributor changes correction suggestions, preventing a stale contributor write from undoing staff work. The contributor can retract their own listing before staff takeover with an audit trail; moderators/staff can restore or republish it. Exact field scope and takeover UI are implementation details to review in the plan.

## Source handling and operations

The website accepts poster files. MCP local-file clients use a short-lived purpose-bound upload bridge. Do not fetch arbitrary remote poster URLs in the first slice. Validate image type, size, and decoding; keep source material private and time-bounded; expose it only to the contributor and authorized reviewers. A source URL is a citation, not crawl permission. Locked decision: parsing a poster does not display it publicly. Publishing the uploaded image as event artwork is a separate affirmative action with its own asset checks; it never happens as a side effect of extraction or event publication. Review consent, retention, deletion, and provider data controls before production image intake.

Current retention recommendation: discard an abandoned draft's private source image 30 days after last activity, capped at 180 days after upload; for a published event, retain private source evidence until 30 days after its event date, also capped at 180 days after upload. A live report or dispute can pause deletion for that specific evidence item until resolved. A separately published artwork asset has its own lifecycle and must not prolong the private evidence copy by accident. Delete provider-uploaded files when no longer needed where the provider API permits; retain only a nonreconstructive hash, source kind, and audit receipt after evidence expiry. These numbers are operational defaults to validate against actual moderation need and privacy policy, not product claims.

Measure parse attempts, publish conversion, preflight blocks, reports, confirmed spam, false positives, false identity matches, latency, tool calls, tokens, and cost per published event. Log IDs and reason classes instead of poster content. Cap model calls and per-account usage, provide an operator kill switch, and keep manual publication available within the chosen abuse policy. Self-hosters bring model credentials for AI features; the manual path works without them.

## Delivery and evidence

Target one cohesive PR: shared intake/API/MCP contract, public entry points, manual path, poster/text agent, immediate publication, correction/report/removal, docs, and visual evidence. Keep the existing owner path functional. If the classifier is not reliable enough, ship deterministic preflight and post-publication moderation with the classifier disabled rather than inventing mandatory approval. Avoid a separate research-only PR.

Verify partial extraction and strict normalization; DST, cross-midnight times, aliases, unlinked performers, malformed URLs, duplicates, retries, and removal; arbitrary-community contribution versus owner edit authority; MCP recovery; model fixtures using consented and adversarial posters; browser flows through public search and direct URLs; and desktop/mobile screenshots with visual review. Extraction accuracy, spam false positives, latency, and cost are separate measures. Automated preview is not live-provider proof.

## Review points before implementation planning

Retention duration, contributor-edit field scope, staff takeover, and classifier outage behavior have concrete recommendations above. The implementation plan must include a labeled fixture evaluation for the parser and any classifier before production rollout. Every parser result must be schema-valid or an actionable error, every suggested person ID must come from an actual lookup result, and ambiguous time must remain unresolved until a person chooses. Launch-specific accuracy, latency, and cost thresholds should be set from that fixture baseline before model configuration is enabled. No exact public-facing explanatory copy is approved in this draft.
