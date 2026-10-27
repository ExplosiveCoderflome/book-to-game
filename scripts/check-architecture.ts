import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { checkImports, type FileImports } from './architecture-rules.js';

function scan(directory: string): FileImports[] {
  return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const file = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) return scan(file);
    if (!/\.tsx?$/.test(file)) return [];
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const imports: string[] = [];
    const visit = (node: ts.Node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteral(argument)) imports.push(argument.text);
        else imports.push('UNRESOLVED_DYNAMIC_IMPORT');
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return [{file, imports}];
  });
}
const files = [...scan('apps/server/src'), ...scan('apps/web/src'), ...scan('packages')];
const errors = checkImports(files);
for (const file of files.filter(f => f.imports.includes('UNRESOLVED_DYNAMIC_IMPORT'))) errors.push(`${file.file}: 动态导入需使用可检查的常量路径`);
if (errors.length) {console.error(errors.join('\n')); process.exitCode = 1;}
else console.log(`Architecture OK: checked ${files.length} source files; core isolation, packages purity, module public APIs and cycles.`);
