# Temporal Parsing Service

## Status

- `Locked decision`: VRDex owns the hosted temporal parsing product, public API,
  deterministic runtime, serving operations, quotas, and promotion evals.
- `Locked decision`: the training dataset and training pipeline remain in
  `discord-time-app` for this delivery. VRDex consumes a promoted, immutable
  model artifact and does not create a live cross-repository dependency.
- `Current recommendation`: ship the first useful vertical slice as a closed
  beta for one explicitly granted VRDex account, then widen it through measured
  rollout and account quotas.

## Product In Plain Language

VRDex Time turns a short phrase such as `next Friday at 8pm Eastern` into a
canonical instant or time range. A small fine-tuned language model translates
the phrase into a constrained Temporal Plan-IR. VRDex validates that plan and a
deterministic calendar and timezone executor produces the answer. The model is
never trusted to invent the final epoch timestamp directly.

The first client is a small page on the VRDex website. The same capability is
also a public, authenticated utility API so other VRDex products and external
developers can use it without copying the model runtime.

## Why VRDex Owns It

VRDex already owns accounts, verified email, API credentials, OAuth direction,
usage limits, product analytics, billing foundations, public documentation, and
event authoring. That makes it the right product boundary for a hosted model.
`discord-time-app` remains the historical experiment and training workspace;
HammerOverlay may later consume VRDex Time as an ordinary client.

## Accuracy Boundary

Locked behavior:

1. The model returns compact Temporal Plan-IR JSON.
2. VRDex schema-validates the output.
3. VRDex executes calendar math and timezone conversion deterministically.
4. Ambiguous input returns a clarification outcome.
5. Invalid, unsupported, or low-confidence input never silently becomes a
   singular timestamp.

The promoted baseline is Qwen/Qwen3.5-0.8B with the
`qwen-temporal-ir-qwen35-08b-bf16-chat-time-range-2687-lora` adapter. The
handoff baseline passed 153 required cases and one diagnostic case. VRDex must
reproduce that executor-backed gate before promoting a different artifact,
prompt, precision, quantization, or serving stack.

## Public Product Surface

### Website

The first website surface is a minimal signed-in parser:

- text input
- viewer timezone, locale, country, and optional subdivision defaults
- explicit reference instant override behind an advanced control
- canonical instant or range result
- concise clarification when the input is ambiguous
- visible warming state that continues automatically
- transparent input-retention control

The page should prewarm the model when an eligible user arrives. Prewarming is
best effort and must not consume a parse quota or create a fake usage result.
A durable, global five-minute cooldown ensures that repeated or concurrent page
loads trigger at most one provider prewarm request.

### API

The provider-neutral contract is:

```http
POST /api/v0/time/parse
GET  /api/v0/time/parse/{continuationToken}
```

Initial request fields:

```json
{
  "text": "next Friday at 8pm Eastern",
  "timeZone": "America/Indianapolis",
  "locale": "en-US",
  "country": "US",
  "subdivision": "IN",
  "referenceInstant": "2026-07-21T16:00:00Z",
  "retainInput": true
}
```

- `text` is required, trimmed, and limited to 500 characters.
- `timeZone` is an optional valid IANA zone. The signed-in website supplies the
  browser zone. API callers that omit it receive the documented service default
  of `America/New_York` during beta.
- `locale`, `country`, and `subdivision` are optional validated hints applied by
  the deterministic executor after the model returns Plan-IR. The inference
  worker receives only text, the effective reference instant, and timezone.
- `referenceInstant` is optional. VRDex materializes the request instant when it
  is omitted and stores that immutable value with the accepted job, so queueing
  and retries cannot change the meaning of relative phrases.
- `retainInput` is optional and follows the account preference when omitted.
  `false` is a per-request opt-out.

Successful resolution and clarification are both `200` domain outcomes.
Canonical data is returned; Discord timestamp strings remain presentation logic
for clients or higher-level VRDex application services.

The website route at `/api/time/parse` is a signed-in session facade over the
same service contract; it is not a second parser. API callers may send an
optional `Idempotency-Key` header containing 1 to 128 letters, numbers, dots,
underscores, colons, or hyphens. Reusing a key for the same account within the
15-minute continuation window returns the original accepted job. A key must
only be reused for an identical request.

### Continuations And Cold Starts

Cold startup is expected behavior, not a server failure after work has been
accepted. When a warm result cannot be returned inside the synchronous budget:

1. VRDex creates a durable job and kicks the inference worker.
2. The API returns `202 Accepted` immediately with an opaque continuation token,
   `Location`, `Retry-After`, estimated wait, and expiry.
3. The client polls the continuation route.
4. Polling returns `202` while pending and `200` with the stored result when
   complete.
5. Expired continuations return `410 Gone`.

The job record in Convex is the durable source of truth. The beta does not use a
separate result cache. Retrieval requires both a currently valid account
credential and the continuation token; the job lookup is bound to its owner
account, so another account cannot redeem the token. Persist only the token hash
and redact tokens from logs and analytics URLs. Rotating a personal token does
not strand the job: any valid `time:parse` credential for the same account can
poll it.

## Authentication And Rollout

Locked beta behavior:

