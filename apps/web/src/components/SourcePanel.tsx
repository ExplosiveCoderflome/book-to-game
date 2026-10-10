import { useI18n } from '../lib/i18n';
import { useEffect, useState } from 'react';
import type { GameRevision, SourceDocument, SourceSummary } from '@novel-game/contracts';
import { errorMessage, fileBase64, request } from '../lib/api';
import { Empty, Notice, dateLabel } from './Notice';
import { seedDemo } from '../lib/demo';

interface Props {
  token: string; sources: SourceSummary[]; selectedId: string; select: (id: string) => void;
  refresh: () => Promise<void>; onGenerate: () => void; revisions: GameRevision[]; onDemoReady: (revision: GameRevision) => void;
}

export function SourcePanel({ token, sources, revisions, selectedId, select, refresh, onGenerate, onDemoReady }: Props) {
  const { t, locale } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [encoding, setEncoding] = useState('auto');
  const [document, setDocument] = useState<SourceDocument | null>(null);
  const [chapterId, setChapterId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setDocument(null); setError(null);
    if (!selectedId) return;
    setLoading(true);
    request<SourceDocument>(token, `/sources/${selectedId}`).then(value => {
      if (active) { setDocument(value); setChapterId(value.chapters[0]?.id ?? ''); }
    }).catch(e => { if (active) setError(errorMessage(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, selectedId]);
  async function importSource(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const imported = await request<SourceDocument>(token, '/sources', 'POST', {
        title: title.trim() || file.name.replace(/\.[^.]+$/, ''), filename: file.name,
        contentBase64: await fileBase64(file), ...(encoding !== 'auto' ? { encoding } : {}),
      });
      await refresh(); select(imported.id);
      setFile(null); setTitle(''); setFileInputKey(value => value + 1);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function loadDemo() {
    setDemoBusy(true); setError(null);
    try { const revision = await seedDemo(token, sources, revisions); await refresh(); onDemoReady(revision); }
    catch (e) { setError(errorMessage(e)); }
    finally { setDemoBusy(false); }
  }
  const chapter = document?.chapters.find(c => c.id === chapterId);
  return <section className="work-section">
    <div className="section-heading"><div><p className="eyebrow">{t("01 / 原作书架")}</p><h2>{t("让故事从原文开始")}</h2><p>{t("导入小说，核对章节，再为这次改编选择方向。")}</p></div><span className="edition">SOURCE MATERIAL</span></div>
    <Notice text={error} />
    <div className="source-layout">
      <aside className="panel shelf">
        <form onSubmit={importSource} className="stack">
          <h3>{t("导入原作")}</h3><label>{t("小说文件")}<input key={fileInputKey} type="file" accept=".txt,.json,text/plain,application/json" disabled={busy} onChange={e => { const chosen = e.target.files?.[0] ?? null; setFile(chosen); if (chosen) setTitle(chosen.name.replace(/\.[^.]+$/, '')); }} /></label>
          <p className="hint">{t("支持 TXT 与已有小说项目导出的 JSON。内容仅送到本地服务。")}</p>
          <label>{t("书名")}<input value={title} onChange={e => setTitle(e.target.value)} placeholder={t("以文件名作为默认书名")} maxLength={200} /></label>
          <label>{t("文本编码")}<select value={encoding} onChange={e => setEncoding(e.target.value)}><option value="auto">{t("自动识别")}</option><option value="utf8">UTF-8</option><option value="utf16le">UTF-16 LE</option><option value="utf16be">UTF-16 BE</option><option value="gb18030">GB18030 / GBK</option></select></label>
          <button className="primary" disabled={!file || busy}>{busy ? t("正在导入…") : t("导入到书架")}</button>
        </form>
        <div className="demo-callout"><p className="eyebrow">{t('没有模型也能先体验')}</p><strong>{t('载入内置可玩示例')}</strong><p>{t('一键创建原作、草稿和发布版本，直接进入试玩。')}</p><button type="button" onClick={() => void loadDemo()} disabled={demoBusy}>{demoBusy ? t('正在准备示例…') : t('载入示例并试玩 →')}</button></div>
        <div className="divider" /><h3>{t("我的原作")} <small>{sources.length}</small></h3>
        {sources.length === 0 ? <Empty>{t("还没有原作。选择一个小说文件开始。")}</Empty> : <ul className="item-list">{sources.map(source => <li key={source.id}><button className={`list-button ${source.id === selectedId ? 'selected' : ''}`} onClick={() => select(source.id)}><strong>{source.title}</strong><span>{t('{chapters} 章 · {characters} 字', {chapters: source.chapterCount, characters: source.charCount.toLocaleString(locale)})}</span><small>{dateLabel(source.createdAt, locale)} · {source.encoding}</small></button></li>)}</ul>}
      </aside>
      <article className="panel manuscript">
        {loading ? <p role="status">{t("正在打开原作…")}</p> : !document ? <Empty>{t("从左侧书架打开一本小说，原文会显示在这里。")}</Empty> : <>
          <div className="manuscript-heading"><div><p className="eyebrow">{t("原文预览")}</p><h3>{document.title}</h3><p className="hint">{document.filename} · {document.encoding} · {t('{count} 章', {count: document.chapterCount})}</p></div><button onClick={onGenerate}>{t("以此原作创建游戏 →")}</button></div>
          <label>{t("章节")}<select value={chapterId} onChange={e => setChapterId(e.target.value)}>{document.chapters.map(c => <option key={c.id} value={c.id}>{c.index + 1}. {c.title}</option>)}</select></label>
          <div className="chapter-text"><h4>{chapter?.title}</h4>{chapter?.paragraphs.map(paragraph => <div className="source-paragraph" key={paragraph.id}><p>{paragraph.text}</p><details><summary>{t("查看证据标识")}</summary><code>chapterId: {chapter.id}<br />paragraphId: {paragraph.id}</code></details></div>)}</div>
        </>}
      </article>
    </div>
  </section>;
}
