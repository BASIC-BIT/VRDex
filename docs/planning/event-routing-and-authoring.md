# Event Routing And Authoring

## Status

Locked decisions from BASIC on 2026-08-31:

- Event creation happens in community context at `/<community>/events/create`.
- Events do not use the root profile and world slug namespace.
- The freeform world field is removed. Searchable indexed world selection is deferred to #279.
- Doors open is authored as minutes before the event start, not as a second timestamp.
- New lineups start with four 60-minute slots.
- Slot count, duration, and break changes update untouched generated slots without a Generate action.
- Other participants appears after the session editor.
- Event URLs use the automatically generated seven-character short-link code.
- Event URL codes are not editable and do not occupy the root profile and world
  slug namespace.

Current recommendation:

- Use `/<community>/events/<event-code>` as the canonical public route and
  `/<community>/events/<event-code>/edit` as the editing route.
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

- Browser routing and identifier allocation keep events out of the root profile
  and world slug namespace.
- Browser, public page, calendar, cards, Discord export, API, and MCP event
  lookups use the event code. The existing internal `slug` field name remains
  the wire/storage key for now, but its event value is the generated code.
- Public browser routes include the community slug for context and verify that
  the event belongs to that community before rendering.
- API routes remain under `/api/v0/events/<event-code>` because the resource prefix
  already disambiguates the identifier.
- No event data migration or legacy event-route compatibility is included.

## Authorization

- The route is not authority. Creation still requires existing ownership or
  `manage_events` authority for the routed community.
- Editing verifies both the event code and its associated community.
- Public event URLs do not grant private read, write, media-control, or operator
  access.

## Research Checklist

- Existing route and data consumers traced: complete.
- Existing community event authority reused: complete.
- Event identity and collision scope: complete.
- Public, calendar, API, MCP, search, and Discord URL consumers: update in the
  same delivery.
- Searchable world selection: deferred to #279.
- End-time authoring after lineup feedback: interview later.

## Verification

- Backend tests for namespaced event paths and community-bound lookup.
- Web tests for protected community create/edit routes and derived doors/end
  payloads.
- API and MCP results return community-scoped browser paths.
- Desktop and mobile screenshots for the exact event editor.
- Manual visual review of template regeneration, edited-data confirmation, and
  responsive slot rows.
