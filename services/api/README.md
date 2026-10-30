# services/api

REST + WebSocket hub (docs/ARCHITECTURE.md). Owns observations, field notes, findings, reviews and the SIE audit log.
Runs in memory without `DATABASE_URL` (precomputed demo), Postgres with it (`src/migrations/001_init.sql`, applied on start).

| Route | Caller | Notes |
| --- | --- | --- |
| `POST /sessions` | headset | Pairing code → human session token |
| `POST /observations` | human | Emits `observation.created` |
| `POST /utterances` | human (own speech) · voice-gateway | Outgoing speech needs a `SPEAK_AS_APPROVED` decision or an exact system phrase |
| `POST /field-notes` | human | SIE VR1 (422 `clarification_required`) and VA1 (verbatim, descriptors were said) |
| `POST /observations/:id/research` | orchestrator | Raw agent outputs + synthesis → **SIE runs here** → stored finding + decisions |
| `POST /scripts/validate` | voice-gateway · orchestrator | Q&A answers and briefing rewrites through the voice validator |
| `GET /findings`, `GET /findings/:id` | any | Humans never see `REJECT` findings |
| `POST /findings/:id/review` | **human only** | The only path to `reviewed` (AGENTS.md rule 8); 409 if not awaiting review |
| `GET /logbook` | human | This session's reviews |
| `POST /events` | services (own events) · human (XR playback events) | `speech.playback.started` refused unless the script was approved |
| `WS /events` | any | First message `{ "type": "auth", "token", "after"? }`, then the session's events |

Env: `NEXUS_PAIRING_CODE`, `ORCHESTRATOR_TOKEN`, `VOICE_GATEWAY_TOKEN`, `XR_ORIGIN` (CORS), `DATABASE_URL`, `NEXUS_DATA_DIR`. Measurements are computed from each site's DEM at startup with packages/terrain.
