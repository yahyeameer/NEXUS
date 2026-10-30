# Interaction: Hands + Voice

Competition rule: **the experience must be fully completable with hands alone.** Voice is an optional parallel channel. Every row below needs both columns working before release.

## 1. Parity table

| Action | Hands (required) | Voice (optional) |
| --- | --- | --- |
| Start / skip onboarding | Poke Start / Skip | "Start", "Skip" |
| Switch immersive ↔ tabletop | Wrist menu → Mode | "Tabletop mode" / "Immersive mode" |
| Place / move terrain (tabletop) | Grab edge handle and move | "Reset position" |
| Rotate terrain | Pinch + drag | "Rotate left / right" |
| Zoom | Two-hand pinch, spread / squeeze | "Zoom in / out" |
| Go to site | Poke site in wrist list | "Go to Hadley Rille" |
| Record observation | Ray + pinch feature → poke descriptor chips | Point + describe ("Boulders here, angular") |
| Start investigation | Poke Investigate on selection | "Investigate this" |
| Open evidence | Poke evidence chip | "Show evidence" |
| Ask question | Poke one of 3 suggested question chips | Ask anything |
| Provenance | Poke source chip | "Where does that come from?" |
| Hear card | Poke speaker icon | "Read it to me" |
| Stop speech | Poke anywhere on the speaking card | "Stop" |
| Start debate | Poke Debate | "Debate this" |
| Review | Poke Approve / Reject / Inconclusive + reason chip | "Reject because the rim is too degraded" |
| Video mark | Poke Mark on video panel | "Mark this" |
| Pause / resume | Palm up → Pause | "Pause" / "Resume" |
| Whisper mode | Wrist menu toggle | "Whisper mode on" |
| Clarify reference | Poke the highlighted candidate | Name it ("the rim") |

## 2. Gestures

| Gesture | Use |
| --- | --- |
| Point + pinch (ray select) | Select features at distance |
| Poke | Buttons, chips on near panels |
| Pinch + drag | Rotate terrain, scroll panels |
| Two-hand pinch | Zoom terrain |
| Grab | Move terrain / panels |
| Palm up (left) | Wrist menu incl. push-to-talk mic |
| Pinch + hold on mic | Push-to-talk |

## 3. Layout & comfort

- Seated by default. All required UI within a 60° horizontal / 40° vertical cone in front of the user.
- Panels 50–70 cm away, top edge slightly below eye level, tilted 10–15° toward the user.
- Poke targets ≥ 4 cm, spacing ≥ 1 cm. Ray targets ≥ 3° angular size.
- Every poke gets audio click + 5 % scale bump; every successful pinch-select gets a soft tick.
- No required UI at the field-of-view edges; follow-mode panels lazy-follow with 0.5 s delay.
- Captions strip under the active card, max 2 lines, 18 mm text height at 60 cm.

## 4. Visual states

| State | Ring | Audio cue (from feature) |
| --- | --- | --- |
| Observation recorded | Thin grey | Soft click |
| Researching | Pulsing + agent orbs | Low hum |
| Ready for review | Steady amber | Two-note chime |
| Needs more evidence | Dashed amber | Single low note |
| Reviewed | Solid green | Resolved chord |
| Rejected / inconclusive | Grey + ✕ / ? | Muted tone |

Never use visuals or sounds that suggest "discovery confirmed".

## 5. First five minutes

1. 0:00 Passthrough fades in; terrain settles onto desk (or immersive scene loads).
2. 0:10 Narrator: one sentence welcome + "Pinch to select. Palm up for the menu."
3. 0:30 Guided pinch on the first glowing site → agent orbs fly out (precomputed, fast).
4. 1:30 First finding card appears; narrator shows the speaker icon and question chips.
5. 2:30 Prompt to try the mic (skippable): "Hold the mic and ask: what contradicts this?"
6. 3:30 Guided review → green ring → "Two more sites are waiting."
