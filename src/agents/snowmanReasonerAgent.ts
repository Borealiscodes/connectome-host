/**
 * Snowman Reasoner Agent
 * Artifact 6
 *
 * Demonstrates usage of the Snowman Grounded Reasoning Module inside
 * a Connectome Host agent. Applies operators, evaluates constraints,
 * and reports category errors.
 */

import { SnowmanModule } from "../modules/grounded-reasoning";

export interface SnowmanReasonerInput {
  baseRadius: number;
  midRadius: number;
  headRadius: number;
  meltFactor?: number;
}

export interface SnowmanReasonerOutput {
  snowman: any;
  valid: boolean;
  constraints: {
    gravity: boolean;
    stability: boolean;
    structural: boolean;
  };
  categoryError: any | null;
}

/**
 * Example agent demonstrating grounded reasoning workflow.
 */
export const SnowmanReasonerAgent = {
  id: "agent.snowmanReasoner",
  description: "Example agent using the Snowman Grounded Reasoning Module",

  run(input: SnowmanReasonerInput): SnowmanReasonerOutput {
    const {
      makeSnowman,
      isValidSnowman,
      gravityConstraint,
      stabilityConstraint,
      structuralConstraint,
      meltSnowman,
      detectCategoryError
    } = SnowmanModule;

    // Construct initial Snowman
    let snowman = makeSnowman(
      input.baseRadius,
      input.midRadius,
      input.headRadius
    );

    // Optional melt operation
    if (input.meltFactor !== undefined) {
      snowman = meltSnowman(snowman, input.meltFactor);
    }

    // Evaluate constraints
    const gravity = gravityConstraint(snowman);
    const stability = stabilityConstraint(snowman);
    const structural = structuralConstraint(snowman);

    // Category error detection
    const categoryError = detectCategoryError(snowman, input.meltFactor);

    return {
      snowman,
      valid: isValidSnowman(snowman),
      constraints: {
        gravity,
        stability,
        structural
      },
      categoryError
    };
  }
};

export default SnowmanReasonerAgent;
