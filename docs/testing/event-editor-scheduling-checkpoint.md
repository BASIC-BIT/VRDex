# Event editor scheduling checkpoint

Date: 2026-10-13. Status: local implementation and verification; controller whole-branch
review, remote PR delivery and hosted acceptance remain separate.

## Scope and command boundaries

[Approved design and journey](../superpowers/specs/2026-10-13-event-editor-lineup-timezone-publish-design.md)
keeps Details, Lineup and Review, optional import, direct publication return and both
existing authoring authorities. Generation explicitly creates 4 x 60 by default;
individual insertion/removal/duration/start edits cascade elapsed timing without
replacing metadata. Reset confirms removal of editable lineup rows and keeps details,
artwork, timezone and fixed end. Dates at midnight and subminute precision remain visible.
Review has one prominent submit, secondary draft/withdrawal and navigation Back.
Profile-editor cleanup remains [deferred](../planning/profile-editor-progressive-disclosure-2026-09-28.md).

Entered and stored ends stay fixed. Review and Lineup show the approved conflict and
actual bounds; the extension action sets only the end when the entire timed lineup end
is known. Unknown ends and optional lineup remain supported. Contributor partial drafts
can save unresolved overruns; staff saves/publication retain existing bounds validation.
Timezone preference precedence is authored draft/event, then Account default for a new
draft, browser, UTC. Event timezone selection does not write the account default.

The controller's four implementation rulings are retained:

1. Shared `getLineupEndAt` supplies fully-known derivation; untimed rows do not add bounds
   and incomplete timed rows prevent a whole-lineup end claim.
2. Legacy `createCommunityEvent` still requires `startAt`; legacy untimed `participantLinks`
   remains a separate group without positional persistence. Canonical and contributor
   lineups retain positional untimed rows and their existing Time TBA support.
