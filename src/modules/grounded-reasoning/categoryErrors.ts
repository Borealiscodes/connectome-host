/**
 * Category-Error Detection for Snowman Grounded Reasoning Module
 * Artifact 4
 *
 * Implements semantic correctness checks derived from the Lean Appendix B
 * formalization. Detects violations of identity, causal constraints, operator
 * feasibility, and structural coherence.
 */

import { Snowman, isValidSnowman } from "./snowman";
import {
  gravityConstraint,
  stabilityConstraint,
  dissipationConstraint,
  structuralConstraint
} from "./constraints";

/**
 * Category Error Types
 */
export type CategoryErrorType =
  | "IdentityViolation"
  | "CausalViolation"
  | "OperatorViolation"
  | "StructuralViolation"
  | "UnknownViolation";

export interface CategoryError {
  type: CategoryErrorType;
  message: string;
}

/**
 * CATEGORY-ERROR DETECTOR
 * Returns null if no category error is present.
 */
export function detectCategoryError(
  s: Snowman,
  meltFactor?: number
): CategoryError | null {
  // Identity violation: Snowman invariants broken
  if (!isValidSnowman(s)) {
    return {
      type: "IdentityViolation",
      message: "Snowman identity invariants violated"
    };
  }

  // Causal violation: gravity or stability broken
  const gravityOK = gravityConstraint(s);
  const stabilityOK = stabilityConstraint(s);

  if (!gravityOK || !stabilityOK) {
    return {
      type: "CausalViolation",
      message: "Causal constraints violated (gravity or stability)"
    };
  }

  // Dissipation violation (only checked when meltFactor provided)
  if (meltFactor !== undefined) {
    const dissipationOK = dissipationConstraint(s, meltFactor);
    if (!dissipationOK) {
      return {
        type: "OperatorViolation",
        message: "Dissipation constraint violated under melt operator"
      };
    }
  }

  // Structural violation: full-state feasibility broken
  if (!structuralConstraint(s)) {
    return {
      type: "StructuralViolation",
      message: "Structural feasibility violated"
    };
  }

  // No category error detected
  return null;
}
