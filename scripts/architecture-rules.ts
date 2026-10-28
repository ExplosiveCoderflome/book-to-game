import path from 'node:path';
export interface FileImports {file: string; imports: string[]}
export function checkImports(files: FileImports[]): string[] {
  const errors: string[] = [];
  const edges = new Map<string, Set<string>>();
  const moduleOf = (file: string) => file.match(/\/modules\/([^/]+)\//)?.[1];
  const isCompositionRoot = (file: string) =>
    /\/apps\/server\/src\/(app|adapters)\//.test(`/${file}`)
    || file.startsWith('apps/server/src/app/')
    || file.startsWith('apps/server/src/adapters/');
  const packageFramework = /^(express(?:\/|$)|react(?:\/|$)|react-dom(?:\/|$)|better-sqlite3$|@modelcontextprotocol\/|node:(sqlite|fs|http|https|net)(\/|$))/;
  for (const entry of files) {
    const file = entry.file.replaceAll('\\', '/');
    const own = moduleOf(file);
    for (const specifier of entry.imports) {
      const target = specifier.startsWith('.')
        ? path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))
        : specifier;
      if (/\/modules\/[^/]+\/(domain|application)\//.test(file) &&
        (/^(express(?:\/|$)|better-sqlite3$|@modelcontextprotocol\/|node:(sqlite|fs|http|https|net)(\/|$))/.test(specifier) ||
          /\/(infrastructure|platform|adapters)\//.test(target))) errors.push(`${file}: 核心层禁止依赖 ${specifier}`);
      // Shared packages stay pure: no React / Express / SQL / MCP.
      if (file.startsWith('packages/') && packageFramework.test(specifier)) {
        errors.push(`${file}: packages 禁止依赖 ${specifier}`);
      }
      // contracts = schema/DTO only; must not depend on rules engines.
      if (file.startsWith('packages/contracts/') && (specifier === '@novel-game/rules' || /packages\/rules\//.test(target))) {
        errors.push(`${file}: contracts 禁止依赖 rules（schema 不得反向依赖求值引擎）`);
      }
      // play-runtime ships inside the offline HTML package: browser-safe, no node:* at all.
      if (file.startsWith('packages/play-runtime/') && /^node:/.test(specifier)) {
        errors.push(`${file}: play-runtime 禁止依赖 ${specifier}（需在离线包浏览器内运行）`);
      }
      // Layering: contracts/rules sit below the play engine.
      if ((file.startsWith('packages/contracts/') || file.startsWith('packages/rules/'))
        && (specifier === '@novel-game/play-runtime' || /packages\/play-runtime\//.test(target))) {
        errors.push(`${file}: contracts/rules 禁止反向依赖 play-runtime`);
      }
      const other = moduleOf(target);
      if (own && other && own !== other) {
        if (!/\/index\.(js|ts)$/.test(target)) errors.push(`${file}: 禁止引用模块 ${other} 内部 ${specifier}`);
        if (!edges.has(own)) edges.set(own, new Set());
        edges.get(own)!.add(other);
      }
      // Composition root (app commands / HTTP·MCP adapters) may only use module public index.
      if (isCompositionRoot(file) && /\/modules\/[^/]+\//.test(target) && !/\/modules\/[^/]+\/index\.(js|ts)$/.test(target)) {
        errors.push(`${file}: 组合根禁止深引用模块内部 ${specifier}`);
      }
      // Map-kind plugins: outside code goes through map-kinds/index only; kinds never reach back into app panels.
      const MK = 'apps/web/src/components/map-kinds/';
      if (target.startsWith(MK) && !file.startsWith(MK) && !/^apps\/web\/src\/components\/map-kinds\/index(\.tsx?)?$/.test(target)) errors.push(`${file}: 地图类型插件仅可经 map-kinds/index 引用，禁止 ${specifier}`);
      if (file.startsWith(MK) && /^apps\/web\/src\/(components\/[A-Z][^/]*Panel|App)(\.tsx?)?$/.test(target)) errors.push(`${file}: 地图类型插件禁止依赖应用面板 ${specifier}`);
      if (file.startsWith('apps/web/') && target.startsWith('apps/server/')) errors.push(`${file}: 前端不可引用服务端实现`);
    }
  }
  const visit = (node: string, stack: string[], done: Set<string>) => {
    if (stack.includes(node)) {errors.push(`模块循环依赖: ${[...stack, node].join(' → ')}`); return;}
    if (done.has(node)) return;
    for (const next of edges.get(node) ?? []) visit(next, [...stack, node], done);
    done.add(node);
  };
  const done = new Set<string>();
  for (const node of edges.keys()) visit(node, [], done);
  return errors;
}
