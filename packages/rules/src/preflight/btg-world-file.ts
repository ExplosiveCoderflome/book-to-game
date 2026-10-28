/**
 * Convert a hand-written `btg.world` sample file (planner format, e.g. docs/samples/shoudeng) into
 * WorldContent v1 (+ S1 fields). Pure; fills only the legacy fields the sample format does not carry,
 * with honest placeholders. Validation is still worldContentSchema's job.
 */
import type { WorldContent } from '@novel-game/contracts';

type Json = Record<string, unknown>;
const asArray = (value: unknown): Json[] => (Array.isArray(value) ? value as Json[] : []);

export function isBtgWorldFile(value: unknown): boolean {
  return !!value && typeof value === 'object' && (value as Json).format === 'btg.world';
}

export function btgWorldFileToContent(file: Json, opts: {goal?: string; sourceChapterIds?: string[]} = {}): WorldContent {
  const endings = asArray(file.endings);
  const clock = file.clock as Json | undefined;
  const timeoutId = clock?.timeoutEndingId as string | undefined;
  const timeoutEnding = endings.find(e => e.id === timeoutId);
  const strip = <T extends Json>(item: T, keys: string[]): T => Object.fromEntries(Object.entries(item).filter(([k]) => !keys.includes(k))) as T;
  const player = (file.player ?? {}) as Json;
  const content = {
    schemaVersion: 1, mode: 'open',
    title: String(file.title ?? file.id ?? '未命名'),
    premise: String(file.premise ?? ''),
    playerRole: String(player.description ?? player.role ?? '玩家'),
    goal: opts.goal ?? String(file.goal ?? file.premise ?? ''),
    worldRules: asArray(file.worldRules).length ? file.worldRules : [`时间以月计；时限 ${clock?.limitMonths ?? '—'} 个月。`],
    adaptationNotes: String(file.$comment ?? '').slice(0, 4000),
    sourceChapterIds: opts.sourceChapterIds ?? [String(file.id ?? 'sample')],
    initialLocationId: String(file.startLocationId ?? file.initialLocationId),
    timeLimit: 100,
    timeoutEnding: String(timeoutEnding?.text ?? '时间到了。'),
    locations: asArray(file.locations),
    facts: asArray(file.facts),
    // Sample factions are a flat {id,name} list; WorldContent factions live on map layers → keep them as NPC tags.
    npcs: asArray(file.npcs).map(npc => {
      const factionName = asArray(file.factions).find(f => f.id === npc.factionId)?.name as string | undefined;
      const {factionId: _factionId, ...rest} = npc;
      return factionName ? {...rest, tags: [...new Set([...((rest.tags as string[] | undefined) ?? []), factionName])].slice(0, 10)} : rest;
    }),
    // S1 generates blocked reasons; the legacy schema still requires an author fallback string.
    actions: asArray(file.actions).map(a => ({blockedReason: '条件未满足', risk: '', ...a})),
    events: asArray(file.events),
    endings: endings.map(e => strip(e, [])),
    // K15: 「这一生」 recap (endings[].passages travel with the ending objects above).
    ...(Array.isArray(file.recap) ? {recap: asArray(file.recap)} : {}),
    ...(file.resourceDefs ? {resourceDefs: file.resourceDefs} : {}),
    ...(clock ? {clock} : {}),
    ...(file.storyletRules ? {storyletRules: file.storyletRules} : {}),
    ...(typeof file.batch === 'number' || file.pending ? {production: {
      ...(typeof file.batch === 'number' ? {batch: file.batch} : {}), complete: !file.pending,
      ...(file.pending ? {note: String((file.pending as Json).note ?? '').slice(0, 2000)} : {})}} : {}),
    ...(file.storylets ? {storylets: asArray(file.storylets).map(sl => ({...sl,
      ...(sl.repeat && (sl.repeat as Json).maxTimes === null ? {repeat: strip(sl.repeat as Json, ['maxTimes'])} : {})}))} : {}),
  };
  return content as unknown as WorldContent;
}
