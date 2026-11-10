import {readWorldPackage, writeWorldPackage, writeCompiledWorld} from '../apps/server/src/modules/world-package/index.js';

const [command, input, output, ...rest] = process.argv.slice(2);
if (!['split', 'compile'].includes(command ?? '') || !input || !output || rest.length) {
  console.error('Usage: npm run world:pack -- <split|compile> <input.json|package-directory> <new-output-directory>');
  process.exitCode = 2;
} else {
  try {
    const packet = readWorldPackage(input);
    if (command === 'split') writeWorldPackage(output, packet); else writeCompiledWorld(output, packet);
    console.log(`World package ${command}: ${Object.keys(packet.files).length} source files; no model calls`);
  } catch (error) {console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;}
}
