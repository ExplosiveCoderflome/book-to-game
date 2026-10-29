import React, { type CSSProperties } from 'react';

const paths = {
  chat: 'M4 4h16v12H9l-5 4V4Z', book: 'M12 5C8 2 3 4 3 4v15s5-2 9 1m0-15c4-3 9-1 9-1v15s-5-2-9 1V5Z',
  tasks: 'm3 6 2 2 4-4m3 2h9M3 13l2 2 4-4m3 2h9M3 20l2 2 4-4m3 2h9',
  world: 'M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16',
  grid: 'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z',
  file: 'M5 3h10l4 4v14H5V3Zm10 0v5h4M8 12h8m-8 4h6',
  play: 'm8 4 12 8-12 8V4Z', settings: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  plus: 'M12 5v14M5 12h14', arrow: 'M5 12h14m-6-6 6 6-6 6', up: 'M12 19V5m-6 6 6-6 6 6',
  chevron: 'm9 5 7 7-7 7', down: 'm5 9 7 7 7-7', menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'm6 6 12 12M6 18 18 6', check: 'm5 12 4 4L19 6', refresh: 'M20 7v5h-5M4 17v-5h5m10-5a8 8 0 0 0-14 0m0 10a8 8 0 0 0 14 0',
  history: 'M3 10a9 9 0 1 1 1 7M3 4v6h6m3-3v6l4 2', panel: 'M3 4h18v16H3V4Zm12 0v16',
  search: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 6 6',
  branch: 'M6 3v13a4 4 0 0 0 4 4h8M6 10h8a4 4 0 0 0 4-4V3',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6',
} as const;
export type StudioIconName = keyof typeof paths;
export function StudioIcon({name, className = '', style}: {name: StudioIconName; className?: string; style?: CSSProperties}) {
  return <svg className={`studio-icon ${className}`} style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
