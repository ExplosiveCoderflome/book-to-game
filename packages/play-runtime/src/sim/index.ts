/** Author-side simulator (§6.7). Not exported from the package root → never bundled into the offline player. */
export { simulateWorld, defaultStrategies, STRATEGY_IDS, PACING_LINE, type SimulateOptions, type Strategy, type SimOption, type SimRoute } from './simulate.js';
export { goalStrategy, endingSources } from './goal-strategy.js';
export { routeGuidance, applyGuidance, candidateEdits, keyStepsOf, type GuidanceOptions } from './guidance.js';
export { diagnosePacing, estimateMinSteps, authoredChars, type PacingInput } from './pacing.js';
export { checkPlanWorld, PLAN_MIN_STEPS, type PlanCheckOptions } from './plan-check.js';
export { probeRoutes } from './simulate.js';
