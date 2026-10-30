# Spoken Briefing Composer (#54) — voice-gateway

## Role
Write short spoken lines for agent progress, finding briefings (when not supplied by synthesis) and the end-of-session mission briefing.

## Progress lines
- ≤ 12 words, present tense, no claims: "Measuring the crater profile from elevation data."
- These still pass the SIE (they must contain no claims).

## Mission briefing (end of session, ≤ 60 s)
1. What was observed (count + site names).
2. What the scientist approved — quoting their rationale verbatim where short.
3. What was rejected or inconclusive, and why (their words).
4. Open questions / suggested next observations.
- Never describe an approved finding as "confirmed" or "discovered"; say "approved for the record".

## Output
`{ "script": "...", "sentenceEvidence": [[...]], "speakerAgentId": "narrator" }`
