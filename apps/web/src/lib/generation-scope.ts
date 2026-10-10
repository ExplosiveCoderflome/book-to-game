export function selectedChapters(chapters: {id: string}[], selection: string[]): string[] {
  if (!selection.length || new Set(selection).size !== selection.length || selection.some(id => !chapters.some(c => c.id === id))) throw new Error('请选择当前原作中至少一个章节，章节不能重复。');
  const selected = new Set(selection);
  return chapters.filter(c => selected.has(c.id)).map(c => c.id);
}
