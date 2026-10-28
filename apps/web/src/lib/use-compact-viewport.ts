import { useEffect, useState } from 'react';

/** Phone-width player (≤760px, same breakpoint as the player CSS). Desktop / exe / jsdom without matchMedia → false. */
export const COMPACT_QUERY = '(max-width: 760px)';

function matchCompact(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(COMPACT_QUERY).matches;
}

export function useCompactViewport(): boolean {
  const [compact, setCompact] = useState(matchCompact);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(COMPACT_QUERY);
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);
  return compact;
}