3. Legacy staff `updateCommunityEvent` has the necessary optional update-only
   `storedSlotAssociations` exception to the original no-payload-expansion constraint.
   Pre-sort submitted positions map to protected stored IDs, validated for uniqueness,
   range, snapshot inclusion and current event membership before writes. Hidden links,
   omitted source data and unchanged unavailable streams survive reflow. Returned IDs
   reconcile by submitted local key across pending edits. Create, actor permissions,
   revision authority and absent-argument API-owner compatibility stay unchanged.
   See [the full command boundary](../engineering/event-contribution-browser.md#legacy-stored-slot-identity).

4. Untimed storage may carry optional `sourceType`, `sourceLabel`, `sourceUrl` and
   `notes` for stable-key conversion preservation. No hidden clocks, migration,
   public wire/input expansion or auth change. Old rows use event provenance
   defaults; canonical and legacy date-only conversions carry distinct sources.

## Approved copy

BASIC approved the exact new substantive strings on 2026-10-13:

- `Clear the lineup and start again?`
- `Event details and artwork will stay.`
- `Clear lineup`
- `The lineup ends after the event.`
- `Set event end to lineup end`

Review retains `Publish event`, `Save and publish`, `Save changes`, `Save draft`,
`Unpublish and save draft` and `Back`. Other additions are utility/accessibility labels.
This checkpoint does not authorize new public prose.

## Local evidence

Implementation commits tested together: `18802f32a`, `54e707256`, `b81a65469`,
`4060db323`, `70e678a83`, `b0e9dfd93`, plus this checkpoint's Task 5 commit.
The final source tree starts from `b0e9dfd93ff695066af1ea6af369a85042c13022`.

Linux Chromium fixture environment: owned `vrdex-scheduling-linux-20261013`,
frontend `http://127.0.0.1:3178`, explicit fixture flags and no live authentication.
Goldens cover staff create/edit, contributor Details/setup/populated lineup/Review,
light/dark, desktop/mobile, timezone search, insertion, reset and end conflict.
Selected images persist locally under
`apps/web/playwright-artifacts/event-editor-scheduling-20261013/` (ignored);
tracked Linux baselines are under `apps/web/e2e/__screenshots__/`.

VLM inspection confirmed readable compact clocks, dates on crossings, visible focus,
secondary removal, prominent Review completion and retained header/footer styling.
The confirmed transparent timezone popover was changed to opaque `surface-elevated`.
No horizontal overflow appeared; browser assertions compare scrollWidth to clientWidth,
with CSS-scale screenshots so Pixel 7 DPR is not misclassified as overflow.

Review tests capture real form serialization through guarded local transports,
including existing commands/intents, scoped changed-field correction, pending
Enter/click suppression, early-step Enter navigation, overrun extension and DST focus.
Other focused suites retain near-duplicate/version conflicts, unknown ends, optional
lineup, import and unchanged account defaults. Backend suites use actual Convex functions
in convex-test. Generated binding and health checks use the anonymous local wrapper
at ports 3340/3341, separately from the browser fixture frontend.

Final checks on the Task 5 source tree:

| Command | Result |
| --- | --- |
| `pnpm lint:web` | Passed, no warnings |
| `pnpm typecheck:web` | Passed |
| `pnpm typecheck:backend` | Passed |
| `pnpm test:web` | 686 passed, 0 failed |
| `pnpm test:backend` | 1,281 passed, 0 failed |
| `pnpm build:web` | Passed |
| `pnpm lint:markdown` | Passed |
| `pnpm build:docs` | Passed |
| `pnpm check:backend:generated` | Passed, local health ok and generated diff empty |
| Focused eight flow/snapshot specs, desktop/mobile | 274 passed, 0 failed (3.6m) |
| Final Linux snapshot update, both projects | 30 passed (36.8s), forced all images |

Focused specs: `event-review-actions.flow.spec.ts`, `event-lineup-editing.flow.spec.ts`,
`event-editor-end.flow.spec.ts`, `event-lineup-validation.spec.ts`,
`event-timezone-picker.flow.spec.ts`, `event-intake-source.flow.spec.ts`,
`event-contribution.flow.spec.ts`, `event-editor.snapshots.spec.ts`. Final acceptance
used no snapshot-update flag. Raw logs and implementation/self-review evidence are in
`.superpowers/sdd/2026-10-13-event-editor-scheduling/task-5-report.md` (ignored).

Earlier runs caught one UTC formatting assertion, three test callback types, one unused
import, and an old UTC option locator. All were corrected and affected checks reran.
Known pre-existing warnings remain: local wrapper DEP0190, Next middleware convention
notice, provider update notices, and old caniuse-lite data in the docs build. These do
not represent failed checks. No dependency upgrade or remote deployment is included.

## Acceptance limits

Local screenshot/VLM and payload evidence is not a signed-in hosted mutation, remote
persistence, deployment or production acceptance. No worker pushed, created a PR,
merged or deployed. PR #365 at `77146a33b` remains open in the last controller refresh;
the controller must establish the final base, review the combined branch and apply the
30-minute current-head PR gate before declaring merge readiness.

## Final canonical preservation fix

The whole-branch review of `2a9394bdc1289a1118ad3b7d5a666bb32e4f13c6` found two
canonical preservation defects: timing edits could confirm unchanged contributed
person matches, and matched slots could inherit the event's source label.

Canonical editor updates now consistently request confirmation preservation.
The backend evaluates all submitted stable-key/person pairs before writing.
Unchanged surviving matches retain their prior confirmation and confirmed-at
value; a genuinely new or replaced explicit match keeps existing staff confirmation
behavior, including when the same person appears in another unchanged row.
Input ordering does not determine that confirmation result.

Matched slots retain their distinct source type, label, URL and notes. The adjacent
participant writer now patches surviving records, retaining their IDs and source
metadata while updating schedule, role and confirmation fields. Deliberate orphans
and duplicate participant records are still removed. New slots and participants
use event provenance. Existing explicit source-capable commands retain their role.
The fourth ruling extends internal untimed storage by four optional provenance
fields to preserve timed/untimed conversions. Public inputs/projections and auth
remain unchanged; no hidden clocks or backfill are introduced.

Actual backend regressions create contributed events through intake publication,
then exercise insertion, duration, removal, start changes, untiming, reset and
repeated staff saves. Separate source tests establish distinct slot/participant
provenance through supported legacy update commands, then perform canonical timing
saves. New/replaced matches and both duplicate-person input orders are covered.
Browser regressions inspect the preservation flag over repeated real form payloads.

Initial final fix checks (before the fourth-ruling storage extension):

| Command | Result |
| --- | --- |
| Focused actual backend regressions, first GREEN | 38 passed, 0 failed |
| `pnpm test:backend`, including seven new preservation cases | 1,288 passed, 0 failed |
| `pnpm typecheck:backend` and web typecheck | Passed |
| Scoped web ESLint | Passed |
| `pnpm check:backend:generated`, anonymous local 3340/3341 | Passed, health ok and generated diff empty |
| Lineup, Review actions, end and validation flow specs, desktop/mobile | 96 passed, 0 failed |

No layout or public product prose changed, and no golden files were regenerated.
The previous visual evidence remains applicable. Changed documentation is checked
with markdown lint and the documentation build. Exact RED/GREEN, terminal checks
and self-review evidence are retained in the ignored `final-fix-report.md` beside
the task reports. The controller's scoped final re-review and remote delivery gates
remain outstanding; these local results do not claim hosted authentication or
production acceptance.

## Fourth-ruling storage verification

The completed storage extension preserves provenance over canonical timed/untimed
roundtrips, unchanged untimed saves and legacy event date-only conversion. Real
query regressions verify public/editor lineups omit all four fields and hidden
clocks; operator readback has no current/next slot while untimed and returns the
restored schedule without provenance after retiming. Surviving participant IDs
remain stable. Old optional-field-free records and new rows use event defaults.
After retiming, the existing public `slots[].source` attribution returns type,
label and sanitized URL; notes stay private. No public DTO fields were added.

Fresh checks after the schema/source change:

| Command | Result |
| --- | --- |
| Actual Convex preservation file | 10 passed, 0 failed |
| `pnpm test:backend` | 1,291 passed, 0 failed, 131 suites |
| `pnpm typecheck:backend` and web typecheck | Passed |
| Scoped web ESLint | Passed |
| `pnpm check:backend:generated`, local 3340/3341 | Passed, health ok, generated diff empty |
| Lineup, Review actions, end and validation flow specs, desktop/mobile | 96 passed, 0 failed |
| `pnpm lint:markdown` | Passed, 205 files, zero errors |
| `pnpm build:docs` | Passed |

The two conversion regressions first failed on missing stored source fields.
Their GREEN assertions inspect actual stored metadata, supported command/query
responses and restored operator times. Earlier logs remain separate from the
`final-fix-tba-*` logs in the ignored task evidence folder.
