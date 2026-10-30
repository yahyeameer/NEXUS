# Security & Privacy

## Security

- Agents run in Docker Sandboxes: CPU/memory limits, execution timeouts (default 60 s per task), restricted network (allow-list: MCP gateway + data adapters only), read-only dataset mounts, no shared credentials.
- Tool-call limit per agent per task: 12. Total team run timeout: 3 min (live mode).
- Provider keys live only in backend services (`.env`, secrets manager in production). XR client gets a short-lived session token only.
- All APIs authenticated; review endpoints require a human user session (agent tokens are rejected).
- All model/agent outputs zod-validated before use. Never `eval` or render model output as HTML.
- Append-only audit tables: `sie_decisions`, `reviews`, `agent_runs`.
- CORS allow-list = XR origin + dashboard origin.

## Voice privacy

- Push-to-talk default; wake phrase opt-in, off by default.
- Visible mic indicator whenever capturing.
- Transcripts stored for the investigation record; **raw audio stored only with opt-in**, deletable per session.
- Audio travels only to `voice-gateway` over TLS; research agents never receive audio.
- No speaker identification, voice biometrics or emotion detection.
- Speech providers configured with data-retention off / no-training where the provider offers it — verify per provider.
- First-run screen explains mic use in plain words and offers "Continue without voice".

## Data honesty

- Simulated telemetry always labelled "Simulated" on screen and in captions.
- Archival imagery labelled with acquisition date and "archival orbital data".
- Credits shown on every card that uses a dataset.
