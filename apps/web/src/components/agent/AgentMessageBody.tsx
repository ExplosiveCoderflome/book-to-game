import React, { type ReactNode } from 'react';

function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => part.startsWith('**') && part.endsWith('**')
    ? <strong key={index}>{part.slice(2, -2)}</strong> : part.startsWith('`') && part.endsWith('`') ? <code key={index}>{part.slice(1, -1)}</code> : part);
}
/** Plain React text only: model HTML is never interpreted. */
export function AgentMessageBody({text}: {text: string}) {
  const blocks = text.split(/(```[\s\S]*?```)/g);
  const content: ReactNode[] = [];
  for (const block of blocks) {
    if (block.startsWith('```')) {content.push(<pre key={content.length}><code>{block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')}</code></pre>); continue;}
    let kind: 'p' | 'ul' | 'ol' = 'p', lines: string[] = [];
    const flush = () => {
      if (!lines.length) return;
      const key = content.length;
      if (kind === 'ul') content.push(<ul key={key}>{lines.map((line, i) => <li key={i}>{inline(line)}</li>)}</ul>);
      else if (kind === 'ol') content.push(<ol key={key}>{lines.map((line, i) => <li key={i}>{inline(line)}</li>)}</ol>);
      else content.push(<p key={key}>{lines.map((line, i) => <React.Fragment key={i}>{i > 0 && <br />}{inline(line)}</React.Fragment>)}</p>);
      lines = [];
    };
    for (const line of block.split('\n')) {
      if (!line.trim()) {flush(); continue;}
      if (/^\s*([-_*])(?:\s*\1){2,}\s*$/.test(line)) {flush(); content.push(<hr key={content.length} />); continue;}
      if (/^#{1,6} /.test(line)) {flush(); content.push(<h3 key={content.length}>{inline(line.replace(/^#{1,6} /, ''))}</h3>); continue;}
      const next = /^\s*[-*]\s+/.test(line) ? 'ul' : /^\s*\d+[.)、]\s+/.test(line) ? 'ol' : 'p';
      if (next !== kind) {flush(); kind = next;}
      lines.push(next === 'ul' ? line.replace(/^\s*[-*]\s+/, '') : next === 'ol' ? line.replace(/^\s*\d+[.)、]\s+/, '') : line);
    }
    flush();
  }
  return <div className="agent-prose">{content}</div>;
}
