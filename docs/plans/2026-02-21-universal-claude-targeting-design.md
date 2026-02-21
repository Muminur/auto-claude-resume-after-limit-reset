# Universal Claude Process Targeting Design

**Date:** 2026-02-21
**Status:** Approved

## Problem

Auto-resume only targets Claude Code sessions inside tmux panes. Claude instances running in plain terminal tabs (non-tmux) are missed entirely. Rate limits are account-level — all sessions hit them simultaneously — so all sessions need the resume signal.

## Solution: Process-First Discovery

Replace the serial "try tmux → try single PTY → try xdotool" pipeline with a two-phase approach:

### Phase 1 — Discover All Claude Processes

1. `pgrep -x claude` to find all Claude PIDs system-wide
2. For each PID, classify terminal type:
   - Walk process tree up → if ancestor is a tmux pane PID → **tmux target** (get full `session:window.pane`)
   - Else resolve `/proc/<pid>/fd/0` → if `/dev/pts/*` → **PTY target**
3. Deduplicate: if reachable via both tmux and PTY, prefer tmux

### Phase 2 — Deliver to Each

- **Tmux targets:** `sendKeystrokeSequence()` with full pane target (existing, already fixed)
- **PTY targets:** Enhanced `sendViaPty()` with multi-step sequence (Escape, menu selection `1`, fallback Ctrl+U + text + Enter)
- **Fallback:** xdotool if zero processes found via discovery

## Files Changed

| File | Change |
|------|--------|
| `src/delivery/tmux-delivery.js` | Add `discoverAllClaudeProcesses()` returning `[{pid, method, target?, ptyPath?}]` |
| `src/delivery/pty-delivery.js` | Enhance `sendViaPty()` to support full multi-step sequence |
| `src/delivery/tiered-delivery.js` | Refactor `deliverResume()` to use discovery-first approach |

## What Stays the Same

- Detection logic (hooks + transcript poll)
- xdotool fallback for zero-discovery case
- Transcript verification after delivery
- The `detectTmuxSession` format string fix (already applied)
