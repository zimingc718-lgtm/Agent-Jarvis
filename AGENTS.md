# AGENTS.md

## Scope

This file applies to Agent-Jarvis repository work.

The product requirements, functional scope, architecture, module boundaries, tests, and release target are not approved yet. Do not create business implementation, product feature definitions, module designs, test matrices, or release claims until the user has confirmed the product requirements.

## Governance References

Use these files as the current project process and control rules:

- AI standard: `docs/AI_STANDARD.md`
- Workflow: `docs/WORKFLOW.md`
- Gates and controls: `docs/CONTROLS.md`
- UI development standard: `docs/UI_STANDARD.md`
- Project input area: `project/00_input/`
- Product requirements area: `project/01_specification/`
- Architecture area: `project/02_solution/`
- Module task area: `project/03_modules/`
- Test area: `project/04_tests/`
- Evidence area: `project/05_evidence/`
- Change area: `project/06_changes/`
- Release area: `project/07_releases/`

## Working Rules

- Treat current business/product content as unapproved unless the user explicitly confirms it.
- Preserve user-provided original requirements before deriving any product document.
- Ask for product confirmation before writing concrete feature requirements, architecture, module tasks, or tests.
- Keep governance documents separate from business documents.
- UI work must satisfy `docs/UI_STANDARD.md` and `python tools/governance.py ui` before implementation evidence can be accepted.
- Do not mark a requirement, task, test, release, or knowledge asset complete without current evidence.
- Do not silently overwrite controlled documents; record material changes in `project/06_changes/`.
- Use `python tools/governance.py verify` before claiming governance files are consistent.
- Use `python tools/governance.py gate g1` before entering architecture or implementation planning.
- Use `python tools/governance.py snapshot --actor <name>` after approved governance changes to lock the current controlled-file baseline.

## Role Boundaries

- Product owner: confirms product intent, scope, priorities, and acceptance criteria.
- Architect: defines architecture only after product intent is confirmed.
- Module developer: implements only approved tasks.
- Test owner: defines and executes tests against approved requirements.
- Release owner: releases only after gates and evidence pass.

One person may perform multiple roles in a small project, but each controlled review must state the role being exercised and what was checked.
