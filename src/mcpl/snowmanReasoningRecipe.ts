/**
 * Snowman Reasoning MCPL Recipe
 * Artifact 7
 *
 * Defines a multi-context program layer (MCPL) workflow for grounded
 * reasoning using the Snowman Reasoner Agent. Demonstrates structured
 * sequencing of construction, optional melt, constraint evaluation,
 * and category-error detection.
 */

import SnowmanReasonerAgent, {
  SnowmanReasonerInput,
  SnowmanReasonerOutput
} from "../agents/snowmanReasonerAgent";

export interface SnowmanReasoningRecipeInput extends SnowmanReasonerInput {}

export interface SnowmanReasoningRecipeOutput extends SnowmanReasonerOutput {}

/**
 * MCPL Recipe
 */
export const SnowmanReasoningRecipe = {
  id: "mcpl.snowmanReasoning",
  description: "MCPL workflow for Snowman grounded reasoning",

  async run(input: SnowmanReasoningRecipeInput): Promise<SnowmanReasoningRecipeOutput> {
    // Context 1: Construct + optional melt
    const initial = SnowmanReasonerAgent.run(input);

    // Context 2: Constraint evaluation (already included in agent output)
    const constraints = initial.constraints;

    // Context 3: Category-error detection (already included in agent output)
    const categoryError = initial.categoryError;

    // MCPL recipes return structured results
    return {
      snowman: initial.snowman,
      valid: initial.valid,
      constraints,
      categoryError
    };
  }
};

export default SnowmanReasoningRecipe;
