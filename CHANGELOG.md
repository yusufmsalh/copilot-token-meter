# Changelog

## 0.1.0

- Status bar counter for input, output and reasoning tokens of the latest Copilot session (or today).
- Token Meter sidebar: current session, today, last 7 and 30 days, all time, recent sessions and daily history, with
  per-model, per-turn, per-call and sub-agent breakdowns.
- Input split into fresh, cache read and cache write tokens; AI credits per call.
- Reads `~/.copilot/session-store.db` read-only and refreshes every few seconds.
