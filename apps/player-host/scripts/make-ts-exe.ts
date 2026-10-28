// Builds a fixture exe with the REAL TS exporter code (apps/server exe-trailer.ts) so the Rust core tests can
// prove both sides agree on the footer. Usage: tsx scripts/make-ts-exe.ts <in.html> <out.exe>
import { readFileSync, writeFileSync } from 'node:fs';
import { appendPayload } from '../../server/src/modules/exports/domain/exe-trailer.ts';

const [htmlPath, outPath] = process.argv.slice(2);
if (!htmlPath || !outPath) throw new Error('usage: make-ts-exe.ts <in.html> <out.exe>');
const fakePlayer = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, ...new TextEncoder().encode('mock btg-player for tests')]);
const { exe, payloadSha256 } = appendPayload(fakePlayer, readFileSync(htmlPath));
writeFileSync(outPath, exe);
console.log(`wrote ${outPath} (${exe.byteLength} bytes, payload sha256 ${payloadSha256})`);
