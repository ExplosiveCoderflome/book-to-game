import type { ReactNode } from 'react';
import type { SaveLocation } from '@novel-game/play-runtime';

/** Export-package chrome for the shared player pages (UI plan §3.3–3.6; M1b-2 §3.4/§5.4). Absent ⇒ M1 `/play` chrome. */
export type PackageChrome = {
  /** `#/` (no save) or `#/save/<id>`. */
  hash: (saveId?: string) => string;
  /** 「本局不会保存。」 when nothing can persist; else the normal autosave line (also in host-fallback: it IS saved). */
  autosaveHint: string;
  /** Bumped when storage status changes so rows re-read 「未保存」/「临时位置」. */
  storageEpoch: number;
  /** Where new saves go: browser (HTML) / host-file / host-fallback (exe). Copy never says 「浏览器」 in the exe. */
  where: SaveLocation;
  /** Aside hint under the saves list. */
  footHint: string;
  /** exe host-file only: 「存档位置」 details with the %APPDATA% path. */
  locationDetails?: ReactNode;
  /** Article empty state when there are no saves at all. */
  emptyNoSaves: string;
};
