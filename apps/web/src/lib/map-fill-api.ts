import type {
  AcceptMapFillInput, MapFillPlacement, MapFillProposal, ProposeMapFillInput, WorldDraft,
} from '@novel-game/contracts';
import { request } from './api';

export function proposeMapFill(token: string, draftId: string, input: ProposeMapFillInput & {mapId?: string}) {
  return request<MapFillProposal>(token, `/worlds/drafts/${encodeURIComponent(draftId)}/map-fill/propose`, 'POST', input);
}

export function acceptMapFill(token: string, draftId: string, input: AcceptMapFillInput) {
  return request<{draft: WorldDraft; placements: MapFillPlacement[]}>(
    token, `/worlds/drafts/${encodeURIComponent(draftId)}/map-fill/accept`, 'POST', input,
  );
}
