import { forwardRef, memo, useEffect, useImperativeHandle, useRef } from 'react';
import type { HexRendererHandle, HexRendererProps } from './renderer';
import { HexPixiScene } from './pixi-scene';

/** Default WebGL renderer (PixiJS v8 + pixi-viewport). React only forwards state; the scene diffs it. */
export const PixiHexRenderer = memo(forwardRef<HexRendererHandle, HexRendererProps>(function PixiHexRenderer({ state, view }, ref) {
  const host = useRef<HTMLDivElement | null>(null);
  const scene = useRef<HexPixiScene | null>(null);
  const initialView = useRef(view);
  useImperativeHandle(ref, () => ({ applyView(v) { initialView.current = v; scene.current?.applyView(v); } }), []);
  useEffect(() => {
    const el = host.current; if (!el) return;
    const s = new HexPixiScene(); scene.current = s;
    s.applyView(initialView.current);
    void s.init(el).catch(err => console.error('pixi init failed', err));
    return () => { s.destroy(); if (scene.current === s) scene.current = null; };
  }, []);
  useEffect(() => { scene.current?.update(state); }, [state]);
  return <div ref={host} className="world-map-pixi" data-renderer="pixi" style={{ position: 'absolute', inset: 0 }} />;
}));
