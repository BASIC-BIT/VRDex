# Product Analytics and Feature Flags

## Status note

This document is the canonical first-pass direction for product analytics, feature flags, and lightweight experimentation in `VRDex`.

Use it when deciding whether a feature should ship directly, behind a flag, with staged rollout, or with explicit product instrumentation.

## Locked decision

- product analytics and feature flags are part of delivery discipline, not bolt-ons after launch
- the repo should prefer one primary tool per concern until a real gap appears
- `Langfuse` is not a substitute for product analytics or feature flags; it is a separate LLM and agent observability concern
- trivial or obviously low-risk work should not be forced through heavyweight instrumentation or rollout ceremony

## Current recommendation

- use `PostHog` as the first-pass default for product analytics, feature flags, and basic experiments
- defer `Google Analytics` unless there is a concrete marketing or top-of-funnel website need that `PostHog` is not covering well enough
- defer `LaunchDarkly` or another dedicated flag platform unless rollout sophistication clearly outgrows the integrated approach
- require non-trivial feature issues to state rollout posture and success-signal expectations explicitly, even when the answer is `not needed`

## Why this is the current recommendation

- `PostHog` covers the main early needs in one place: product events, feature flags, and simple experiments
- an integrated tool keeps setup and contributor expectations simpler during v0.5 and early v1
- separate tools can still be added later if scale, governance, or rollout complexity justifies the extra operational drag

## Tool roles

### `PostHog`

Use as the default first-pass system for:

- product analytics
- feature flags and kill switches
- lightweight experiments
- launch and adoption signals for new features

### `Google Analytics`

Treat as optional later infrastructure for:

- marketing-site traffic
- acquisition and SEO reporting
- top-of-funnel website analysis if a real gap appears

Do not treat it as the main product analytics backbone by default.

### `LaunchDarkly`

Treat as a credible later option if `VRDex` needs:

- more advanced rollout governance
- stronger environment separation or approval controls
- flag management that has clearly outgrown the integrated default

Do not add it just because it is a well-known flag vendor.

### `Langfuse`

Treat as a separate concern for:

- LLM and agent traces
- evals and prompt-quality analysis
- agent loop health and observability

It does not replace product instrumentation.

## Minimum expectation for v0.5 non-trivial features

Before implementation starts, every non-trivial feature should answer:

1. What is the rollout posture: direct ship, flagged, or staged?
2. Is a feature flag or kill switch needed?
3. What is the primary success signal?
4. Is any guardrail or health signal needed?
5. If instrumentation is deferred, what simpler signal or follow-up issue covers the gap?

This should stay lightweight. The point is to avoid shipping blind, not to build a miniature BI program for every issue.

## When direct ship is usually acceptable

- typo, copy, and docs-only changes
- low-risk bug fixes with narrow blast radius
- internal cleanup or refactors with no user-visible behavior change
- small admin or operator improvements where staged rollout adds little value

## When feature flags are usually expected

- new user-facing flows where adoption or UX is uncertain
- claim, identity, permissions, trust, moderation, or billing-adjacent changes
- features with meaningful blast radius or rollback risk
- work that benefits from fast disablement without a redeploy

## When explicit analytics are usually expected

- onboarding or activation changes
- discovery, profile, community, or event flows where usage matters to product learning
- paid conversion, premium unlock, or other monetization-adjacent changes
- experiments where success should be measured instead of guessed

## Lightweight acceptable answers

`Not needed` is acceptable when it is honest and brief.

Examples:

- `Rollout: not needed - narrow bug fix with low blast radius`
- `Signals: not needed - success is binary and covered by manual verification`
- `Guardrail: not needed - no meaningful user-facing behavior change`

## Agent-first workflow expectations

- `docs/agentic/definition-of-ready.md` should reference this policy when asking for rollout and signal plans
- `docs/agentic/definition-of-done.md` should reference this policy when checking rollout state and instrumentation completion
- if a feature intentionally launches without desired instrumentation, record that explicitly and create follow-up work when needed
- do not let agents hide behind `future analytics` language without saying what the temporary success signal is

## Candidate direction

- standardize a small event taxonomy once the app implementation starts, likely around activation, discovery, conversion, and trust-critical flows
- add a reusable implementation helper layer so contributors do not hand-roll flag or event calls inconsistently
- define environment defaults such as local-dev behavior, preview behavior, and production-safe fallbacks once the app exists

## First Discovery Event Taxonomy

Current discovery instrumentation uses PostHog when `NEXT_PUBLIC_POSTHOG_KEY` is configured and otherwise no-ops safely.

Locked hosted project:

- organization: `BASIC BIT LLC`
- project: `VRDex Analytics`
- project ID: `447783`
- app host: `https://us.posthog.com/project/447783/home`
- ingestion host: `https://us.i.posthog.com`

