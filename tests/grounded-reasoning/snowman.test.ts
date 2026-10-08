/**
 * Snowman Grounded Reasoning Module — Test Suite
 * Artifact 8
 *
 * Tests identity invariants, operator algebra, causal constraints,
 * and category-error detection.
 */

import {
  makeSnowman,
  isValidSnowman
} from "../../src/modules/grounded-reasoning/snowman";

import {
  roll,
  stack,
  melt,
  collapse,
  meltSnowman
} from "../../src/modules/grounded-reasoning/operators";

import {
  gravityConstraint,
  stabilityConstraint,
  dissipationConstraint,
  structuralConstraint
} from "../../src/modules/grounded-reasoning/constraints";

import { detectCategoryError } from "../../src/modules/grounded-reasoning/categoryErrors";

/**
 * Simple assertion helper
 */
function assert(condition: boolean, message: string) {
  if (!condition) throw new Error("Test failed: " + message);
}

/**
 * IDENTITY TESTS
 */
export function testIdentity() {
  const s = makeSnowman(5, 3, 1);
  assert(isValidSnowman(s), "Valid Snowman should pass identity check");

  // Invalid radii
  try {
    makeSnowman(-1, 2, 1);
    assert(false, "Negative radius should throw");
  } catch {}

  // Invalid ordering (manually break)
  const broken = { ...s, mid: { ...s.mid, centerY: -10 } };
  assert(!isValidSnowman(broken), "Broken ordering should fail identity");
}

/**
 * OPERATOR TESTS
 */
export function testOperators() {
  const s = makeSnowman(5, 3, 1);

  // Melt
  const melted = melt(s.base, 0.5);
  assert(melted.radius === 2.5, "Melt should reduce radius");

  // Collapse
  const collapsed = collapse(s);
  assert(collapsed.radius === 9, "Collapse radius should equal sum");

  // Melt full Snowman
  const meltedSnowman = meltSnowman(s, 0.5);
  assert(isValidSnowman(meltedSnowman), "Melted Snowman should remain valid");

  // Stack
  const { upper } = stack(s.base, s.mid);
  assert(
    upper.centerY === s.base.centerY + s.base.radius + s.mid.radius,
    "Stack should compute correct centerY"
  );
}

/**
 * CONSTRAINT TESTS
 */
export function testConstraints() {
  const s = makeSnowman(5, 3, 1);

  assert(gravityConstraint(s), "Gravity constraint should hold");
  assert(stabilityConstraint(s), "Stability constraint should hold");
  assert(structuralConstraint(s), "Structural constraint should hold");

  assert(
    dissipationConstraint(s, 0.5),
    "Dissipation constraint should hold for valid factor"
  );
  assert(
    !dissipationConstraint(s, 2),
    "Dissipation constraint should fail for invalid factor"
  );
}

/**
 * CATEGORY-ERROR TESTS
 */
export function testCategoryErrors() {
  const s = makeSnowman(5, 3, 1);

  // No error
  assert(
    detectCategoryError(s) === null,
    "Valid Snowman should produce no category error"
  );

  // Identity violation
  const broken = { ...s, mid: { ...s.mid, centerY: -100 } };
  const err1 = detectCategoryError(broken);
  assert(err1?.type === "IdentityViolation", "Identity violation should be detected");

  // Dissipation violation
  const err2 = detectCategoryError(s, 2);
  assert(err2?.type === "OperatorViolation", "Operator violation should be detected");

  // Structural violation (manually break)
  const brokenStruct = { ...s, base: { ...s.base, radius: 0.1 } };
  const err3 = detectCategoryError(brokenStruct);
  assert(err3?.type === "StructuralViolation", "Structural violation should be detected");
}

/**
 * RUN ALL TESTS
 */
export function runAllTests() {
  testIdentity();
  testOperators();
  testConstraints();
  testCategoryErrors();
  return "All Snowman tests passed";
}
