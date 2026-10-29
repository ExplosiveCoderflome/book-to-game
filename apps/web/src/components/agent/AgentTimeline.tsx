import React from 'react';
import type { AgentChatAction, AgentChatConversation, AgentChatMessage } from '@novel-game/contracts';
import { useI18n } from '../../lib/i18n';
import { StudioIcon } from '../studio/StudioIcon';
import { AgentMessageBody } from './AgentMessageBody';
import { actionStatusLabels, splitUserContext, toolLabel, toolReceipt } from './agent-presenter';

function ActionCard({action, running, onDecide}: {action: AgentChatAction; running: boolean; onDecide: (id: string, decision: 'confirm' | 'reject') => void}) {
  const {t} = useI18n();
  return <article className={`agent-approval is-${action.status}`} aria-label={t('操作审阅')}>
    <div className="agent-approval-heading"><StudioIcon name={action.status === 'succeeded' ? 'check' : 'shield'} /><strong>{t(actionStatusLabels[action.status])}</strong><span>{t(toolLabel(action.toolName))}</span></div>
    <p>{action.summary}</p>
    <details><summary>{t('查看具体操作参数')}</summary><pre>{JSON.stringify(action.arguments, null, 2)}</pre></details>
    {action.result && <details><summary>{t('执行结果')}</summary><pre>{action.result}</pre></details>}
    {action.status === 'uncertain' && <p className="agent-error-copy">{t('请先查询实际业务状态，此操作不会自动重复执行。')}</p>}
    {action.status === 'pending' && <div className="agent-approval-actions"><span>{t('确认后才会执行')}</span><button className="quiet" disabled={running} onClick={() => onDecide(action.id, 'reject')}>{t('拒绝')}</button><button className="primary" disabled={running} onClick={() => onDecide(action.id, 'confirm')}><StudioIcon name="check" />{t('确认执行')}</button></div>}
  </article>;
}

function Receipt({message}: {message: AgentChatMessage}) {
  const {t} = useI18n(); const receipt = toolReceipt(message, t);
  return <details className={`agent-tool-receipt is-${receipt.status}`}>
    <summary><StudioIcon name={receipt.status === 'complete' ? 'check' : receipt.status === 'pending' ? 'shield' : 'file'} /><span>{t(toolLabel(message.toolName ?? ''))}</span><small>{t(receipt.summary)}</small><StudioIcon name="chevron" /></summary>
    <pre>{message.content}</pre>
  </details>;
}

export function AgentTimeline({conversation, running, onDecide}: {conversation: AgentChatConversation; running: boolean; onDecide: (id: string, decision: 'confirm' | 'reject') => void}) {
  const {t} = useI18n();
  return <div className="agent-timeline">{conversation.messages.filter(m => m.role !== 'tool').map(message => {
    const calls = message.toolCalls ?? [];
    const isUser = message.role === 'user';
    const {context, text} = isUser ? splitUserContext(message.content) : {context: null, text: message.content};
    return <div key={message.id} className={`agent-turn ${isUser ? 'is-user' : 'is-assistant'} ${!isUser && !text && calls.length ? 'is-tool-turn' : ''}`}>
      {!isUser && <div className="agent-speaker"><span className="agent-avatar"><StudioIcon name="branch" /></span><strong>{t('故事工坊')}</strong><span>Agent</span></div>}
      {isUser ? <article className="agent-user-message">{context && <details className="agent-message-context"><summary><StudioIcon name="world" />{t('附带草稿上下文')}</summary><small>{context}</small></details>}<p>{text}</p></article> : text && <AgentMessageBody text={text} />}
      {calls.length > 0 && <div className="agent-tool-group">{calls.map(call => {
        const action = conversation.actions.find(a => a.callId === call.id);
        const receipt = conversation.messages.find(m => m.role === 'tool' && m.toolCallId === call.id);
        return action ? <ActionCard key={call.id} action={action} running={running} onDecide={onDecide} />
          : receipt ? <Receipt key={call.id} message={receipt} /> : <p className="agent-tool-working" key={call.id}><span className="agent-working-dot" />{t(toolLabel(call.name))}</p>;
      })}</div>}
    </div>;
  })}</div>;
}