The hosted PostHog project is managed/imported through `infra/terraform/posthog`. Hosted Vercel env vars for this project are managed by `infra/terraform/vercel`. Keep the public project key out of committed defaults so forks and self-hosted installs do not accidentally send analytics into the BASIC BIT project.

## Implemented rollout foundation

Locked implementation behavior:

- Convex authorization remains the source of truth for private data. A PostHog
  person property, cohort, or feature flag must never grant backend access.
- The `seed-lookup-beta` flag targets the string person property
  `seed_lookup_beta=true`. The web app mirrors an already-authorized Convex
  result into that property and does not send a raw account identifier.
- The `featured-discovery` flag is disabled by default. It controls the
  unfinished Featured module on `/discovery` until editorial, recommendation,
  and paid-placement behavior has a reviewed policy.
- The Terraform provider manages the feature flag directly. Its current schema
  does not manage cohorts, so an optional analytic cohort may be derived from
  the same property in PostHog without becoming an authorization dependency.
- Browser events use the same-origin `/ingest` reverse proxy. Next.js routes
  ingestion and SDK asset requests to the configured PostHog host.
- Session replay starts only on explicitly public, non-form routes. It remains
  disabled on lookup, handoff, sign-in, account, submission, and editor routes.
- PostHog's `ph-no-capture` class excludes marked private surfaces from
  autocapture, while `[data-ph-no-capture]` blocks and masks session replay.
- Inputs are masked, `[data-ph-no-capture]` blocks sensitive surfaces, URL
  queries and fragments are removed, and `/handoff/<token>` is normalized to
  `/handoff/redacted` before capture.

The proxy adds application-host transfer and request volume. Route-limited
replay keeps that cost and privacy exposure bounded while preserving replay on
public discovery and profile surfaces.

Initial events:

- `search_submitted`
- `search_result_clicked`
- `discovery_filter_selected`
- `event_card_clicked`
- `featured_card_clicked`
- `lookup_submitted`
- `private_seed_results_shown`

Authentication lifecycle events are intentionally separate from product
identity and content:

- `auth_session_restore_completed`
- `auth_session_restore_slow`
- `auth_session_signout_requested`
- `auth_session_state_changed`
- `recent_auth_challenge_presented`
- `recent_auth_challenge_completed`
- `sensitive_action_denied`
- `session_revocation_requested`
- `session_revocation_started`
- `session_revocation_completed`
- `session_revocation_detected`

Application-supplied properties use fixed deployment, browser/OS family,
route-class, latency, transition-intent, action-class, outcome, and revocation
scope enums only. Do not attach tokens, IDs, emails, provider payloads,
redirects, route slugs, IP addresses, or device fingerprints. PostHog's SDK
still supplies its standard transport envelope and person/session metadata;
this narrower contract applies to properties supplied by VRDex. Authentication,
account, claim, and developer routes remain outside session replay.

Discovery and lookup events avoid search terms, profile slugs, private profile
fields, raw authentication identifiers, seed values, and unsupported popularity
claims. Revisit retention and privacy copy before broad public launch.

## Product-learning data

Locked decision:

- Product analytics events should remain sparse and avoid raw user content.
- A product workflow may separately retain user-submitted source material when
  that material is genuinely useful for improving the product, the purpose is
  disclosed, and the user can opt out.
- PostHog is not the raw-content store. Retained source material belongs in a
  controlled product record with owner, purpose, retention state, deletion
  support, and access boundaries.
- VRDex does not sell retained user-submitted source material.

The temporal parser is the first explicit application of this rule. It may
retain temporal input text for parser improvement unless the account or request
opts out. The UI and API must warn users not to submit sensitive material. Raw
temporal text must not appear in PostHog properties, URLs, session replay,
ordinary logs, or provider telemetry. This narrow decision does not authorize
unannounced capture in unrelated editors, private forms, claims, or imports.

Before enabling replay or raw-content learning beyond the closed beta, document
the consent or other legal basis, content-retention period, staff-access
boundary, deletion path, and account opt-out behavior for that exact surface.

The `temporal-parsing-beta` PostHog flag mirrors the backend-authorized
`use_temporal_parsing_beta` grant for UI rollout and measurement. Convex remains
the authorization source of truth.

## Interview later

- whether public marketing pages eventually justify a separate `Google Analytics` installation
- whether `PostHog` remains sufficient once rollout governance and org complexity increase
- which specific v0.5 events deserve to be mandatory rather than suggested

## Relationship to other docs

- `docs/agentic/definition-of-ready.md` uses this policy for rollout and success-signal expectations
- `docs/agentic/definition-of-done.md` uses this policy for rollout-state and instrumentation closeout expectations
- `docs/planning/engineering-strategy.md` keeps the high-level engineering rationale
- `docs/agentic/software-factory.md` places this policy inside the wider delivery loop
