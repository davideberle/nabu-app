# Scheduled Tasks Status for Companion App

**Date:** 2026-04-15
**Author:** Nabu
**Status:** Draft

## Summary

Add a real scheduled-tasks view to the Companion App under `/system` so David can see:

- all configured scheduled jobs
- whether each job is enabled
- schedule / timezone / next run
- last run time
- last successful run time
- last error time / reason
- current health (ok, error, stale, disabled)

This should be **live enough to trust**, not a hardcoded status page.

## Diagnosis / Problem

Today the source of truth for scheduled jobs lives on the Mac mini in OpenClaw state files, especially:

- `~/.openclaw/cron/jobs.json`

That file already contains the fields we need for a useful dashboard, including:

- `name`
- `enabled`
- `schedule.expr`
- `schedule.tz`
- `state.nextRunAtMs`
- `state.lastRunAtMs`
- `state.lastRunStatus`
- `state.lastDurationMs`
- `state.lastError`
- `state.consecutiveErrors`

Example from current live state:

- `Daily workspace git backup` — last run `ok`
- `Daily Telegram session compact` — last run `error` at 04:00 Europe/Zurich, error: `cron: job execution timed out`
- `Daily Telegram thinking high` — last run `ok` at 08:00 Europe/Zurich
- `saturday-shopping` — misconfigured Telegram delivery target
- `sonos-api-monthly-check` — misconfigured Telegram delivery target

### Constraint

The Companion App is deployed on Vercel.

That means the app **cannot directly read** the Mac mini's local file `~/.openclaw/cron/jobs.json` at request time. So a real status page needs a bridge between local OpenClaw state and the Vercel app.

## Proposed Changes

### Recommended v1: sync cron state into Turso

Use the Mac mini as the source of truth and sync a compact task-status snapshot into the app database.

#### Data model

Add a new table, e.g. `scheduled_tasks`:

- `task_id` text primary key
- `name` text not null
- `description` text null
- `enabled` integer not null
- `schedule_kind` text not null
- `schedule_expr` text null
- `schedule_tz` text null
- `next_run_at` integer null
- `last_run_at` integer null
- `last_run_status` text null
- `last_success_at` integer null
- `last_error_at` integer null
- `last_error` text null
- `last_duration_ms` integer null
- `consecutive_errors` integer not null default 0
- `source_updated_at` integer not null

Optional later table for history:

- `scheduled_task_runs`

But for v1, the snapshot table is enough.

#### Sync path

A small local sync script on the Mac mini:

1. reads `~/.openclaw/cron/jobs.json`
2. normalizes each job into app-friendly fields
3. upserts rows into Turso
4. computes:
   - `last_success_at` when status is `ok`
   - `last_error_at` when status is `error`
   - health badge (`ok`, `error`, `stale`, `disabled`) at render time or during sync

This script can run:

- after each cron change event if such a hook exists, or
- on a short interval (e.g. every 5 minutes) via cron / LaunchAgent

### Companion App UI

Add a new section under `/system`:

- **Scheduled Tasks** table/card list

Columns / fields:

- Name
- Enabled
- Schedule
- Time zone
- Next run
- Last run
- Last success
- Last error
- Status badge
- Error summary

Useful UI touches:

- red badge for current error state
- amber badge for stale jobs (enabled but overdue / not seen recently)
- compact monospace schedule line (`0 4 * * * · Europe/Zurich`)
- relative time plus exact timestamp on hover/title

## Alternatives Considered

### A. Read `~/.openclaw/cron/jobs.json` directly from the app

Rejected.

Vercel cannot see the Mac mini filesystem.

### B. Expose a live local HTTP endpoint from OpenClaw and have Vercel fetch it

Possible, but not my first choice.

Reasons:

- adds network/security exposure
- requires auth, proxying, or public reachability
- more brittle than syncing a small snapshot into Turso

### C. Keep `/system` hardcoded and manually update it

Rejected.

That would be fake status, which is worse than no status.

## Risks

- task metadata drift if the sync script fails silently
- timestamps may look odd unless everything is normalized to UTC in storage and rendered in local time
- if we want per-run history later, the v1 snapshot schema will need a companion history table

## Recommended Implementation Order

1. Add Turso schema for `scheduled_tasks`
2. Build local sync script on the Mac mini that reads `~/.openclaw/cron/jobs.json`
3. Verify the sync writes correct status for the current six jobs
4. Add authenticated app API route for scheduled-task reads
5. Replace the hardcoded `/system` task/status block with live data
6. Optionally add stale/error highlighting and basic history later

## Decision Record

Pending David review.
