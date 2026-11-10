import {createHash} from 'node:crypto';
import {BLOCKS, worldPackageSchema, WORLD_PACKAGE_FORMAT, WORLD_PACKAGE_SPEC, type WorldPackage, type WorldPackageManifest} from '@novel-game/contracts';
import {AppError} from '../../shared/errors.js';

type ObjectValue = Record<string, unknown>;
const STATE = new Set(['resources', 'resourceDefs', 'facts', 'clock', 'storyletRules', 'openingRoll', 'ledgerVersion']);
const ARRAYS = ['locations', 'storylets', 'endings', 'recap'] as const;
const SPECIAL = new Set(['blockSelections', 'extensions', 'checks']);
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_FILES = 512;
function invalid(message: string): never {throw new AppError('WORLD_PACKAGE_INVALID', message, 422);}
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('世界包片段必须是 JSON 对象');
  return value as ObjectValue;
}
function json(value: unknown): void {
  const active = new Set<object>();
  const visit = (v: unknown, depth = 0): void => {
    if (depth > 128) invalid('JSON 嵌套超过 128 层');
    if (v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return;
    if (!v || typeof v !== 'object' || active.has(v) || (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v)))) invalid('仅接受无循环、无缺项、有限数值的 JSON 数据');
    active.add(v);
    if (Array.isArray(v)) {for (let i = 0; i < v.length; i++) {if (!Object.hasOwn(v, i)) invalid('JSON 数组不能含空洞'); visit(v[i], depth + 1);}}
    else for (const x of Object.values(v)) visit(x, depth + 1);
    active.delete(v);
  };
  visit(value);
}
export function normalizeWorldJson(value: unknown): string {
  json(value);
  // JSON.stringify erases -0. Keep it so valid legacy numeric values roundtrip deeply too.
  const encode = (v: unknown): string => {
    if (Object.is(v, -0)) return '-0';
    if (Array.isArray(v)) return '[' + v.map(encode).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(key => JSON.stringify(key) + ':' + encode((v as ObjectValue)[key])).join(',') + '}';
    return JSON.stringify(v);
  };
  return encode(value);
}
function hash(text: string) {return createHash('sha256').update(text).digest('hex');}
/** A closed, portable relative-path grammar; never accept filesystem paths from package content. */
export function packagePath(name: string): string {
  if (name.length > 180 || name.includes('..') || name.includes('\\') || !/^(state\.json|checks\.json|content\/(?:locations|storylets|endings|recap|texts)(?:[a-zA-Z0-9_-]+)?\.json|blocks\/[a-zA-Z0-9_-]+\.json|ext\/[a-zA-Z0-9_-]+(?:\.ext\.json|\.js))$/.test(name)) invalid(`不支持或不安全的世界包路径：${name}`);
  return name;
}
function parse(text: string, name: string): unknown {
  try {return JSON.parse(text);} catch {invalid(`JSON 无法解析：${name}`);}
}
function put(target: ObjectValue, key: string, value: unknown) {
  if (Object.hasOwn(target, key)) invalid(`字段重复或片段相互覆盖：${key}`);
  Object.defineProperty(target, key, {value, enumerable: true, configurable: true, writable: true});
}
function numbered(index: number) {return index.toString().padStart(6, '0');}
function versions(value: unknown): WorldPackageManifest['blocks'] {
  if (!Array.isArray(value)) invalid('blockSelections 必须是数组');
  return value.map(item => {const v = object(item); return {blockId: v.blockId, version: v.version};}) as WorldPackageManifest['blocks'];
}
/** Legacy worlds gain a manifest of existing engine blocks without injecting selections into content. */
function inferredBlocks(world: ObjectValue): WorldPackageManifest['blocks'] {
  const ids = new Set<string>();
  if (Object.hasOwn(world, 'resourceDefs') || Object.hasOwn(world, 'resources')) ids.add('stat-templates');
  if (world.clock) ids.add('clock');
  if (world.storyletRules || (Array.isArray(world.storylets) && world.storylets.length)) ids.add('storylet-pool');
  if (Object.hasOwn(world, 'endings') || Object.hasOwn(world, 'recap')) ids.add('endings-recap');
  if (world.openingRoll) ids.add('opening-roll');
  if (Object.hasOwn(world, 'locations')) ids.add('state-snapshot');
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value)) {
      const row = value as ObjectValue;
      if (row.kind === 'roll') ids.add('encounters');
      if (['resource','resource_max','anyOf'].includes(String(row.kind))) ids.add('stat-templates');
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(world);
  if (Array.isArray(world.locations) && world.locations.some(location => object(location).textVariants !== undefined)) ids.add('world-map');
  return BLOCKS.filter(block => ids.has(block.id)).map(block => ({blockId:block.id,version:block.version}));
}
/** Does not schema-normalize the world: unknown/legacy fields and array order are intentionally retained. */
export function splitWorldPackage(input: unknown): WorldPackage {
  json(input); const world = object(input); const files: Record<string, string> = {};
  const state: ObjectValue = {}; const texts: ObjectValue = {};
  const collections: WorldPackageManifest['collections'] = [];
  for (const [key, value] of Object.entries(world)) {
    if (STATE.has(key)) put(state, key, value);
    else if ((ARRAYS as readonly string[]).includes(key)) {
      if (!Array.isArray(value)) invalid(`${key} 必须是数组`);
      files[`content/${key}.json`] = normalizeWorldJson(value);
    } else if (key === 'blockSelections') {
      collections.push(key); if (!Array.isArray(value)) invalid('blockSelections 必须是数组');
      value.forEach((entry, i) => {files[`blocks/${numbered(i)}.json`] = normalizeWorldJson(entry);});
    } else if (key === 'extensions') {
      collections.push(key); if (!Array.isArray(value)) invalid('extensions 必须是数组');
      value.forEach((entry, i) => {
        const {code, ...declaration} = object(entry); if (typeof code !== 'string') invalid('扩展 code 必须是字符串');
        files[`ext/${numbered(i)}.ext.json`] = normalizeWorldJson(declaration); files[`ext/${numbered(i)}.js`] = code;
      });
    } else if (key === 'checks') files['checks.json'] = normalizeWorldJson(value);
    else put(texts, key, value);
  }
  files['state.json'] = normalizeWorldJson(state); files['content/texts.json'] = normalizeWorldJson(texts);
  const explicit = Object.hasOwn(world, 'blockSelections');
  const manifest: WorldPackageManifest = {format: WORLD_PACKAGE_FORMAT, specVersion: WORLD_PACKAGE_SPEC, target: 'world-content-json', selectionMode: explicit ? 'explicit' : 'inferred',
    blocks: explicit ? versions(world.blockSelections) : inferredBlocks(world), collections,
    files: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, hash(text)]))};
  const packet = {manifest, files}; compileWorldPackage(packet); return packet;
}
/** Fresh hashes are generated at compilation so ordinary edits need no manual digest repair.
 * verifyHashes=true is for checking a frozen/archive package. Neither mode executes extension code.
 */
