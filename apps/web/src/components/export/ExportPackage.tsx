import { useEffect, useRef, useState, type ReactNode } from 'react';
import { request, RequestError } from '../../lib/api';
import { markExeMissing, useExeAvailability } from '../../lib/export-targets';
import {
  classifyExportError, exportHint, exportScopeKey, formatSize, groupDegraded, reportFileBytes, reportMime, stateForScope,
  type ExportFailure, type ExportReportView, type ScopedExportState,
} from '../../lib/export-report';
import { useI18n } from '../../lib/i18n';

type Revision = { id: string; version: number } | null;
type Target = 'html' | 'windows-exe';
type State =
  | { phase: 'idle' }
  | { phase: 'exporting'; target: Target }
  | { phase: 'done'; report: ExportReportView; url: string | null }
  | { phase: 'unavailable'; playerPath?: string }
  | { phase: 'failed'; failure: ExportFailure };

function download(url: string, fileName: string) {
  const a = document.createElement('a');
  a.href = url; a.download = fileName; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
}

/**
 * Author export entry (UI plan M1b-1 §3.1/§3.2, M1b-2 §3.1/§3.2/§4.2): two quiet buttons in the editor
 * footer — 「导出可玩包（网页版）」 then 「导出 Windows 版」 — one shared hint span and one report strip.
 * Exports the PUBLISHED revision only. ONE request in flight per panel for both targets (X6).
 * Both files come back through the same JSON report channel (X7) and download as a Blob.
 */
