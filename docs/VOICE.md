# Voice Intelligence

Voice turns NEXUS into a field team the scientist talks to. Every word NEXUS speaks passes the Scientific Integrity Engine first, and every voice action has a hand equivalent.

## 1. Targets

| Metric | Target |
| --- | --- |
| Command acts after mic release | ≤ 1.5 s |
| Answer audio starts | ≤ 4 s (play a "thinking" cue at 600 ms) |
| Barge-in stops playback | ≤ 300 ms |
| Deictic resolution accuracy (demo sites) | ≥ 90 % |
| Hands-only completion | 100 % |

## 2. Capture

- **Push-to-talk (default):** palm up → wrist menu → pinch and hold mic → release to send.
- **Wake phrase "NEXUS" (opt-in only).**
- Quest Browser does not expose the Web Speech recognition API, so capture uses `getUserMedia` + `MediaRecorder`/AudioWorklet and streams 16 kHz mono PCM or Opus over WSS to `voice-gateway`.
- XR sends ray-hit and head-direction samples at 30 Hz with the same clock as audio, so word timestamps can be matched to pointing.
- Mic indicator always visible while capturing. First-run permission screen explains why the mic is used and offers "Continue without voice".

## 3. Intent routing

After the final transcript, `packages/voice/intentRouter.ts` classifies into:

| Intent | Detection | Action |
| --- | --- | --- |
| `command` | Fixed grammar (below), keyword match first | Execute immediately |
| `field_note` | Starts with "note", "mark", or descriptive sentence while pointing | Create FieldNote + Observation |
| `question` | Question form, or "why / what / which / where / how" | Grounded Q&A on the selected finding |
| `review` | "approve / reject / inconclusive" (+ optional reason) | Review event, rationale stored verbatim |
| `debate` | "debate this", "argue both sides" | Start Evidence Debate |
| `clarification` | Answer to a clarification prompt | Resolve pending reference |

LLM classification is a fallback only when the grammar does not match.

### Command grammar (MVP)

```
investigate (this|that|<site name>)     zoom (in|out)        rotate (left|right)
show (evidence|sources)                 hide panel           next site | previous site
read it (to me)                         stop | quiet         pause | resume
go to <site name>                       reset (position|view)
approve | reject | inconclusive [because <reason>]
where does that come from               debate this
mark this | note <text>                 whisper mode (on|off)
```

## 4. Deictic grounding

Resolve "this / that / here / there / it" and qualifiers:

1. Take each deictic word's timestamp from STT; read the ray hit at `t ± 150 ms`.
2. If the ray hit is empty or on UI, fall back to head-direction cone (8°).
3. Apply qualifiers ("left", "bigger", "darker", "rim", "floor") against labelled features within 2 m (scene units) of the hit.
4. Score candidates; if top score < **0.75** or top two within 0.1 → ask one clarification ("Do you mean the crater rim or the boulder below it?") and glow both candidates as chips.
5. Never resolve silently below threshold. Log confidence on the FieldNote.

## 5. Epistemic Voice Policy

Spoken framing must match the claim type. Enforced by `packages/sie/voiceScript.ts` before TTS.

| Claim type | Required framing (one of) | Forbidden |
| --- | --- | --- |
| observation | "The image shows…", "I can see…", "You noted…" | "caused by", "formed by", "proves" |
| measurement | "<Dataset> gives about <n> <unit>…" | Any number not in `MeasurementRecord` (±5 %) |
| interpretation | "This is consistent with…", "One interpretation is…" | "This is…", "This proves…", "definitely" |
| hypothesis | "One possibility, with <level> uncertainty, is…" | Any definite phrasing |
| speculation | Only if user asked: "Speculating, without evidence…" | Default output |

Additional rules:

- Every spoken finding states its uncertainty level once.
- Each sentence with a claim must map to ≥ 1 evidence ID (kept in script metadata, not spoken).
- High uncertainty → speech rate 0.9×, and the uncertainty statement comes first.
- Validator outcome: `SPEAK_AS_APPROVED` · `REWRITE_SCRIPT` (one automatic rewrite, then re-check) · `SILENT_CARD_ONLY`.

## 6. Spatial voices

| Speaker | Voice | Position |
| --- | --- | --- |
| Narrator | Neutral, calm | Fixed, 1 m in front, slightly left |
| Terrain / elevation agents | Voice A | Agent orb on the feature floor |
| Imagery agents | Voice B | Orb above the site |
| Geology / hypothesis agents | Voice C | Orb beside the site |
| Alternative-explanation (Skeptic) | Voice D | Orb on the opposite side of the site |

- Web Audio `PannerNode`, `panningModel: 'HRTF'`, `distanceModel: 'inverse'`, refDistance tuned so speech stays intelligible at tabletop scale.
- Ducking: narration lowers video and ambience by 12 dB.
- Speaking orb glows; its evidence beam pulses with speech amplitude.

## 7. Evidence Debate

- Two speakers: Hypothesis Advocate (Hypothesis Generator #33) vs Alternative Explanation Researcher (#34), moderated by Debate Moderator (#55).
- Max 3 turns each, ≤ 25 s per turn. Each turn must cite evidence IDs; uncited turns are removed by the SIE.
- User can interrupt at any time ("Stop. Address the rim shape.").
- Moderator never declares a winner; the scientist ends with a review decision. Transcript attached to the finding.

## 8. Grounded Q&A

- Context = selected finding + its evidence pack items + the user's field notes. Nothing else.
- If no evidence supports an answer: "I don't have evidence for that in this investigation." Optionally offer a follow-up research task.
- "Where does that come from?" → speak dataset label + product ID + acquisition date; draw evidence beam to source region.

## 9. Multilingual & accessibility

- Target languages: English, Arabic, Somali, French, Spanish — enable each only after STT/TTS quality is verified on 20 test utterances with scientific terms.
- Dataset names and scientific terms stay untranslated.
- Live captions for both directions; scientist lines and NEXUS lines in different colours, prefixed by speaker.
- Read-aloud on every card. Whisper mode = text only. Per-group volume and rate sliders.

## 10. System phrases (no SIE needed)

Fixed strings in `packages/voice/src/systemPhrases.ts`, e.g. welcome, "Listening", "I didn't catch that", "Paused", errors. They must contain no scientific claims. Any change requires review.

## 11. Failure handling

| Failure | Behaviour |
| --- | --- |
| STT error / timeout | "I didn't catch that." + show suggested chips |
| Low STT confidence (< 0.6) | Show transcript and ask "Did you mean…?" with chips |
| TTS error | Card + captions only; small icon indicates audio unavailable |
| Mic denied | Continue hands-only; tip on how to enable later |
