# VRDex Time API

VRDex Time converts a short natural-language time expression into a validated
canonical instant, time range, or clarification.

## Beta access

The closed beta requires:

- a verified VRDex email address
- an account grant from the VRDex operator
- a user-owned personal API token with the `time:parse` scope

OAuth access is not enabled during the closed beta.

The default beta allowance is 6 submissions per minute, 250 per UTC
day, and 2,000 per UTC month, with one in-flight parse per account. Operators
may lower or raise the daily and monthly values without changing the API
contract.

## Submit a parse

```bash
curl https://vrdex.net/api/v0/time/parse \
  --request POST \
  --header "Authorization: Bearer $VRDEX_API_TOKEN" \
  --header "Content-Type: application/json" \
  --header "Idempotency-Key: 019f-temporal-example" \
  --data '{
    "text": "next Friday at 8pm Eastern",
    "timeZone": "America/Indianapolis",
    "locale": "en-US",
    "country": "US",
    "subdivision": "IN"
  }'
```

`text` is required and limited to 500 characters. `timeZone` is an IANA
timezone. `locale`, two-letter `country`, short `subdivision`, and ISO
`referenceInstant` are optional. Regional hints are applied by the
deterministic executor after Plan-IR generation. The worker itself receives
only text, timezone, and the effective reference instant. API calls that omit
`timeZone` use `America/New_York` during beta.

When `referenceInstant` is omitted, VRDex records the request's acceptance time
and stores it with the job. Polling and retries therefore preserve the meaning of
relative phrases. `Idempotency-Key` is optional; reuse the same key only when
retrying the identical request. For the same account, reuse within the 15-minute
continuation window returns the originally accepted job instead of consuming a
second quota unit. The idempotency lookup and bearer continuation are separate:
accepting a new job after expiry creates a new continuation token, so an expired
continuation URL cannot retrieve the replacement job.

The response contains canonical timestamps, not Discord presentation strings.
Turn an epoch `E` into Discord syntax in client code with `<t:E>` or
`<t:E:R>`.

Resolved instant example:

```json
{
  "requestId": "job-1",
  "status": "resolved",
  "kind": "instant",
  "epoch": 1785369600,
  "canonical": {
    "isoInstant": "2026-07-30T00:00:00.000Z",
    "zonedDateTime": "2026-07-29T20:00:00-04:00[America/New_York]",
    "timeZone": "America/New_York",
    "precision": "relative",
    "weekday": "wednesday"
  },
  "confidence": 0.96,
  "method": "trained_plan",
  "assumptions": []
}
```

`epoch` values are Unix seconds. A `time_range` result uses
`range.start` and `range.end`; each endpoint contains its own `epoch` and
`canonical` object.

## Cold starts and continuations

A warm parse may return `200` immediately. If the scale-to-zero model is cold,
VRDex accepts the work and returns `202 Accepted`:

```json
{
  "requestId": "...",
  "status": "pending",
  "continuationToken": "...",
  "retryAfterSeconds": 2,
  "estimatedWaitSeconds": 30,
  "expiresAt": "2026-07-21T16:15:00.000Z"
}
```

Poll the URL in the `Location` header, or construct the request directly:

```bash
curl "https://vrdex.net/api/v0/time/parse/$CONTINUATION_TOKEN" \
  --header "Authorization: Bearer $VRDEX_API_TOKEN"
```

Keep the continuation token private. It expires after 15 minutes. Poll no faster
than `Retry-After`; polling is independently bounded by the authenticated
public-read rate limit. Retrieval requires both the continuation token and a
currently valid personal token for the same VRDex account that submitted the
job. Any valid `time:parse` personal token for that account can continue the
job after credential rotation.

The website uses a signed-in session facade at `/api/time/parse` over this same
contract.

## Outcomes

- `resolved`: a validated instant or ordered time range
- `needs_clarification`: a question and zero or more safe alternatives
- `no_plan`: the input did not produce a safe interpretation
- RFC 9457 problem response: authentication, quota, capacity, configuration, or
  provider failure

Do not treat `no_plan`, `needs_clarification`, or a service error as a
timestamp.

## Input retention

Temporal expressions may be retained to improve the parser. Set
`"retainInput": false` to opt out for one request. The website also provides an
account default. Turning off the website preference deletes retained expressions
from current beta history and prevents in-flight expressions from being
retained.

For an opted-out request, VRDex holds the expression and keyed input hash only
until the job completes, fails, or expires, then removes both while keeping
non-content outcome and latency metrics. The completed response remains
available only through the 15-minute continuation window, after which VRDex
removes it and any content-derived error detail. A separate keyed fingerprint
of the complete request may remain through that same window so VRDex can reject
an `Idempotency-Key` reused for different input; it cannot recover the expression
and is deleted at expiry. A keyed account-and-idempotency lookup identifier is
likewise deleted at expiry; it does not contain the raw key or expression.
Opted-in beta expressions have no
automatic content expiry: they remain until the account turns retention off or
an operator deletes them. Account opt-out takes effect immediately; large
histories finish deletion asynchronously in bounded batches.
Turning retention off also removes stored completed results from that retained
history. Polling one of those still-unexpired continuations returns `410 Gone`.

Do not submit passwords, tokens, sensitive personal information, regulated
data, or private third-party material. Raw temporal text is not sent to PostHog
or ordinary logs and does not belong in client logs.

## OpenAPI

The complete machine-readable contract is available at:

- `/api/v0/openapi.json`
- `/api/v0/openapi.yaml`
