import { parse } from 'acorn';
import { getQuickJS, getQuickJSSync } from 'quickjs-emscripten';
import { extensionDeclarationSchema, type ExtensionDeclaration, type WorldContent, type WorldCondition, type WorldEffect } from '@novel-game/contracts';
import type { AdventureState } from './adventure-state.js';

export type ExtensionIssue = {severity: 'error'; code: string; extensionId?: string; message: string};
export interface ExtensionCheck {ok: boolean; issues: ExtensionIssue[]; status: 'pass' | 'rewrite' | 'human'; rewriteRound: number}
export interface ExtensionRuntimeOptions {seed?: number; timeoutMs?: number; memoryLimitBytes?: number; maxStackBytes?: number; maxInterrupts?: number}
export const EXTENSION_LIMITS = Object.freeze({codeBytes: 32768, inputBytes: 32768, outputBytes: 16384,
  memoryLimitBytes: 2 * 1024 * 1024, maxStackBytes: 128 * 1024, timeoutMs: 50, maxInterrupts: 100});
// No top-level await: existing synchronous/non-extension consumers keep their API.
// Await initializeExtensionSandbox at the host boundary before loading an extension world.
let ready: ReturnType<typeof getQuickJS> | undefined;
export function initializeExtensionSandbox(): ReturnType<typeof getQuickJS> { return ready ??= getQuickJS(); }
// Warm the WASM runtime when this module is loaded; synchronous gameplay APIs can then execute extensions.
void initializeExtensionSandbox();
const globals = new Set(['Math', 'JSON', 'Number', 'String', 'Boolean', 'Array', 'Object', 'Error', 'Infinity', 'NaN', 'undefined', 'parseInt', 'parseFloat', 'isFinite', 'isNaN']);
const forbiddenProperties = new Set(['constructor', 'prototype', '__proto__', 'caller', 'callee', 'arguments']);
const syntax = new Set(['Program', 'ExpressionStatement', 'ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration',
  'Identifier', 'Literal', 'BlockStatement', 'ReturnStatement', 'VariableDeclaration', 'VariableDeclarator',
  'IfStatement', 'ConditionalExpression', 'BinaryExpression', 'LogicalExpression', 'UnaryExpression', 'UpdateExpression',
  'AssignmentExpression', 'SequenceExpression', 'CallExpression', 'MemberExpression', 'ArrayExpression', 'ObjectExpression', 'Property',
  'ForStatement', 'ForOfStatement', 'ForInStatement', 'WhileStatement', 'DoWhileStatement', 'BreakStatement', 'ContinueStatement',
  'ThrowStatement', 'TryStatement', 'CatchClause', 'SwitchStatement', 'SwitchCase', 'EmptyStatement', 'TemplateLiteral', 'TemplateElement']);

