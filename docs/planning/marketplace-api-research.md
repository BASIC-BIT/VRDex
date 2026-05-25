# Marketplace API Research Gate

## Status

Current recommendation for `#83`. This is a product and engineering gate before any marketplace API sync work is opened.

This document does not authorize implementation. Before coding an integration, re-check the current official API documentation, platform terms, OAuth/application review requirements, rate limits, and data-use restrictions for the specific provider.

## Locked Decision

VRDex starts with typed owner-authored, reviewed, or partner-provided external links for creator storefronts. API sync is deferred.

Reasons:

- creator storefront links are enough for the first public profile and world-page value proposition
- public storefront display does not need buyer, order, payout, license, tax, or webhook payload data
- marketplace APIs vary significantly in OAuth support, product/listing coverage, commercial terms, and operational risk
- self-hostable VRDex deployments need a connector model before per-provider secrets, polling, webhooks, and disconnect behavior are safe to ship

## Provider Posture

### Gumroad

Current recommendation: best first candidate for a future opt-in storefront sync.

Why:

- appears to have an API/OAuth shape better suited to creator-authorized access than simple scraped links
- product/listing display is plausibly useful without touching private transaction data

Required future checks:

- current OAuth scopes and application setup
- whether product/listing reads are available without sales or purchaser data
- webhook terms and whether webhooks are needed at all for display-only sync
- rate limits, caching expectations, and disconnect/token-deletion requirements

### Jinxxy / Jinxie

Current recommendation: owner-authored links only.

Why:

- do not build against unofficial or unstable endpoints
- require official API documentation or written integration guidance before sync work

Required future checks:

- official API availability and terms
- creator authorization model
- allowed public listing fields

### Payhip

Current recommendation: owner-authored links only for v1.

Why:

- available API shape should be revalidated before assuming it supports general public product/listing sync
- do not add a connector unless it can avoid private buyer/order/license data entirely

Required future checks:

- whether a product/listing read path exists for display-only use
- scope separation between listing data and order/license/customer data
- rate limits and webhook data minimization

### WooCommerce

Current recommendation: defer until VRDex has a general external-store connector model.

Why:

- every WooCommerce store is its own host, auth boundary, plugin surface, and reliability/security risk
- connector UX needs per-store URL validation, credential storage, disconnect behavior, throttling, and failure states
- self-hosted and creator-owned stores can have varied privacy and performance constraints

Required future checks:

- minimum scopes for product-only reads
- store URL verification and SSRF protections
- credential encryption and rotation
- backoff/circuit breakers per store

## Allowed Public Sync Fields

Candidate display-only fields, if a future provider explicitly supports them:

- product/listing title
- product/listing URL
- short description or excerpt
- public price display string when already public
- public thumbnail URL when license/terms allow display
- provider name
- last synced timestamp
- creator opt-in state

## Disallowed Data

Do not request, store, or expose these fields for public storefront display unless a separate privacy-reviewed feature explicitly requires them:

- buyer names
- buyer emails
- buyer IP addresses
- order ids
- license keys
- payout data
- tax data
- refund/dispute data
- raw webhook payloads
- transaction rows
- per-buyer analytics

## Future Connector Requirements

Any future marketplace sync issue must include:

- explicit creator opt-in
- least-privilege OAuth or credential flow
- encrypted server-side credential storage
- disconnect flow that deletes stored credentials and stops future sync
- conservative polling with jitter and backoff, unless webhooks are justified
- provider-specific rate-limit handling
- last-synced labels in public UI
- moderation/review escape hatch for unsafe or misleading listings
- tests that assert disallowed transaction/customer fields are not persisted
- docs for self-host operators explaining required provider app setup

## Non-Goals For First Slice

- checkout
- fulfillment
- taxes
- refunds
- license delivery
- sales analytics
- buyer identity
- marketplace account management
- cross-provider inventory normalization
