/**
 * Snowman Concept Identity
 * Grounded Reasoning Module — Artifact 1
 *
 * Defines the structural invariants for the Snowman grounding object.
 * All operators, constraints, and category-error detectors must respect
 * this identity.
 */

export interface Sphere {
  radius: number;
  centerY: number; // vertical axis only
}

export interface Snowman {
  base: Sphere;
  mid: Sphere;
  head: Sphere;
}

/**
 * Construct a Snowman with invariant-preserving geometry.
 */
export function makeSnowman(
  baseRadius: number,
  midRadius: number,
  headRadius: number
): Snowman {
  if (baseRadius <= 0 || midRadius <= 0 || headRadius <= 0) {
    throw new Error("Non-degenerate radii required");
  }

  if (!(baseRadius >= midRadius && midRadius >= headRadius)) {
    throw new Error("Radius monotonicity violated");
  }

  const base: Sphere = {
    radius: baseRadius,
    centerY: 0
  };

  const mid: Sphere = {
    radius: midRadius,
    centerY: base.centerY + base.radius + midRadius
  };

  const head: Sphere = {
    radius: headRadius,
    centerY: mid.centerY + mid.radius + headRadius
  };

  return { base, mid, head };
}

/**
 * Validate Snowman identity invariants.
 */
export function isValidSnowman(s: Snowman): boolean {
  const { base, mid, head } = s;

  const radiiValid =
    base.radius > 0 &&
    mid.radius > 0 &&
    head.radius > 0 &&
    base.radius >= mid.radius &&
    mid.radius >= head.radius;

  const orderingValid =
    base.centerY < mid.centerY &&
    mid.centerY < head.centerY;

  const contactValid =
    mid.centerY - base.centerY === base.radius + mid.radius &&
    head.centerY - mid.centerY === mid.radius + head.radius;

  return radiiValid && orderingValid && contactValid;
}
