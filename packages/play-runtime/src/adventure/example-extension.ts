import type { ExtensionDeclaration } from '@novel-game/contracts';

export const exampleSteadyCondition: ExtensionDeclaration = {
  id: 'steady-resource', version: '1.0.0', point: 'condition', name: 'Steady resource gate',
  reads: ['resource:money'], writes: [], hooks: ['onAction'], params: {minimum: {type: 'number', required: true, min: 0, max: 200}},
  reason: 'Built-in threshold blocks and the current comparison-only expressions cannot express a periodic residue gate over a resource.',
  code: '(input) => input.state["resource:money"] >= input.params.minimum && input.state["resource:money"] % 3 !== 2',
  tests: [
    {input: {state: {'resource:money': 0}, params: {minimum: 0}, seed: 1}, expected: true},
    {input: {state: {'resource:money': 10}, params: {minimum: 5}, seed: 1}, expected: true},
    {input: {state: {'resource:money': 11}, params: {minimum: 5}, seed: 1}, expected: false},
  ],
};

export const boundedFocusEffect: ExtensionDeclaration = {
  id: 'bounded-focus', version: '1.0.0', point: 'effect', name: 'Bounded focus change',
  reads: ['resource:focus'], writes: [{state: 'resource:focus', minDelta: -12, maxDelta: 12}], hooks: ['onAction'],
  params: {delta: {type: 'number', required: true, min: -12, max: 12}}, reason: 'Existing constant resource effects and comparison-only expressions cannot compute a state-dependent diminishing positive gain (ceil(delta / (1 + focus / 100))).',
  code: '(input) => [{kind:"resource",resourceId:"focus",delta:input.params.delta > 0 ? Math.ceil(input.params.delta / (1 + Math.max(0, input.state["resource:focus"]) / 100)) : input.params.delta}]',
  tests: [
    {input: {state: {'resource:focus': 100}, params: {delta: -12}, seed: 1}, expected: [{kind: 'resource', resourceId: 'focus', delta: -12}]},
    {input: {state: {'resource:focus': 50}, params: {delta: 0}, seed: 1}, expected: [{kind: 'resource', resourceId: 'focus', delta: 0}]},
    {input: {state: {'resource:focus': 100}, params: {delta: 12}, seed: 1}, expected: [{kind: 'resource', resourceId: 'focus', delta: 6}]},
  ],
};
