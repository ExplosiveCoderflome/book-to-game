import { useEffect, useState } from 'react';
import { request } from '../../lib/api';
import { useI18n } from '../../lib/i18n';

interface AgentDecisionView {
  id: string; jobId: string; action: string; summary: string; createdAt: string;
}
interface AgentStatusView {
  lastBeat: string | null; totalDecisions: number; alive: boolean;
}

const ACTION_LABEL: Record<string, string> = {
  retried: '自动重试',
  escalated: '已升级交人工',
  review_summary: '审阅检查',
  qa_report: '单元质检',
};

/** Tier A agent 动态：只展示监督决策，不批规划、不改写单元。 */
export function AgentFeed({token}: {token: string}) {
  const {t} = useI18n();
  const [status, setStatus] = useState<AgentStatusView | null>(null);
  const [decisions, setDecisions] = useState<AgentDecisionView[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [nextStatus, nextDecisions] = await Promise.all([
          request<AgentStatusView>(token, '/agent/status'),
          request<{decisions: AgentDecisionView[]}>(token, '/agent/decisions'),
        ]);
        if (!cancelled) { setStatus(nextStatus); setDecisions(nextDecisions.decisions); setError(null); }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载失败');
      }
    };
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [token]);
  return <div className="panel agent-feed" data-testid="agent-feed">
    <div className="panel-heading"><h3>{t('Agent 动态')}</h3>
      <span className="hint">{status ? (status.alive ? t('监督运行中') : t('监督未运行')) : t('加载中…')}</span>
    </div>
    {error ? <p className="hint">{error}</p> : null}
    {decisions.length
      ? <ul>{decisions.map(d => <li key={d.id}>
        <span>{t(ACTION_LABEL[d.action] ?? d.action)}</span> · {d.summary}
        <span className="hint"> {new Date(d.createdAt).toLocaleString()}</span>
      </li>)}</ul>
      : <p className="hint">{t('暂无 agent 决策。启动 agent 后，这里会显示重试、升级与质检记录。')}</p>}
  </div>;
}