export function useExportPackage({ token, kind, draftId, revision, dirty, disabled }: {
  token: string; kind: 'game' | 'world'; draftId: string | null | undefined; revision: Revision; dirty: boolean; disabled?: boolean;
}): { button: ReactNode; buttons: { html: ReactNode; exe: ReactNode }; hint: ReactNode; report: ReactNode } {
  const { t, locale } = useI18n();
  // The strip is keyed by draft + published revision: switching draft/world (or re-publishing) never shows the previous one's report.
  const scope = exportScopeKey(kind, draftId, revision?.id);
  const [stored, setStored] = useState<ScopedExportState<State> | null>(null);
  const state: State = stateForScope(stored, scope) ?? { phase: 'idle' };
  const setState = (value: State, forScope = scope) => setStored({ scope: forScope, value });
  const inFlight = useRef(false);
  const hintId = `export-hint-${kind}`;
  // Global (not per scope): the player binary has nothing to do with which draft is open.
  const exe = useExeAvailability(token);

  useEffect(() => () => { if (stored?.value.phase === 'done' && stored.value.url) URL.revokeObjectURL(stored.value.url); }, [stored]);

  async function run(target: Target) {
    if (!revision || inFlight.current) return;
    const runScope = scope;
    inFlight.current = true;
    setState({ phase: 'exporting', target }, runScope);
    try {
      const report = await request<ExportReportView>(token, '/exports/play-package', 'POST',
        { kind, revisionId: revision.id, target, locale }, { signal: AbortSignal.timeout(120_000) });
      const url = URL.createObjectURL(new Blob([reportFileBytes(report) as BlobPart], { type: reportMime(report) }));
      download(url, report.fileName);
      setState({ phase: 'done', report, url }, runScope);
    } catch (e) {
      const failure: ExportFailure = e instanceof RequestError ? classifyExportError(e.code, e.details) : { kind: 'other' };
      if (failure.kind === 'target-unavailable') {
        markExeMissing();
        setState({ phase: 'unavailable', playerPath: failure.playerPath }, runScope);
      } else setState({ phase: 'failed', failure }, runScope);
    } finally { inFlight.current = false; }
  }

  const exporting = state.phase === 'exporting' ? state.target : null;
  const lock = !revision || !!exporting || disabled;
  const htmlButton = (
    <button
      type="button"
      className="quiet"
      data-testid={`export-package-${kind}`}
      disabled={lock}
      aria-busy={exporting === 'html' || undefined}
      aria-describedby={hintId}
      title={t('生成一个 .html 文件，对方双击即可离线游玩')}
      onClick={() => void run('html')}
    >
      {exporting === 'html' ? t('正在打包…') : t('导出可玩包（网页版）')}
    </button>
  );
  const exeButton = (
    <button
      type="button"
      className="quiet"
      data-testid={`export-exe-${kind}`}
      data-availability={exe}
      disabled={lock || exe === 'missing'}
      aria-busy={exporting === 'windows-exe' || undefined}
      aria-describedby={hintId}
      title={t('生成一个 .exe 文件，对方在 Windows 10/11 上双击即可离线游玩')}
      onClick={() => void run('windows-exe')}
    >
      {exporting === 'windows-exe' ? t('正在打包…') : t('导出 Windows 版')}
    </button>
  );
  const hint = (
    <span className="hint" id={hintId} data-testid={`export-hint-${kind}`}>
      {!revision ? t('先发布再导出') : exportHint([
        dirty && t('导出的是已发布 v{version}', { version: revision.version }),
        exe === 'missing' && t('Windows 播放器未就绪，网页版可正常导出'),
      ])}
    </span>
  );
  const button = <><span className="export-actions">{htmlButton}{exeButton}</span>{hint}</>;

  let report: ReactNode = null;
  if (state.phase === 'exporting') {
    report = (
      <div className="export-report busy" role="status" data-testid="export-report-busy" data-target={state.target}>
        <p>{state.target === 'windows-exe'
          ? t('正在打包：校验版本 → 冻结目录 → 内联图片 → 生成网页 → 装入 Windows 播放器')
          : t('正在打包：校验版本 → 冻结目录 → 内联图片 → 生成文件')}</p>
      </div>
    );
  } else if (state.phase === 'done') {
    const r = state.report;
    const groups = groupDegraded(r.degraded);
    const isExe = r.target === 'windows-exe';
    const playerLine = isExe && r.player && (r.player.version || r.player.hostApiVersion !== undefined)
      ? [r.player.version && t('播放器 {version}', { version: r.player.version }),
        r.player.hostApiVersion !== undefined && t('宿主接口 v{hostApiVersion}', { hostApiVersion: r.player.hostApiVersion })].filter(Boolean).join(' · ')
      : '';
    report = (
      <div className="export-report ok" role="status" data-testid="export-report" data-target={r.target ?? 'html'} data-payload-sha256={r.payloadSha256}>
        <div className="export-report-row">
          <p>
            <strong>{t('已导出')}</strong>
            {' · '}{formatSize(r.size)}
            {' · '}{r.mode === 'open' ? t('开放世界') : t('分支故事')}
            {' · '}<span title={t('之后修改草稿、建筑库或物品目录，都不会影响这个文件。')}>{r.mode === 'open' ? t('按导出时目录冻结') : t('按导出时版本冻结')}</span>
            {isExe && t(' · Windows 版')}
            {r.degraded.length > 0 && t(' · 降级 {count} 项', { count: r.degraded.length })}
          </p>
          <span className="export-report-actions">
            {state.url && <button type="button" className="quiet small" onClick={() => download(state.url!, r.fileName)}>{t('重新下载')}</button>}
            <button type="button" className="quiet small" aria-label={t('关闭')} onClick={() => setState({ phase: 'idle' })}>×</button>
          </span>
        </div>
        <p className="mono export-file">{r.fileName}</p>
        {playerLine && <p className="mono export-player" data-testid="export-player-line">{playerLine}</p>}
        {isExe && <ExportSmartScreenNote />}
        {groups.map(g => (
          <details key={g.kind} className="export-degraded" open>
            <summary>{g.kind === 'image'
              ? t('{count} 张图片未找到，包内不显示（不影响玩法）', { count: g.items.length })
              : t('{count} 项内容未能打包，包内不显示（不影响玩法）', { count: g.items.length })}</summary>
            <ul>{g.items.map((d, i) => <li key={i}>{d}</li>)}</ul>
          </details>
        ))}
      </div>
    );
  } else if (state.phase === 'unavailable') {
    report = (
      <div className="export-report unavailable" role="status" data-testid="export-report-unavailable">
        <div className="export-report-row">
          <p>{t('Windows 播放器未就绪，未生成文件。网页版可正常导出。')}</p>
          <span className="export-report-actions">
            <button type="button" className="quiet small" aria-label={t('关闭')} onClick={() => setState({ phase: 'idle' })}>×</button>
          </span>
        </div>
        {state.playerPath && <p className="mono export-player">{t('需要文件：{path}', { path: state.playerPath })}</p>}
      </div>
    );
  } else if (state.phase === 'failed') {
    report = <ExportFailureStrip failure={state.failure} onClose={() => setState({ phase: 'idle' })} />;
  }
  return { button, buttons: { html: htmlButton, exe: exeButton }, hint, report };
}

