export function Notice({ text, kind = 'error' }: { text: string | null; kind?: 'error' | 'success' | 'info' }) {
  return text ? <div className={`notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{text}</div> : null;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty"><span aria-hidden="true">◇</span><p>{children}</p></div>;
}

export function dateLabel(value: string) {
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
