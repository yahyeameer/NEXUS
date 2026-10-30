import type { Result, SieValidatorId } from "@nexus/schemas";

// SCIENTIFIC_INTEGRITY.md §1: every validator is a pure function `(input, context) => ValidationResult`.
export type ValidatorId = SieValidatorId;

export interface ValidationIssue {
  validator: ValidatorId;
  message: string;
  /** Index of the offending claim or sentence, when there is one. */
  index?: number;
}

export type ValidationResult = Result<true, ValidationIssue[]>;

export type Validator<I, C> = (input: I, context: C) => ValidationResult;
