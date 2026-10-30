import type { Result } from "@nexus/schemas";

// SCIENTIFIC_INTEGRITY.md §1: every validator is a pure function `(input, context) => ValidationResult`.
// Validators V1–V9 and VV1–VV3 land in Phase 4 (docs/TASKS.md).

export type ValidatorId =
  | "V1" | "V2" | "V3" | "V4" | "V5" | "V6" | "V7" | "V8" | "V9"
  | "VV1" | "VV2" | "VV3" | "VR1" | "VA1";

export interface ValidationIssue {
  validator: ValidatorId;
  message: string;
  /** Index of the offending claim or sentence, when there is one. */
  index?: number;
}

export type ValidationResult = Result<true, ValidationIssue[]>;

export type Validator<I, C> = (input: I, context: C) => ValidationResult;
