/**
 * Operator Algebra for Snowman Grounded Reasoning Module
 * Artifact 2
 *
 * Defines the primitive operators: roll, stack, melt, collapse.
 * Operators preserve Snowman invariants where applicable and
 * produce new geometric states without mutation.
 */

import { Snowman, Sphere, isValidSnowman, makeSnowman } from "./snowman";

/**
 * ROLL OPERATOR
 * Applies horizontal displacement to a sphere.
 * Snowman identity is vertical-only; roll is only valid on isolated spheres.
 */
export function roll(sphere: Sphere, dx: number): Sphere {
  if (dx === 0) return sphere;

  // Snowman identity forbids horizontal displacement.
  // Roll is only defined for isolated spheres.
  return {
    radius: sphere.radius,
    centerY: sphere.centerY // vertical axis preserved
    // horizontal displacement is conceptual only; not represented in identity
  };
}

/**
 * STACK OPERATOR
 * Vertically composes two spheres into a stable 2-layer structure.
 * Used internally by makeSnowman() but exposed for operator algebra completeness.
 */
export function stack(lower: Sphere, upper: Sphere): { lower: Sphere; upper: Sphere } {
  if (lower.radius < upper.radius) {
    throw new Error("Stack invariant violated: lower sphere must have >= radius");
  }

  const newUpper: Sphere = {
    radius: upper.radius,
    centerY: lower.centerY + lower.radius + upper.radius
  };

  return { lower, upper: newUpper };
}

/**
 * MELT OPERATOR
 * Reduces radius by a dissipation factor.
 * Must preserve non-degeneracy.
 */
export function melt(sphere: Sphere, factor: number): Sphere {
  if (factor <= 0 || factor >= 1) {
    throw new Error("Melt factor must be between 0 and 1");
  }

  const newRadius = sphere.radius * factor;

  if (newRadius <= 0) {
    throw new Error("Sphere degenerated under melt");
  }

  return {
    radius: newRadius,
    centerY: sphere.centerY
  };
}

/**
 * COLLAPSE OPERATOR
 * Structural failure: Snowman collapses into a single mass.
 * Produces a sphere whose radius is the sum of all radii.
 */
export function collapse(s: Snowman): Sphere {
  const totalRadius = s.base.radius + s.mid.radius + s.head.radius;

  return {
    radius: totalRadius,
    centerY: 0 // collapse resets vertical structure
  };
}

/**
 * APPLY MELT TO FULL SNOWMAN
 * Applies melt operator to each layer and recomposes.
 */
export function meltSnowman(s: Snowman, factor: number): Snowman {
  const base = melt(s.base, factor);
  const mid = melt(s.mid, factor);
  const head = melt(s.head, factor);

  const newSnowman = makeSnowman(base.radius, mid.radius, head.radius);

  if (!isValidSnowman(newSnowman)) {
    throw new Error("Snowman invalid after melt");
  }

  return newSnowman;
}
