import React, {useRef, type ReactNode} from 'react';
import {useI18n} from '../../lib/i18n';
import {StudioIcon} from './StudioIcon';

/** Inline disclosure: advanced tools take space only while the author needs them. */
export function EditorTools({children}: {children: ReactNode}) {
  const {t} = useI18n();
  const details = useRef<HTMLDetailsElement>(null);
  return <details className="workspace-editor-tools" ref={details} onKeyDown={event => {
    if (event.key === 'Escape' && details.current?.open) {event.preventDefault(); details.current.open = false; details.current.querySelector('summary')?.focus();}
  }}><summary>{t('更多工具')}<StudioIcon name="down" /></summary><div onClick={event => {
    if ((event.target as HTMLElement).closest('button') && details.current) details.current.open = false;
  }}>{children}</div></details>;
}
