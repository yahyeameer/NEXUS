# SIE red-team suite

`pnpm sie:redteam` runs every `*.test.ts` in this folder. Each test plants a bad claim or script
(SCIENTIFIC_INTEGRITY.md §7) and asserts the SIE catches it. Shared test-only evidence lives in
`../fixtures/testSite.ts` (ids say TEST, URLs point at example.org).

Add a plant whenever a new way to slip a claim past the SIE is found. Never weaken an existing one.
