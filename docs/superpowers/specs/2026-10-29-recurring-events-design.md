# Recurring events

## Review brief

Give VRDex a real model for the weekly night: one series that owns the schedule, and one event per occurrence that owns what changes week to week. Staff edit a night without touching the series and edit the series without flattening the nights. Connectors round-trip series with Google Calendar and Discord, which have them, and expand to occurrences for VRChat, which does not.

This is a companion to the event connectors design (`2026-10-29-event-connectors-design.md`). Connectors ship first by expanding external series into plain occurrences; this design upgrades that to series-aware links. It changes the event schema, the editor, and the public event page's handling of a night that belongs to a series.

BASIC decided on 2026-10-29 to support both occurrences and a recurrence model, to model the integrations' data honestly, and approved the series-versus-night field split below.

## Decisions and scope

| Status | Decision |
| --- | --- |
| Locked decision | A series owns schedule, title, world or venue, and community. A night owns lineup, poster, and any one-off override of summary or time. |
| Locked decision | Editing a night changes only that night and records the overridden fields as exceptions. Editing the series changes every future night that has not overridden that field. |
| Locked decision | Exports create a real series on Google Calendar and Discord. VRChat gets occurrences. |
| Current recommendation | Occurrences are real `events` rows, materialised sixty days ahead by a daily job, so every existing surface (public page, search, ICS, board, share cards) works unchanged. |
| Current recommendation | Recurrence rules are a small fixed set, not free RRULE: weekly, every two weeks, monthly on the nth weekday, with an optional end date or count. |
| Deferred | Daily rules, multiple weekdays per rule, moving a single night to another date (that is a one-off time override, not a reschedule), series-level attendance. |

## Intent

Most VRChat club nights repeat. Today each is a separate event, so a weekly night is 52 events a year, created one at a time by an agent or a tired organiser. Every external calendar already models the series. Without a series on VRDex, connectors can only flatten, and an organiser changing the start time of their night on Google has to see 8 separate edits land, or none.

## Goals, non-goals, anti-goals

Goals:

- Create a weekly night once and have the next sixty days of events exist, publicly listed, each editable for lineup and poster.
- Change the series time and have every future un-overridden night move.
- A Google or Discord series imports as one VRDex series, and a VRDex series exports as one Google or Discord series.

Non-goals:

- Arbitrary RRULE. Exceptions to exceptions. Series spanning communities.
- Backfilling past occurrences.

Anti-goals:

- A series edit silently overwriting a night a staffer customised.
- Two occurrences on one date because materialisation and import both produced one.
- Public pages showing a series as a single event with a confusing "every Friday" line and no concrete dates.

## The model

### Series

New table `eventSeries`:

| Field | Notes |
| --- | --- |
| `communityProfileId`, `title`, `summary`, `timezone`, `venueLabel`, `worldSlug` | The series-owned fields, same shapes as on `events`. |
| `rule` | `{ frequency: weekly \| biweekly \| monthly_weekday, weekday, ordinal?, startTime, endTime?, doorsTime? }` as local wall-clock times in `timezone`. |
| `startsOn`, `endsOn?`, `count?` | Series bounds. |
| `horizonDays` | Fixed at 60 for now; a field so it can change per series later without a migration. |
| `authorityUserId`, `state` (`active`, `ended`, `removed`) | |

### Occurrence

`events` gains `seriesId?`, `occurrenceDate` (the local date the rule produced), and `overrides` (the set of series-owned field names this night has set itself). An event with `seriesId` is an occurrence; everything else about it is unchanged.

Materialisation: a daily job per active series creates occurrence rows up to `horizonDays` ahead that do not yet exist for that `occurrenceDate`, copying series-owned fields and leaving night-owned fields empty. Creating a series runs the job immediately. The unique key is `seriesId` plus `occurrenceDate`.

Adoption: before creating an occurrence for a date, the materialiser looks for a standalone event in the same community on that local date whose title matches the series title case-insensitively. A match is adopted: it gets `seriesId` and `occurrenceDate`, and every series-owned field whose value differs from the series goes into `overrides`. This is what makes creating a series safe for a community whose upcoming nights already exist, and it is also how "Repeats" on an existing event works: the event becomes the first occurrence and the series is created from its fields.