/** Static API allowlist, not the isolation boundary (that is the separate WASM heap). */
function checkCode(code: string): void {
  if (new TextEncoder().encode(code).byteLength > EXTENSION_LIMITS.codeBytes) throw new Error('code exceeds 32768 bytes');
  const ast = parse(`(${code})`, {ecmaVersion: 2022}) as unknown as Node;
  const expression = ((ast.body as Node[])[0]!.expression as Node);
  if (!['ArrowFunctionExpression', 'FunctionExpression'].includes(expression.type)) throw new Error('code must be a function expression');
  const locals = new Set<string>();
  const visit = (node: Node, fn: (node: Node, parent?: Node, key?: string) => void, parent?: Node, key?: string): void => {
    fn(node, parent, key);
    for (const [k, value] of Object.entries(node)) {
      if (Array.isArray(value)) for (const child of value) { if (child && typeof child === 'object' && 'type' in child) visit(child as Node, fn, node, k); }
      else if (value && typeof value === 'object' && 'type' in value) visit(value as Node, fn, node, k);
    }
  };
  visit(ast, node => {
    if (!syntax.has(node.type) || node.async || node.generator || node.regex) throw new Error(`syntax not allowed: ${node.type}`);
    if (node.type.includes('Function')) {
      if (node.id) locals.add((node.id as Node).name as string);
      for (const p of node.params as Node[]) { if (p.type !== 'Identifier') throw new Error('parameters must be identifiers'); locals.add(p.name as string); }
    }
    if (node.type === 'VariableDeclarator' || node.type === 'CatchClause') {
      const binding = (node.id ?? node.param) as Node | null;
      if (binding) { if (binding.type !== 'Identifier') throw new Error('bindings must be identifiers'); locals.add(binding.name as string); }
    }
    if (node.type === 'MemberExpression') {
      const p = node.property as Node;
      if (node.computed && (p.type !== 'Literal' || !['string', 'number'].includes(typeof p.value))) throw new Error('computed access requires a literal key');
      if (forbiddenProperties.has(String(node.computed ? p.value : p.name))) throw new Error('forbidden property');
    }
    if (node.type === 'Property' && (node.computed || node.kind !== 'init' || forbiddenProperties.has(String((node.key as Node).name ?? (node.key as Node).value)))) throw new Error('invalid object property');
  });
  visit(ast, (node, parent, key) => {
    if (node.type !== 'Identifier') return;
    if (parent?.type === 'MemberExpression' && key === 'property' && !parent.computed) return;
    if (parent?.type === 'Property' && key === 'key' && !parent.shorthand) return;
    if (!locals.has(node.name as string) && !globals.has(node.name as string)) throw new Error(`API not allowed: ${node.name}`);
    // Block shadowing of exposed intrinsics and access to ambient capabilities.
    if (locals.has(node.name as string) && globals.has(node.name as string)) throw new Error(`reserved binding: ${node.name}`);
  });
}
interface Node {type: string; [key: string]: unknown}
export function extensionRewriteRound(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.min(3, Math.trunc(value))) : 3; }
export function checkExtensionDeclaration(value: unknown, rewriteRound = 0): ExtensionCheck {
  const parsed = extensionDeclarationSchema.safeParse(value);
  const issues: ExtensionIssue[] = [];
  if (!parsed.success) issues.push({severity: 'error', code: 'extension.declaration', message: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')});
  else {
    try {
      checkCode(parsed.data.code);
      for (const test of parsed.data.tests) {
        safeParams(parsed.data, test.input.params);
        for (const [key, value] of Object.entries(test.input.state)) {
          if (!parsed.data.reads.includes(key) || (key.startsWith('fact:') ? typeof value !== 'boolean' : typeof value !== 'number')) throw new Error(`invalid test state: ${key}`);
        }
        validateOutput(parsed.data, test.expected);
      }
    } catch (error) { issues.push({severity: 'error', code: 'extension.api-or-test', extensionId: parsed.data.id, message: messageOf(error)}); }
  }
  const round = extensionRewriteRound(rewriteRound);
  return {ok: !issues.length, issues, status: !issues.length ? 'pass' : round < 3 ? 'rewrite' : 'human', rewriteRound: round};
}
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export class ExtensionError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
export function extensionIssue(extensionId: string, error: unknown): ExtensionIssue {
  return {severity: 'error', code: error instanceof ExtensionError ? error.code : 'extension.invalid-result', extensionId, message: messageOf(error)};
}
function safeParams(d: ExtensionDeclaration, params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, spec] of Object.entries(d.params)) {
    const value = Object.hasOwn(params, key) ? params[key] : spec.default;
    if (value === undefined) { if (spec.required) throw new Error(`missing parameter: ${key}`); continue; }
    if (spec.type === 'number' || spec.type === 'integer') {
      if (typeof value !== 'number' || !Number.isFinite(value) || (spec.type === 'integer' && !Number.isInteger(value)) || value < spec.min! || value > spec.max!) throw new Error(`invalid parameter: ${key}`);
    } else if (typeof value !== spec.type || (spec.type === 'string' && (value as string).length > spec.maxLength!)) throw new Error(`invalid parameter: ${key}`);
    out[key] = value;
  }
  if (Object.keys(params).some(key => !Object.hasOwn(d.params, key))) throw new Error('undeclared parameter');
  return out;
}
export function checkExtensionInvocation(d: ExtensionDeclaration, params: Record<string, unknown>): void { safeParams(d, params); }
type SafeEffect = Extract<WorldEffect, {kind: 'resource' | 'set'}>;
/** Validate the ENTIRE list, including cumulative writes, before returning native engine effects. */
function validateOutput(d: ExtensionDeclaration, output: unknown): SafeEffect[] {
  if (d.point === 'condition') { if (typeof output !== 'boolean') throw new Error('condition must return boolean'); return []; }
  if (!Array.isArray(output) || output.length > 80) throw new Error('effect must return at most 80 effects');
  const writes = new Map(d.writes.map(w => [w.state, w]));
  const totals = new Map<string, number>(); const facts = new Set<string>(); const effects: SafeEffect[] = [];
  for (const row of output as unknown[]) {
    if (!row || typeof row !== 'object') throw new Error('invalid effect row');
    const r = row as Record<string, unknown>;
    let key: string; let delta: number;
    if (r.kind === 'resource' && typeof r.resourceId === 'string' && typeof r.delta === 'number' && Object.keys(r).every(k => ['kind', 'resourceId', 'delta'].includes(k))) {
      key = `resource:${r.resourceId}`; delta = r.delta;
      effects.push({kind: 'resource', resourceId: r.resourceId, delta});
    } else if (r.kind === 'set' && typeof r.factId === 'string' && typeof r.value === 'boolean' && Object.keys(r).every(k => ['kind', 'factId', 'value'].includes(k))) {
      key = `fact:${r.factId}`; delta = Number(r.value);
      if (facts.has(key)) throw new Error(`duplicate fact write: ${key}`);
      facts.add(key); effects.push({kind: 'set', factId: r.factId, value: r.value});
    } else throw new Error('only native resource/set effects are allowed');
    const cap = writes.get(key);
    if (!cap) throw new ExtensionError('extension.unauthorized-write', `undeclared write ${key}; entire effect discarded`);
    const total = (totals.get(key) ?? 0) + delta;
    if (!Number.isFinite(delta) || !Number.isFinite(total) || delta < cap.minDelta || delta > cap.maxDelta || total < cap.minDelta || total > cap.maxDelta) throw new Error(`delta out of range for ${key}; entire effect discarded`);
    totals.set(key, total);
  }
  return effects;
}
function budget(value: number | undefined, maximum: number): number {
  if (value === undefined) return maximum;
  if (!Number.isFinite(value) || value <= 0) throw new Error('invalid sandbox budget');
  return Math.min(maximum, Math.floor(value));
}
export interface ExtensionExecution {output: unknown; effects: SafeEffect[]; randomCalls: number}
export function runExtensionSync(declaration: ExtensionDeclaration, params: Record<string, unknown>, state: AdventureState,
  options: ExtensionRuntimeOptions = {}): ExtensionExecution {
  const check = checkExtensionDeclaration(declaration);
  if (!check.ok) throw new ExtensionError('extension.invalid-declaration', check.issues.map(i => i.message).join('; '));
  const d = extensionDeclarationSchema.parse(declaration);
  const projected: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of d.reads) projected[key] = key.startsWith('resource:') ? state.resources[key.slice(9)] ?? 0
    : key.startsWith('fact:') ? state.facts[key.slice(5)] ?? false : state.elapsed;
  const input = JSON.stringify({state: projected, params: safeParams(d, params)});
  if (new TextEncoder().encode(input).length > EXTENSION_LIMITS.inputBytes) throw new Error('input too large');
  let quickjs: ReturnType<typeof getQuickJSSync>;
  try { quickjs = getQuickJSSync(); } catch { throw new ExtensionError('extension.not-ready', 'await initializeExtensionSandbox() before loading extension worlds'); }
  const deadline = performance.now() + budget(options.timeoutMs, EXTENSION_LIMITS.timeoutMs);
  const maxInterrupts = budget(options.maxInterrupts, EXTENSION_LIMITS.maxInterrupts);
  let interrupts = 0; let interrupted = false;
  const vm = quickjs.newRuntime({memoryLimitBytes: budget(options.memoryLimitBytes, EXTENSION_LIMITS.memoryLimitBytes),
    maxStackSizeBytes: budget(options.maxStackBytes, EXTENSION_LIMITS.maxStackBytes),
    interruptHandler: () => { interrupted ||= ++interrupts > maxInterrupts || performance.now() >= deadline; return interrupted; }});
  try {
    // Only these JS intrinsics exist. No module loader or host callbacks are installed.
    const context = vm.newContext({intrinsics: {BaseObjects: true, Eval: true, JSON: true, MapSet: true}});
    try {
      const seed = (options.seed ?? state.rng?.seed ?? 0) >>> 0;
      const cursor = options.seed === undefined ? state.rng?.cursor ?? 0 : 0;
      // Compile in GLOBAL scope so extension closures cannot reach trusted wrapper locals.
      const compiled = context.evalCode(`globalThis.__extension = (${d.code}); undefined`, 'extension-function.js', {type: 'global', strict: true});
      if (compiled.error) { try { throw new ExtensionError('extension.execution', 'extension compilation failed'); } finally { compiled.error.dispose(); } }
      compiled.value.dispose();
      const script = `(() => { 'use strict';
        const fn = globalThis.__extension;
        const stringify = JSON.stringify; const imul = Math.imul;
        const freeze = (o) => { if (o && typeof o === 'object') { for (const k of Object.keys(o)) freeze(o[k]); Object.freeze(o); } return o; };
        let cursor = ${cursor}; let calls = 0;
        const random = () => { calls++; let t = (${seed} + imul(++cursor, 0x6D2B79F5)) | 0; t = imul(t ^ (t >>> 15), t | 1); t ^= t + imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
        Object.defineProperty(Math, 'random', {value: random, writable: false, configurable: false});
        Object.defineProperty(Function.prototype, 'constructor', {value: undefined});
        const root = globalThis;
        for (const key of Object.getOwnPropertyNames(root)) if (!${JSON.stringify([...globals])}.includes(key)) delete root[key];
        Object.freeze(Math); Object.freeze(JSON); Object.freeze(Object.prototype); Object.freeze(Array.prototype);
        const input = freeze(${input});
        const output = fn(input, random);
        return stringify({output, randomCalls: calls});
      })()`;
      const result = context.evalCode(script, 'extension.js', {type: 'global', strict: true});
      if (result.error) {
        try { throw new ExtensionError(interrupted ? 'extension.budget' : 'extension.execution', String(context.dump(result.error)?.message ?? 'sandbox execution failed')); }
        finally { result.error.dispose(); }
      }
      let text: string;
      try {
        if (context.typeof(result.value) !== 'string') throw new Error('invalid serialized result');
        text = context.getString(result.value);
      } finally { result.value.dispose(); }
      if (performance.now() >= deadline) throw new ExtensionError('extension.budget', 'sandbox time limit exceeded');
      if (new TextEncoder().encode(text).length > EXTENSION_LIMITS.outputBytes) throw new Error('output too large');
      const resultValue = JSON.parse(text) as {output: unknown; randomCalls: number};
      return {output: resultValue.output, effects: validateOutput(d, resultValue.output), randomCalls: resultValue.randomCalls};
    } finally { context.dispose(); }
  } finally { vm.dispose(); }
}
export async function runExtension(d: ExtensionDeclaration, params: Record<string, unknown>, state: AdventureState, options?: ExtensionRuntimeOptions): Promise<unknown> {
  await initializeExtensionSandbox(); return runExtensionSync(d, params, state, options).output;
}
export async function evaluateExtensionCondition(condition: Extract<WorldCondition, {kind: 'extension'}>, declarations: ExtensionDeclaration[], state: AdventureState, options?: ExtensionRuntimeOptions): Promise<boolean> {
  const d = declarations.find(item => item.id === condition.extensionId && item.point === 'condition');
  if (!d) throw new Error(`condition extension not found: ${condition.extensionId}`);
  return await runExtension(d, condition.params, state, options) as boolean;
}
export function recordExtensionError(state: AdventureState, issue: ExtensionIssue): void {
  const audit = state.extensionAudit ??= [];
  if (audit.length < 100) audit.push(issue);
}
export function assertExtensionWorldReferences(d: ExtensionDeclaration, world: WorldContent): void {
  for (const key of [...d.reads, ...d.writes.map(w => w.state)]) {
    if (key.startsWith('resource:') && !Object.hasOwn(world.resourceDefs ?? {}, key.slice(9)) && !Object.hasOwn(world.resources ?? {}, key.slice(9))) throw new Error(`undeclared world resource: ${key}`);
    if (key.startsWith('fact:') && !world.facts.some(f => f.id === key.slice(5))) throw new Error(`undeclared world fact: ${key}`);
  }
}
/** Async convenience API delegates to the same native applyEffects path. */
export async function executeExtensionEffect(effect: Extract<WorldEffect, {kind: 'extension'}>, declarations: ExtensionDeclaration[], state: AdventureState, options?: ExtensionRuntimeOptions,
  world?: WorldContent): Promise<ExtensionIssue | undefined> {
  await initializeExtensionSandbox();
  try {
    const d = declarations.find(item => item.id === effect.extensionId && item.point === 'effect');
    if (!d) throw new Error('effect extension not found');
    if (!world) throw new Error('world definitions required for effect writeback');
    assertExtensionWorldReferences(d, world);
    const result = runExtensionSync(d, effect.params, state, options);
    const {applyEffects} = await import('./rules.js');
    applyEffects(result.effects, state, world);
    if (result.randomCalls) { state.rng ??= {seed: options?.seed ?? 0, cursor: 0}; state.rng.cursor += result.randomCalls; }
    return undefined;
  } catch (error) { const issue = extensionIssue(effect.extensionId, error); recordExtensionError(state, issue); return issue; }
}
/** Publish-only policy: never tighten the schema used to read immutable revisions/saves. */
function publicationTestIssues(d: ExtensionDeclaration, world: WorldContent): ExtensionIssue[] {
  const issues: ExtensionIssue[] = [];
  const add = (code: string, message: string) => issues.push({severity: 'error', code, extensionId: d.id, message});
  try { assertExtensionWorldReferences(d, world); }
  catch (error) { add('extension.state-reference', messageOf(error)); }
  let boundary = false;
  for (const [index, test] of d.tests.entries()) {
    for (const [key, value] of Object.entries(test.input.state)) {
      // Parameter min/max and write delta caps are NOT state bounds. Only explicit test state counts.
      if (key.startsWith('resource:')) {
        const def = world.resourceDefs?.[key.slice(9)];
        if (!def) continue; // Legacy resources without definitions have no provable bounds.
        if (typeof value !== 'number' || value < def.min || (def.max !== undefined && value > def.max)) {
          add('extension.test-state-bounds', `test ${index + 1}: ${key} is outside world state bounds`);
        } else if (value === def.min || (def.max !== undefined && value === def.max)) boundary = true;
      } else if (key === 'elapsed') {
        if (typeof value !== 'number' || value < 0) add('extension.test-state-bounds', `test ${index + 1}: elapsed is below zero`);
        else if (value === 0) boundary = true;
      }
    }
  }
  if (!boundary) add('extension.test-boundary', 'at least one explicit numeric state input must equal its world min/max (or elapsed lower bound 0)');
  if (d.point === 'effect' && !d.tests.some(test => {
    const effects = validateOutput(d, test.expected);
    for (const effect of effects) {
      if (effect.kind === 'set') {
        if (test.input.state[`fact:${effect.factId}`] !== effect.value) return false;
      } else if (effect.delta !== 0) return false;
    }
    return true;
  })) add('extension.test-noop', 'effect needs an empty or state-preserving expected output');
  return issues;
}