- an active Convex `use_temporal_parsing_beta` account grant is required
- verified email is required
- the website uses the signed-in session
- the public endpoint initially accepts scoped personal API tokens
- OAuth exposure is deferred until the beta contract is stable

PostHog manages presentation rollout and measurement, not authorization. The
web app mirrors the authorized Convex result into the string person property
`temporal_parsing_beta=true`. The Terraform-managed
`temporal-parsing-beta` flag targets that property. A PostHog flag must never
grant API access or reveal the private beta surface to an unauthorized account.

The first grant is for the product owner's account only. The grant remains an
operator action rather than a committed email address or account identifier.

## Quotas, Cost, And Monetization

The beta starts free with defensive limits:

- token burst limit
- account aggregate limit across every personal token and the website session
- one in-flight parse per account
- one global model worker until measurement justifies more
- daily and monthly usage accounting (beta defaults: 250 per UTC day and 2,000 per UTC month)
- operator kill switch

The initial `$50/month` figure is an operating target, not an absolute product
ceiling. Alerts and a kill switch protect against abuse, but the service should
not surprise-disable ordinary use solely because an early estimate was wrong.

Public pricing is deliberately unresolved. Regular authenticated users should
eventually be able to try the utility. A paid tier may provide a much larger
allowance or cover genuinely costly operation, but monetization should not make
a small general-purpose utility feel extractive. Do not reuse operational trust
tiers as product plans.

## Data And Learning Posture

Temporal inputs are valuable product and future training data. VRDex may retain
them when the user has not opted out, subject to these locked boundaries:

- tell the user that inputs may be retained to improve the parser
- provide an account-level opt-out and a per-request `retainInput: false`
- do not sell temporal input data
- warn users not to submit secrets, sensitive personal information, or
  regulated data
- keep raw text out of PostHog event properties, ordinary request logs, error
  reporting, and provider logs
- store retained text in a controlled Convex record with owner, purpose,
  retention state, model revision, and deletion support
- retain outcome, latency, cost, and aggregate usage metrics even when raw input
  retention is disabled, provided they contain no input text

For an opted-out request, the accepted job holds its text and keyed input hash
only while needed for inference, then deletes both on completion, failure, or
expiry. An opted-in beta expression remains stored until the account turns
retention off or an operator deletes it; the beta has no automatic content
expiry. Turning the account preference off takes effect immediately, prevents
in-flight jobs from retaining content, and deletes retained beta history in
bounded asynchronous batches. The website confirms this destructive action.

The initial parser is intentionally bounded to simple temporal phrases. Before
accepting arbitrary event descriptions, poster images, or third-party personal
data, revisit consent, retention, deletion, provider DPA, access controls, and
training-use disclosures.

## Serving And Operations

The first provider benchmark is a RunPod Serverless load-balanced endpoint with
scale-to-zero, one worker, a narrow internal bearer credential, and a
VRDex-owned container. Provider setup should be driven through Terraform,
`runpodctl`, or the RunPod API. Browser setup is acceptable only for an
unavoidable first-time account, payment, or terms action and must be followed by
checked-in reproducible configuration.

The inference process exposes only:

- `GET /ping`: `204` while loading, `200` when ready, and `503` after startup failure
- `POST /infer`: the bounded Temporal Plan-IR request

It does not expose a general OpenAI-compatible completion surface. Base model,
adapter, tokenizer, dependencies, and container are pinned by immutable revision
or digest. Provider credentials are server-only and can be rotated without a
client change.

No billable provider resource is created as part of code delivery without
explicit operator approval. The repository should still contain the container,
configuration contract, automation, smoke test, and human bootstrap steps.

## Evaluation And Observability

Every promotion report records:

- required and diagnostic pass counts
- wrong singular answer count
- Plan-IR validity and rejection counts
- warm p50/p95/p99
- cold-start phases and ready time
- one-request and bounded-burst behavior
- provider worker seconds and estimated cost per 1,000 parses
- model, adapter, tokenizer, dependency lock, container digest, provider
  revision, GPU, precision, and prompt format

PostHog receives product events and coarse operational dimensions, never raw
input text. Convex is authoritative for usage and retained examples. Provider
metrics diagnose infrastructure. Promotion requires executor-backed parity, not
only syntactically valid model output.

## Future Event Understanding

Candidate direction:

- add a separate preview endpoint that turns a natural-language event request
  into editable structured draft fields
- let that endpoint extract the temporal phrase, slot count, slot duration, and
  other event fields, then call VRDex Time for the authoritative schedule
- keep preview separate from event creation so probabilistic interpretation
  never mutates product data automatically
- compare a fast hosted LLM plus the specialized temporal SLM against an LLM
  using deterministic temporal tools; measure accuracy, latency, and cost
- later accept posters as extraction input for human review; never treat
  extracted details as owner-confirmed without review

Language models in these flows understand and structure user-provided intent.
They should not replace a creator's voice or generate public creative content by
default.

## Delivery Gate

The implementation is complete only when:

1. canonical docs and the source migration manifest exist
2. the VRDex-owned runtime and narrow inference container build locally
3. migrated required evals reproduce the baseline against the promoted artifact
4. authorization, personal-token scope, account quotas, durable continuation,
   retention opt-out, usage records, and kill switch have automated coverage
5. the website parser passes functional and visual review
