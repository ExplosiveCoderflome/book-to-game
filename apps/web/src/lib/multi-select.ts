/** Toggle or replace a selection set. Additive toggles membership; otherwise replaces with [id]. */
export function nextSceneSelection(prev: string[], id: string, additive: boolean): string[] {
  if (!additive) return [id];
  return prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
}
