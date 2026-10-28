import { SYSTEM_WAIT_ACTION_ID, type WorldContent } from '@novel-game/contracts';
export function systemWait(locationId: string): WorldContent['actions'][number] {
  return {id: SYSTEM_WAIT_ACTION_ID, label: '等待片刻', description: '停留在原地，让局势继续发展。', locationId,
    availableWhen: [], requires: [], blockedReason: '剩余时间不足', risk: '消耗 1 点时间，可能触发人物行动或到达时限。',
    timeCost: 1, once: false, effects: [], text: '你停留片刻，时间继续流逝。', origin: 'adapted', evidence: []};
}
