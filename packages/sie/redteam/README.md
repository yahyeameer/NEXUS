# SIE red-team suite

`pnpm sie:redteam` runs every `*.test.ts` in this folder. Each test plants a bad claim or script
(SCIENTIFIC_INTEGRITY.md §7) and asserts the SIE catches it. Fixtures are added with the validators in Phase 4.
