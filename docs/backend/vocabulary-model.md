# Vocabulary Model

## Status Note

Current recommendation and first implementation for `#90`.

## Purpose

VRDex needs flexible scene language without forcing everyone into one rigid taxonomy. The vocabulary model normalizes and remembers terms that appear in profiles, worlds, events, and discovery facets.

## Scopes

Initial scopes:

- `profile_tag`
- `person_role`
- `community_category`
- `community_subtype`
- `event_participant_role`
- `event_tag`
- `world_tag`
- `world_creator_role`
- `discovery_facet`

## Normalization

Terms keep a user-facing `label` and a normalized `key`.

Examples:

- `Melodic House` -> `melodic_house`
- ` club night ` -> `club_night`
- `World Author` -> `world_author`

The model deduplicates obvious case and whitespace variants. It does not try to infer arbitrary semantic equivalence in deterministic code.

## Sources

Term source values:

- `seeded`: built-in starter vocabulary
- `user_created`: learned from submitted or authored records
- `reviewed`: promoted or curated by maintainers/moderators
- `imported`: created from reviewed import flows

## Ranking Use

Vocabulary terms feed:

- search facets
- weighted search document fields
- browse chips on discovery surfaces
- future typeahead suggestions
- future moderation/merge workflows

## Non-Goals

- fully automated taxonomy inference
- forcing all communities into one fixed role list
- broad ad hoc language-to-intent mappings in code
- moderation dashboard for vocabulary abuse in the first slice

## Follow-On Work

- reviewed aliases and merges
- admin curation UI
- usage analytics for term quality
- personalized recommendation facets
