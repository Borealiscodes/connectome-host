/**
 * Causal Constraints for Snowman Grounded Reasoning Module
 * Artifact 3
 *
 * Defines gravity, stability, dissipation, and structural constraints.
 * Constraints are pure functions returning boolean feasibility values.
 */

import { Snowman, Sphere, isValidSnowman } from "./snowman";

/**
 * GRAVITY CONSTRAINT
 * Ensures vertical ordering and downward force consistency.
 */
export function gravityConstraint(s: Snowman): boolean {
  const { base, mid, head } = s;

  const ordering =
    base.centerY < mid.centerY &&
    mid.centerY < head.centerY;

  // Gravity requires that each sphere rests exactly on the one below.
  const contact =
    mid.centerY - base.centerY === base.radius + mid.radius &&
    head.centerY - mid.centerY === mid.radius + head.radius;

  return ordering && contact;
}

/**
 * STABILITY CONSTRAINT
 * Ensures lower spheres have sufficient radius to support upper ones.
 */
export function stabilityConstraint(s: Snowman): boolean {
  const { base, mid, head } = s;

  const monotonic =
    base.radius >= mid.radius &&
    mid.radius >= head.radius;

  return monotonic;
}

/**
 * DISSIPATION CONSTRAINT
 * Ensures melt operations remain physically plausible.
 * Melt factor must be between 0 and 1, and radii must remain non-degenerate.
 */
export function dissipationConstraint(s: Snowman, factor: number): boolean {
  if (factor <= 0 || factor >= 1) return false;

  const baseValid = s.base.radius * factor > 0;
  const midValid = s.mid.radius * factor > 0;
  const headValid = s.head.radius * factor > 0;

  return baseValid && midValid && headValid;
}

/**
 * STRUCTURAL CONSTRAINT
 * Ensures the entire Snowman is feasible under all constraints.
 */
export function structuralConstraint(s: Snowman): boolean {
  return (
    isValidSnowman(s) &&
    gravityConstraint(s) &&
    stabilityConstraint(s)
  );
}
