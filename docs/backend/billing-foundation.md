# Billing Foundation

## Status note

This is the first-pass billing foundation for GitHub issue
[#58](https://github.com/BASIC-BIT/VRDex/issues/58).

It establishes internal Convex state for Stripe-backed billing without making
live Stripe calls, adding the Stripe SDK, creating provider resources, or
locking paid plan packaging.

## Locked decision

- product code should read internal entitlement snapshots, not Stripe directly
- Stripe customer ids, subscription ids, price ids, and event ids are internal
  backend state
- webhook processing must be idempotent and preserve event provenance when it is
  implemented
- actual Stripe webhook handling, Checkout/customer creation calls, and billing
  portal session calls remain follow-up work

## Current implementation

- `convex/schema.ts` defines `billingCustomerMappings`,
  `billingSubscriptionSnapshots`, and `billingEntitlementSnapshots`
- `convex/_billing.ts` defines shared validators plus pure status helpers for
  subscription and entitlement state
- `tests/backend/billing-foundation.test.ts` covers status normalization and the
  subscription-to-entitlement derivation rule

`billingCustomerMappings` maps an internal owner to a Stripe customer. The owner
can be an app user or a profile. Community-owned billing should prefer the
community profile owner path once the product flow exists.

`billingSubscriptionSnapshots` stores the current internal projection of a
Stripe subscription. It records Stripe ids, normalized status, current period
timestamps, cancellation timestamps, and last Stripe event provenance.

`billingEntitlementSnapshots` stores the product-facing entitlement state. This
is the table product features should query once paid features exist.

## Expected environment variables

No current runtime code reads these variables yet. These names are the committed
bootstrap contract for the follow-up work that implements Stripe calls.

Server-only Convex or backend environment:

- `STRIPE_SECRET_KEY`: Stripe secret API key for the active deployment
  environment. Store only in Convex, Vercel, or another approved secret store.
- `STRIPE_WEBHOOK_SECRET`: Stripe webhook endpoint signing secret. Store only in
  the backend secret store for the deployment that receives the webhook.
- `STRIPE_API_VERSION`: optional non-secret version pin once SDK calls are
  added. Prefer a committed code-level constant if the SDK path makes that
  simpler.
- `VRDEX_STRIPE_PORTAL_RETURN_URL`: non-secret URL where Stripe billing portal
  sessions should return the user.
- `VRDEX_STRIPE_CHECKOUT_SUCCESS_URL`: non-secret Checkout success URL when
  Checkout-based customer creation is implemented.
- `VRDEX_STRIPE_CHECKOUT_CANCEL_URL`: non-secret Checkout cancel URL when
  Checkout-based customer creation is implemented.

Not needed in this pass:

- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`: defer until a billing UI or browser-side
  Stripe.js flow exists.
- plan or price environment variables: defer until paid plan packaging is
  decided. Prefer Stripe lookup keys or committed non-secret catalog config over
  ad hoc dashboard-only price ids.

Secret owner and rotation rule:

- the deployment operator owns the Stripe secret values
- rotate `STRIPE_SECRET_KEY` from the Stripe dashboard or Stripe CLI, then update
  the backend secret store before enabling code that uses the new key
- rotate `STRIPE_WEBHOOK_SECRET` by rolling the webhook endpoint secret, updating
  the backend secret store, and replaying a harmless test event before removing
  the old secret path
- never commit secret values, webhook signing secrets, customer ids tied to real
  users, or live subscription ids in examples or fixtures

## Customer Creation Direction

Current recommendation:

- customer creation should be initiated by an authenticated backend action once a
  user has a verified email and has selected the owner being billed
- the action should first look for an active `billingCustomerMappings` row for
  the internal owner and Stripe environment
- if no mapping exists, the action may create a Stripe customer and persist the
  returned customer id in `billingCustomerMappings`
- all later Checkout, portal, and webhook flows should resolve through the
  internal mapping before updating subscription or entitlement state

Follow-up boundary:

- this first pass does not create Stripe customers or expose a customer creation
  mutation
- safe no-secret stubs can be added later if a UI or integration test needs a
  deterministic shape before live Stripe calls exist

## Webhook Direction

Current recommendation:

- use a Convex HTTP action such as `/stripe/webhook`
- verify the Stripe signature with `STRIPE_WEBHOOK_SECRET` before parsing or
  trusting the payload
- handle subscription lifecycle events by upserting
  `billingSubscriptionSnapshots` and recalculating
  `billingEntitlementSnapshots`
- persist `lastStripeEventId` and `lastStripeEventCreatedAt` on updated rows so
  replay handling and debugging have durable provenance
- treat unknown or unsupported subscription statuses as `unknown` and derive
  inactive entitlements by default

Minimum useful event coverage for the follow-up:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.deleted`

Follow-up boundary:

- this first pass does not expose a Stripe webhook route
- this first pass does not verify signatures or parse Stripe payloads
- a future webhook implementation should add idempotency tests before accepting
  provider traffic

## Billing Portal Direction

Current recommendation:

- portal session creation should be an authenticated backend action
- the action should resolve the active `billingCustomerMappings` row for the
  selected owner
- the action should create a short-lived Stripe billing portal session and return
  the Stripe-hosted URL to the web app
- the app should not store portal session URLs as durable state

Follow-up boundary:

- this first pass does not create portal sessions
- this first pass does not add billing UI or paid feature gating

## Entitlement Status Rule

`deriveBillingEntitlementStatus` currently maps Stripe subscription snapshots to
product-facing entitlement status this way:

- `active` -> `active` while the current period has not expired
- `trialing` -> `trialing` while the current period has not expired
- `past_due` -> `grace_period` while the current period has not expired
- `incomplete` -> `pending`
- `canceled`, `incomplete_expired`, `paused`, `unpaid`, and `unknown` ->
  `inactive`

This is intentionally conservative. Product features can later decide which
entitlements treat `trialing` or `grace_period` as usable, but unknown or stale
state should not unlock paid behavior by default.

## Verification

Run the narrow billing helper tests after changing status behavior:

```sh
pnpm exec node --import tsx --test tests/backend/billing-foundation.test.ts
```

For schema changes, run the backend typecheck when dependencies are installed:

```sh
pnpm typecheck:backend
```