/** Known first-launch behaviour of an unsigned exe (slice §2.4.4, X1). Plain ink text: not a warning. */
function ExportSmartScreenNote() {
  const { t } = useI18n();
  return (
    <p className="export-smartscreen" data-testid="export-smartscreen">
      {t('未签名：对方第一次打开时，Windows 可能提示「Windows 已保护你的电脑」，点「更多信息」→「仍要运行」即可。需要 Windows 10 或 11（64 位）。')}
    </p>
  );
}

function ExportFailureStrip({ failure, onClose }: { failure: ExportFailure; onClose: () => void }) {
  const { t } = useI18n();
  let title: string; const lines: string[] = []; let fix: string;
  switch (failure.kind) {
    case 'not-published':
      title = '导出失败 · 版本不存在或未发布，未生成文件'; fix = '请先发布，再导出。'; break;
    case 'invalid':
      title = '导出失败 · 内容校验未通过，未生成文件'; lines.push(...failure.issues); fix = '请在草稿里修复并重新发布。'; break;
    case 'too-large':
      title = '导出失败 · 包体超过上限，未生成文件';
      if (failure.size !== undefined && failure.limit !== undefined) lines.push(t('本次 {size} · 上限 {limit}', { size: formatSize(failure.size), limit: formatSize(failure.limit) }));
      fix = '可减少或压缩图片后重新发布，再导出。'; break;
    case 'secret':
      title = '导出失败 · 检测到密钥，已中止，未生成文件';
      if (failure.locations.length) lines.push(t('出现在：{location}', { location: failure.locations.join('、') }));
      fix = '请删除内容中的 API Key 或口令后重新发布。'; break;
    case 'unsupported':
      title = '导出失败 · 有内容引用已失效，未生成文件';
      lines.push(...failure.items.map(i => i.kind === 'shelf-item' ? t('货架引用的「{label}」已不存在', { label: i.label })
        : i.kind === 'quest-item' ? t('任务槽引用的「{label}」已不存在', { label: i.label })
        : i.kind === 'building-asset' ? t('地点引用的建筑「{label}」已不在建筑库', { label: i.label })
        : t('{label}：暂不支持导出', { label: i.label })));
      fix = '请修复后重新发布，再导出。'; break;
    default:
      title = '导出未完成，未生成文件。'; fix = '请重试。';
  }
  return (
    <div className="export-report failed" role="alert" data-testid="export-report-failed" data-failure={failure.kind}>
      <div className="export-report-row">
        <p><strong>{t(title)}</strong></p>
        <span className="export-report-actions">
          <button type="button" className="quiet small" aria-label={t('关闭')} onClick={onClose}>×</button>
        </span>
      </div>
      {lines.length > 0 && <ul>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
      <p className="hint">{t(fix)}</p>
    </div>
  );
}
