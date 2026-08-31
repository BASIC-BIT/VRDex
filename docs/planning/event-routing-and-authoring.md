# Event Routing And Authoring

## Status

Locked decisions from BASIC on 2026-08-31:

- Event creation happens in community context at `/<community>/events/create`.
- Events do not use the root profile and world slug namespace.
- The freeform world field is removed. Searchable indexed world selection is deferred to #279.
- Doors open is authored as minutes before the event start, not as a second timestamp.
- New lineups start with four 60-minute slots.
- Slot count, duration, and break changes update untouched generated slots without a Generate action.
- Additional people appears after the set-time editor.

Current recommendation:

- Generate a readable event slug from the title, while allowing an explicit
  override. Keep that field secondary to the event title.
- Use `/<community>/events/<slug>` as the canonical public route and
  `/<community>/events/<slug>/edit` as the editing route.
- Keep the optional stored event end time for public/API compatibility, but do
  not ask browser authors for it in this slice. Derive the submitted end from
  the final set when the lineup has complete durations.
- When template controls would replace edited lineup data, require confirmation.

## Smallest Useful Flow

1. Start from a managed community.
2. Enter the event title and public details.
3. Set the local start time, timezone, and optional doors-open offset.
4. Fill the four generated 60-minute lineup rows or adjust the template.
5. Publish or save a draft.

The community slug comes from the route and is re-authorized by the existing
event mutation. The browser does not choose another community inside the form.

## Data And Routing Contract

- Browser routing no longer puts events in the root profile and world route
  namespace. Slug availability remains conservatively global in this slice
  until BASIC chooses readable event slugs or generated public codes.
- Browser, public page, calendar, cards, Discord export, API, and MCP event
  lookups use the event slug.
- Public browser routes include the community slug for context and verify that
  the event belongs to that community before rendering.
- API routes remain under `/api/v0/events/<slug>` because the resource prefix
  already disambiguates the identifier.
- No event data migration or legacy event-route compatibility is included.

## Authorization

- The route is not authority. Creation still requires existing ownership or
  `manage_events` authority for the routed community.
- Editing verifies both the event slug and its associated community.
- Public event URLs do not grant private read, write, media-control, or operator
  access.

## Research Checklist

- Existing route and data consumers traced: complete.
- Existing community event authority reused: complete.
- Event identity and collision scope: pending BASIC's slug-versus-code choice.
- Public, calendar, API, MCP, search, and Discord URL consumers: update in the
  same delivery.
- Searchable world selection: deferred to #279.
- End-time authoring after lineup feedback: interview later.

Candidate direction:

- Replace event slugs with server-generated six-character public codes. This is
  a coordinated API, MCP, calendar, route, and storage contract change, not a
  form-only adjustment. Do it only after BASIC explicitly locks that identity
  choice.

## Verification

- Backend tests for namespaced event paths and community-bound lookup.
- Web tests for protected community create/edit routes and derived doors/end
  payloads.
- API and MCP results return community-scoped browser paths.
- Desktop and mobile screenshots for the exact event editor.
- Manual visual review of template regeneration, edited-data confirmation, and
  responsive slot rows.
