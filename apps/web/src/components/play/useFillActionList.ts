import { useMemo, useState, useCallback } from 'react';
import type { AdventureView } from '@novel-game/contracts';

type FillGroup = NonNullable<AdventureView['fillGroups']>[number];
type Action = AdventureView['actions'][number];

export type FillListModel = {
  /** Actions shown on the main list (non-grouped + single-line flat + entry rows as synthetic). */
  mainItems: Array<
    | { type: 'action'; action: Action }
    | { type: 'entry'; group: FillGroup }
  >;
  openGroup: FillGroup | null;
  openLines: Action[];
  openSheet: (groupId: string) => void;
  closeSheet: () => void;
};

/**
 * Hybrid A/B: single playable line → flat; multi-line or empty → entry opens sheet.
 * Q3: sheet stays open across refresh — caller keeps openGroupId when session updates.
 */
export function useFillActionList(
  actions: Action[],
  fillGroups: FillGroup[] | undefined,
  locationId: string | undefined,
): FillListModel {
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);

  const groupsHere = useMemo(
    () => (fillGroups ?? []).filter(g => !locationId || g.locationId === locationId),
    [fillGroups, locationId],
  );

  const groupedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const g of groupsHere) {
      // Multi or empty → hide lines from main (show via sheet). Single → flat on main.
      if (g.lineActionIds.length !== 1 || g.emptyMessage) {
        for (const id of g.lineActionIds) ids.add(id);
      }
    }
    return ids;
  }, [groupsHere]);

  const mainItems = useMemo(() => {
    const items: FillListModel['mainItems'] = [];
    const seenEntry = new Set<string>();
    for (const a of actions) {
      if (groupedIds.has(a.id)) continue;
      const g = groupsHere.find(gr => gr.lineActionIds.length === 1 && gr.lineActionIds[0] === a.id && !gr.emptyMessage);
      if (g) {
        items.push({ type: 'action', action: a });
        continue;
      }
      items.push({ type: 'action', action: a });
    }
    for (const g of groupsHere) {
      const useSheet = g.lineActionIds.length !== 1 || !!g.emptyMessage;
      if (!useSheet) continue;
      if (seenEntry.has(g.id)) continue;
      seenEntry.add(g.id);
      items.push({ type: 'entry', group: g });
    }
    return items;
  }, [actions, groupedIds, groupsHere]);

  const openGroup = groupsHere.find(g => g.id === openGroupId) ?? null;
  const openLines = useMemo(() => {
    if (!openGroup) return [];
    const idSet = new Set(openGroup.lineActionIds);
    return actions.filter(a => idSet.has(a.id));
  }, [openGroup, actions]);

  const openSheet = useCallback((groupId: string) => setOpenGroupId(groupId), []);
  const closeSheet = useCallback(() => setOpenGroupId(null), []);

  return { mainItems, openGroup, openLines, openSheet, closeSheet };
}
