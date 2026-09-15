# Invitation UI implementation

Local implementation is at `/account/communities/[slug]/invitations`. Staff need
`invite_group_members` or `manage_instances`; each destination also respects its
enabled feature. The existing staff invitation route is unchanged.

The screen supports named explicit recipient lists with revision-aware updates,
deletion confirmation, server validation and deduplication, and a frozen final
review. Enqueue retries retain the same request ID and reviewed schedule. Saved
list edits do not change queued batches. Group, provider-visible existing instance,
and selected instance creation destinations have separate inputs. Fixed and
event-relative schedules show exact review times, and invitations cannot precede
their selected creation. Creation and event selectors support continued pagination.

Existing instances come from the narrow management read, independently of
analytics access. Each reviewed instance recipient has an explicit eligibility
button. There are no automatic audience checks. A current-instance check shows
friendship and destination state; a future creation checks friendship while the
destination remains pending. Results expire visibly after the shared freshness
window. The assigned bot profile link is available in composition and review.
An invitation check does not claim that the recipient can enter the destination.

History shows per-target pending, submitted, sent, failed, cancelled, missed, or
unknown outcomes, with current and originally reviewed IDs when different.
Unsent cancellation is confirmed explicitly and displayed only when the backend
reports `canCancel`. Submitted work remains intact. History follows paginated
batch cursors even when a filtered page is empty.

## Evidence

- Eight Playwright desktop/mobile checks passed in
  `apps/web/e2e/club-invitation-batches.storybook.spec.ts`.
- Connected workspace fixture tests exercise actual frontend hooks for saved-list
  reload, batch enqueue/history updates, per-recipient checks, and unsent cancellation.
- Composer tests exercise deduplication, no enqueue before confirmation, selected
  creation, early-time rejection, event-relative scheduling, and list deletion.
- Scoped ESLint and full web TypeScript checking passed on the final UI files.
- Desktop and mobile screenshots were inspected. Recipient sections wrap, controls
  remain usable, and no horizontal page overflow occurred in browser checks.
- Screenshot artifacts: `.cache/artifacts/invitation-{composer,review,workspace,eligibility}-{desktop,mobile}.png`.

These are local fixture checks. They do not prove hosted authentication, actual
VRChat reads/writes, or delivered invitations. No live invitations were sent.

## New copy for BASIC review before shipping

Utility labels accompany the following new sentences. Approval has not yet been
recorded for this exact copy:

- `Up to 100 entries, separated by spaces, commas, or new lines.`
- `Eligibility is checked when each invitation is sent.`
- `Invitations wait for this instance creation to succeed.`
- `Invitation time must be at or after instance creation.`
- `Choose an instance.`
- `Choose an instance creation.`
- `Choose an invitation destination.`
- `Choose an event and a valid offset.`
- `Choose a future invitation time.`
- `Unable to save invitations.`
- `Unable to cancel invitations.`
- `Cancel invitations that have not been submitted?`
- `Delete {list name}?`
- `List saved.` / `List deleted.` / `Invitations queued.`
- `No invitation batches.`

Eligibility labels are `Eligibility not checked`, `Invitation check passed`,
`Not friends with bot`, `Instance closed`, `Awaiting instance creation`,
`Check expired`, `Friends with assigned bot`, and `Not friends with assigned bot`.
The optional account link is `Open assigned bot in VRChat`.
