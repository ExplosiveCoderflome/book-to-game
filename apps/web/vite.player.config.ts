import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const stub = fileURLToPath(new URL('./src/package/stubs/no-ai-aux.tsx', import.meta.url));
const offlineApi = fileURLToPath(new URL('./src/package/stubs/offline-api.ts', import.meta.url));
const svgOnlyHexRenderer = fileURLToPath(new URL('./src/package/stubs/svg-only-hex-renderer.tsx', import.meta.url));
const noHexMapEditor = fileURLToPath(new URL('./src/package/stubs/no-hex-map-editor.tsx', import.meta.url));

/** Swap AI auxiliaries and the HTTP client for offline stubs in the export player. */
function noAiAux(): Plugin {
  return {
    name: 'btg-no-ai-aux',
    enforce: 'pre',
    resolveId(source, importer) {
      if (importer?.includes('node_modules')) return null;
      if (/(^|\/)(NarrateBox|ProposeActBox|TiandaoToggle)(\.tsx)?$/.test(source)) return stub;
      if (/(^|\/)hex\/PixiHexRenderer(\.tsx)?$/.test(source)) return svgOnlyHexRenderer;
      if (/(^|\/)HexMapEditor(\.tsx)?$/.test(source)) return noHexMapEditor;
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
  define: { 'import.meta.env.BTG_PLAYER': 'true' },
  base: './',
  build: {
    outDir: 'dist-player/build',
    emptyOutDir: true,
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    sourcemap: false,
    // This export is intentionally one offline HTML file, so the single JS chunk is
    // expected to exceed Vite's default warning limit.
    chunkSizeWarningLimit: 1600,
    rolldownOptions: {
      input: fileURLToPath(new URL('./package.html', import.meta.url)),
      output: { codeSplitting: false },
    },
  },
});
