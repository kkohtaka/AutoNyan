---
name: New agent skill
about: Propose or track the development of a Claude Code agent skill
title: 'skill(<name>): '
labels: enhancement
assignees: ''
---

<!-- Authoring rules live in .claude/skills/CONVENTIONS.md. Keep this issue in sync with them. -->

## Goal

<!-- What does this skill do, and when is it used? One paragraph. -->

## Scope

- In: <!-- behaviors this skill owns -->
- Out: <!-- behaviors delegated to other skills, with links -->

## Design decisions

- `allowed-tools`: <!-- minimal scoped list -->
- `disable-model-invocation`: <!-- true|false, with a one-line rationale (see CONVENTIONS.md §4.2) -->

## Steps (outline)

1. <!-- numbered step outline of the skill's Your Task section -->

## Acceptance criteria

- [ ] Frontmatter follows CONVENTIONS.md §2 (keys, order, scoped `allowed-tools`).
- [ ] `## Context` uses read-only commands only.
- [ ] `disable-model-invocation` set per §4.2; confirmation gates present for outward/irreversible actions.
- [ ] No duplicated behavior; delegations point to sibling skills.
- [ ] Verified by manual invocation, with reproduction steps recorded.

## Overlap notes

<!-- Links to sibling skills and how this one stays distinct. -->

## Manual test

<!-- Exact invocation / commands to verify the skill. -->
