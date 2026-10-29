import React, { useContext, type ReactNode } from 'react';
import { useI18n } from '../../lib/i18n';
import { WorkspaceAssist } from '../../lib/workspace-assist';
import { StudioIcon } from './StudioIcon';

/** The same orientation and agent handoff on every specialist surface. */
export function WorkspaceHeader({title, description, topic = title, children}: {
  title: string; description: string; topic?: string; children?: ReactNode;
}) {
  const {t} = useI18n();
  const assist = useContext(WorkspaceAssist);
  return <header className="workspace-page-header">
    <div><h1>{t(title)}</h1><p>{t(description)}</p></div>
    <div className="workspace-page-actions">{children}{assist && <button type="button" className="workspace-assist" onClick={() => assist(topic)}>
      <StudioIcon name="chat" />{t('与 Agent 讨论')}<StudioIcon name="arrow" />
    </button>}</div>
  </header>;
}
