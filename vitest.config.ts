import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["{apps,services,packages}/*/src/**/*.test.ts"],
        },
      },
      {
        // `pnpm sie:redteam` — planted bad claims that the SIE must catch (SCIENTIFIC_INTEGRITY.md §7)
        test: {
          name: "redteam",
          include: ["packages/sie/redteam/**/*.test.ts"],
        },
      },
    ],
  },
});