/** With world supplied, enforce §9.2 before simulation; legacy runtime reads remain unchanged. */
export async function extensionTests(declaration: ExtensionDeclaration, world?: WorldContent): Promise<{passed: number; issues: ExtensionIssue[]}> {
  await initializeExtensionSandbox();
  const check = checkExtensionDeclaration(declaration);
  if (!check.ok) return {passed: 0, issues: check.issues};
  const d = extensionDeclarationSchema.parse(declaration);
  const issues: ExtensionIssue[] = world ? publicationTestIssues(d, world) : []; let passed = 0;
  for (const [index, test] of d.tests.entries()) {
    try {
      const resources: Record<string, number> = {}; const facts: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(test.input.state)) {
        if (key.startsWith('resource:')) resources[key.slice(9)] = value as number;
        if (key.startsWith('fact:')) facts[key.slice(5)] = value as boolean;
      }
      const fake = {resources, facts, elapsed: test.input.state.elapsed ?? 0, rng: {seed: test.input.seed, cursor: 0}} as AdventureState;
      const actual = runExtensionSync(d, test.input.params, fake).output;
      const canonical = (v: unknown): string => JSON.stringify(v, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
      if (canonical(actual) !== canonical(test.expected)) throw new Error('output differs from expected');
      passed++;
    } catch (error) { issues.push({severity: 'error', code: 'extension.test', extensionId: d.id, message: `test ${index + 1}: ${messageOf(error)}`}); }
  }
  return {passed, issues};
}
