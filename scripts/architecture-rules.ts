import path from 'node:path';
export interface FileImports {file: string; imports: string[]}
export function checkImports(files: FileImports[]): string[] {
  const errors: string[] = [];
  const edges = new Map<string, Set<string>>();
  const moduleOf = (file: string) => file.match(/\/modules\/([^/]+)\//)?.[1];
  for (const entry of files) {
    const file = entry.file.replaceAll('\\', '/');
    const own = moduleOf(file);
    for (const specifier of entry.imports) {
      const target = specifier.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)) : specifier;
      if (/\/modules\/[^/]+\/(domain|application)\//.test(file) &&
        (/^(express(?:\/|$)|better-sqlite3$|@modelcontextprotocol\/|node:(fs|http|https|net)(\/|$))/.test(specifier) ||
          /\/(infrastructure|platform|adapters)\//.test(target))) errors.push(`${file}: 核心层禁止依赖 ${specifier}`);
      const other = moduleOf(target);
      if (own && other && own !== other) {
        if (!/\/index\.(js|ts)$/.test(target)) errors.push(`${file}: 禁止引用模块 ${other} 内部 ${specifier}`);
        if (!edges.has(own)) edges.set(own, new Set());
        edges.get(own)!.add(other);
      }
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
