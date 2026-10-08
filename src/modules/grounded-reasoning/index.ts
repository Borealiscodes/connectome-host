/**
 * Grounded Reasoning Module — Snowman
 * Artifact 5: Module Registry Integration
 *
 * Exposes the Snowman concept identity, operator algebra,
 * causal constraints, and category-error detection as a
 * unified module surface for Connectome Host.
 */

import { Snowman, Sphere, makeSnowman, isValidSnowman } from "./snowman";
import {
  roll,
  stack,
  melt,
  collapse,
  meltSnowman
} from "./operators";
import {
  gravityConstraint,
  stabilityConstraint,
  dissipationConstraint,
  structuralConstraint
} from "./constraints";
import { detectCategoryError } from "./categoryErrors";

/**
 * Public module surface
 */
export const SnowmanModule = {
  // Identity
  makeSnowman,
  isValidSnowman,

  // Operators
  roll,
  stack,
  melt,
  collapse,
  meltSnowman,

  // Constraints
  gravityConstraint,
  stabilityConstraint,
  dissipationConstraint,
  structuralConstraint,

  // Category Errors
  detectCategoryError
};

/**
 * Module registration object for Connectome Host.
 * Host-level integration is declarative; no runtime side effects.
 */
export default {
  id: "grounded-reasoning.snowman",
  description: "Snowman Grounded Reasoning Module",
  exports: SnowmanModule
};
