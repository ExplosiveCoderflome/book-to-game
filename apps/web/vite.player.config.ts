import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const stub = fileURLToPath(new URL('./src/package/stubs/no-ai-aux.tsx', import.meta.url));
const offlineApi = fileURLToPath(new URL('./src/package/stubs/offline-api.ts', import.meta.url));

/** Swap AI auxiliaries and the HTTP client for offline stubs in the export player. */
function noAiAux(): Plugin {
  return {
    name: 'btg-no-ai-aux',
    enforce: 'pre',
    resolveId(source, importer) {
      if (importer?.includes('node_modules')) return null;
      if (/(^|\/)(NarrateBox|ProposeActBox|TiandaoToggle)(\.tsx)?$/.test(source)) return stub;
      // No fetch to the workbench service in the package (zero network requests, slice §7.2).
      if (/(^|\/)lib\/api$|^\.\/api$/.test(source)) return offlineApi;
      return null;
    },
  };
}

/**
 * M1b-1 export player: one HTML entry, one JS chunk, one CSS file; `scripts/inline-player.mjs`
 * folds them into `dist-player/btg-player-template.html` (the server only fills two script slots).
 */
export default defineConfig({
  plugins: [noAiAux(), react()],
  base: './',
  build: {
    outDir: 'dist-player/build',
    emptyOutDir: true,
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    sourcemap: false,
    rollupOptions: {
      input: fileURLToPath(new URL('./package.html', import.meta.url)),
      output: { inlineDynamicImports: true },
    },
  },
});
