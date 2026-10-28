import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { MediaReader, PlayerTemplateReader, WindowsPlayerBinary, WindowsPlayerReader } from '../application/ports.js';

const MIME: Record<string, string> = {
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif',
};

/** Reads images under DATA_DIR (e.g. `building-images/x.svg`); refuses paths that escape it. */
export class FsMediaReader implements MediaReader {
  constructor(private readonly dataDir: string) {}
  read(relativePath: string): { bytes: Uint8Array; mime: string } | null {
    const root = path.resolve(this.dataDir);
    const full = path.resolve(root, relativePath.replace(/^\/+/, ''));
    if (!full.startsWith(root + path.sep)) return null;
    const mime = MIME[path.extname(full).toLowerCase()];
    if (!mime) return null;
    try {
      if (!statSync(full).isFile()) return null;
      return { bytes: readFileSync(full), mime };
    } catch { return null; }
  }
}

/** Reads the prebuilt single-file player each time (rebuilding the player needs no server restart). */
export class FsPlayerTemplateReader implements PlayerTemplateReader {
  constructor(private readonly file: string) {}
  read(): string | null {
    return existsSync(this.file) ? readFileSync(this.file, 'utf8') : null;
  }
}

/**
 * `dist/player/btg-player-windows-x64.exe` (+ optional `btg-player-windows-x64.json` = `{ version, hostApiVersion }`
 * written by the player build). Read on each export so dropping the file in needs no restart.
 */
export class FsWindowsPlayerReader implements WindowsPlayerReader {
  constructor(private readonly file: string, private readonly displayRoot = process.cwd()) {}
  location(): string {
    const rel = path.relative(this.displayRoot, this.file);
    return (rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : this.file).split(path.sep).join('/');
  }
  read(): WindowsPlayerBinary | null {
    try {
      if (!statSync(this.file).isFile()) return null;
      const bytes = readFileSync(this.file);
      const info: WindowsPlayerBinary = { bytes };
      const sidecar = this.file.replace(/\.exe$/i, '') + '.json';
      if (existsSync(sidecar)) {
        try {
          const meta = JSON.parse(readFileSync(sidecar, 'utf8')) as { version?: unknown; hostApiVersion?: unknown };
          if (typeof meta.version === 'string') info.version = meta.version;
          if (typeof meta.hostApiVersion === 'number') info.hostApiVersion = meta.hostApiVersion;
        } catch { /* metadata is optional */ }
      }
      return info;
    } catch { return null; }
  }
}