Series-owned fields beyond the locked split: `doorsOpenAt` and `endAt` (as rule times), `mediaLinks`, `watchMode`, `watchSurfaceEnabled`, `bannerImageUrl`, `thumbnailImageUrl`, and `sourceUrl`, so a streamed weekly night keeps its stream link and watch surface without weekly setup. Night-owned: `notes`, lineup and slots, poster artwork, `summary` as an override. Per-event stream output programs are copied from the series' template at materialisation and are not fanned out afterwards; changing them on the series affects nights created from then on. That is a deliberate ceiling: fanning programme config into existing nights is a later change if weekly re-setup turns out to be common.

Timed lineup slots store absolute times. When a series time edit moves a night, that night's slots move by the same offset, so a lineup authored as "doors plus one hour" stays right.

### Editing

Series edit: update the series row, then for every future occurrence, update each series-owned field unless that field is in the occurrence's `overrides`. Past occurrences never change.

Night edit: the editor saves to the occurrence as today, and adds any series-owned field the staffer changed to `overrides`. A "Reset to series" action per field clears the override and copies the series value back.

Ending a series sets `endsOn`. Future occurrences with no overrides and no lineup are unpublished to `draft_private`, which the connector design exports as a delete; nothing is hard-deleted, so short links, audit rows, and receipts stay valid. Occurrences with overrides or a lineup stay published as plain events with `seriesId` cleared. Series state `removed` does the same for every future occurrence and hides the series page.

### Editor

Series are created and edited from the browser wizard and from the staff-level API and MCP owner paths, which gain the same `repeat` fields, so an agent creating a weekly night creates a series. Contributor intake and the channel intake agent never create series; a contributed event that matches a series date is adopted by the next materialisation. A series exists only once published; there is no private series draft in this slice.

The create wizard's Details stage gains a "Repeats" control: Does not repeat / Weekly / Every two weeks / Monthly on the nth weekday, with an optional end date. Choosing a repeat creates a series on publish, with the first night's lineup and poster on the first occurrence. Opening an occurrence shows a one-line series note with two actions: edit this night, edit the series. The series editor is the same Details stage scoped to series-owned fields. No new page.

### Public surfaces

An occurrence's public page is the ordinary event page plus one line linking to the series, and the series has a lightweight page listing upcoming nights. Search, ICS, share cards, and the board treat occurrences as the events they are. ICS for a series page emits the occurrences, not an RRULE, so overrides are always right.

## Connectors

Links gain `seriesId?` and `externalSeriesId?`. A Google or Discord series whose rule maps onto the fixed set imports as one `eventSeries` plus occurrences materialised by VRDex, not by expanding the source; the source's own exceptions import as overrides on the matching occurrence. A series whose rule does not map (daily, several weekdays, last-weekday, moved nights) keeps the connector design's phase-one behaviour: expanded into plain occurrences, one link each, with the external series ID recorded. The grouping migration re-fetches each external series' rule and groups only the ones that map. Exporting a VRDex series to Google or Discord creates one external series from the rule and then exports each overridden occurrence as an exception. VRChat exports every occurrence individually, as the connector design already does. Until this design ships, connectors expand external series into plain occurrences and link each one; when it ships, a migration groups those by `externalSeriesId` into series.

## Public copy

Every string needs BASIC's approval of the exact wording before it ships. Proposed:

| Surface | String |
| --- | --- |
| Repeat control label | Repeats |
| Repeat options | Does not repeat / Weekly / Every two weeks / Monthly |
| End control label | Ends |
| Series note on a night | Part of a series. |
| Night actions | Edit this night / Edit the series |
| Reset action | Reset to series |
| Series page heading | Upcoming nights |

No AI mention. No em-dashes.

## What is left to the builder

- Index design, the migration for `seriesId` and `occurrenceDate`, and the grouping migration for connector links.
- Materialisation job cadence and idempotency (suggest daily cron plus run-on-create, keyed on `seriesId` and `occurrenceDate`).
- Timezone handling for the rule's wall-clock times across DST, using the existing local-time resolution from the intake contract.
- Test strategy. The override rule, the series edit fan-out, the end-series rule, the materialisation uniqueness, and the DST wall-clock rule each need a test that fails if the rule breaks.
- Whether the series editor reuses the wizard's Details stage as a component or as a route; the constraint is no new page design.

## Open questions for BASIC

None at hand-over. Questions raised by the cold builder check are folded in above.