export function compileWorldPackage(input: unknown, options: {verifyHashes?: boolean; supportedBlockVersions?: Readonly<Record<string, number>>} = {}) {
  const checked = worldPackageSchema.safeParse(input); if (!checked.success) invalid('世界包 manifest/spec/files 结构无效或版本不支持');
  const {manifest, files} = checked.data; const names = Object.keys(files).sort();
  if (names.length > MAX_FILES || names.reduce((n, k) => n + Buffer.byteLength(k) + Buffer.byteLength(files[k]!), 0) > MAX_BYTES) invalid('世界包超过 512 文件或 16MiB 上限');
  if (!Object.hasOwn(files, 'state.json') || !names.some(name => name.startsWith('content/'))) invalid('世界包必须包含 state.json 和至少一个 content 文件');
  if (new Set(manifest.collections).size !== manifest.collections.length) invalid('collections 重复');
  if (normalizeWorldJson(names) !== normalizeWorldJson(Object.keys(manifest.files).sort())) invalid('manifest 文件清单必须与包内文件完全相同');
  const world: ObjectValue = {}; const arrays = new Map<string, unknown[]>(); const blocks: unknown[] = []; const extensions: unknown[] = [];
  for (const name of names) {
    packagePath(name); if (options.verifyHashes && hash(files[name]!) !== manifest.files[name]) invalid(`文件 hash 不匹配：${name}`);
    if (name.endsWith('.js')) continue;
    const data = parse(files[name]!, name);
    if (name === 'state.json' || /^content\/texts/.test(name)) {
      for (const [key, value] of Object.entries(object(data))) {
        if (name === 'state.json' ? !STATE.has(key) : STATE.has(key) || SPECIAL.has(key) || (ARRAYS as readonly string[]).includes(key)) invalid(`字段必须放在唯一正确片段：${key}`);
        put(world, key, value);
      }
    } else if (name === 'checks.json') put(world, 'checks', data);
    else if (name.startsWith('content/')) {
      const field = /^content\/(locations|storylets|endings|recap)/.exec(name)?.[1]; if (!field || !Array.isArray(data)) invalid(`内容片段必须是有类型的数组：${name}`);
      const current = arrays.get(field) ?? []; current.push(...data); arrays.set(field, current);
    } else if (name.startsWith('blocks/')) blocks.push(object(data));
    else if (name.endsWith('.ext.json')) {
      const codePath = name.replace(/\.ext\.json$/, '.js'); if (!Object.hasOwn(files, codePath)) invalid(`扩展代码缺失：${codePath}`);
      const declaration = object(data); if (Object.hasOwn(declaration, 'code')) invalid('扩展 code 只能来自对应 .js 文件');
      extensions.push({...declaration, code: files[codePath]});
    }
  }
  for (const name of names.filter(n => n.endsWith('.js'))) if (!Object.hasOwn(files, name.replace(/\.js$/, '.ext.json'))) invalid(`扩展声明缺失：${name}`);
  for (const [field, values] of arrays) put(world, field, values);
  for (const [field, values] of [['blockSelections', blocks], ['extensions', extensions]] as const) {
    if (values.length && !manifest.collections.includes(field)) invalid(`文件存在但 manifest 未声明：${field}`);
    if (manifest.collections.includes(field)) put(world, field, values);
  }
  // IDs are unique per entity type, not globally: a location and ending may share an id.
  for (const field of ['locations', 'storylets', 'endings', 'recap', 'facts', 'actions', 'events', 'npcs', 'extensions', 'blockSelections']) {
    const values = world[field]; if (!Array.isArray(values)) continue; const ids = new Set<string>();
    for (const value of values) {
      const row = object(value); const id = row[field === 'blockSelections' ? 'blockId' : 'id'];
      if (typeof id !== 'string' || !id) invalid(`${field} 条目缺少稳定 ID`);
      if (ids.has(id)) invalid(`${field} ID 冲突：${id}`); ids.add(id);
    }
  }
  json(world);
  const explicit = Object.hasOwn(world, 'blockSelections');
  if ((manifest.selectionMode === 'explicit') !== explicit) invalid('selectionMode 与 blocks 文件不一致');
  const selected = explicit ? versions(world.blockSelections) : inferredBlocks(world);
  if ((explicit || options.verifyHashes) && normalizeWorldJson(selected) !== normalizeWorldJson(manifest.blocks)) invalid('manifest 积木版本必须与 blocks 文件的声明及顺序一致');
  if (options.supportedBlockVersions) for (const block of selected) if (!Object.hasOwn(options.supportedBlockVersions, block.blockId) || options.supportedBlockVersions[block.blockId] !== block.version) invalid(`积木版本不支持：${block.blockId}@${block.version}`);
  const releaseManifest = {...manifest, blocks: selected, files: Object.fromEntries(names.map(name => [name, hash(files[name]!)]))};
  const worldJson = normalizeWorldJson(world);
  return {world: JSON.parse(worldJson) as Record<string, unknown>, worldJson, manifest: releaseManifest, contentHash: hash(worldJson)};
}
/** Legacy JSON imports automatically become editable packages; never modify the source. */
export function importWorldPackage(input: unknown): WorldPackage {
  return input && typeof input === 'object' && Object.hasOwn(input, 'manifest') && Object.hasOwn(input, 'files')
    ? (compileWorldPackage(input), worldPackageSchema.parse(input)) : splitWorldPackage(input);
}
