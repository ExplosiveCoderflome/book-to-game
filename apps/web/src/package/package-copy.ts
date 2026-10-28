/** In-package copy (UI plan §4/§5). Never mentions 本地服务/授权/MCP/模型/访问码. */
const actionErrors: Record<string, string> = {
  SESSION_TURN_CONFLICT: '存档已经更新，请重新读取后行动。',
  CHOICE_LOCKED: '当前变量条件未满足，此选项不可用。',
  ACTION_BLOCKED: '当前条件不允许此行动。',
  SESSION_ENDED: '本次游戏已经结束。',
  UNKNOWN_CHOICE: '当前场景没有此选项。',
  INVALID_ACTION: '此行动当前不可用。',
  SAVE_INCOMPATIBLE: '这个存档来自旧版本，无法继续。可以开始新存档；旧存档会保留在列表里。',
  SAVE_CORRUPT: '存档已损坏，无法继续。',
  SESSION_NOT_FOUND: '没有找到这个存档，可能已在这个浏览器里被清除。',
};

import type { SaveLocation } from '@novel-game/play-runtime';

/** 「存档找不到」 depends on where saves live (UI plan §5.4); the exe never says 「浏览器」. */
export const SAVE_NOT_FOUND_BY_WHERE: Record<SaveLocation, string> = {
  browser: actionErrors.SESSION_NOT_FOUND!,
  'host-file': '没有找到这个存档，可能已从存档文件夹里移走。',
  'host-fallback': '没有找到这个存档，临时位置可能已被清理。',
};

export function packageErrorMessage(error: unknown, where: SaveLocation = 'browser'): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'SESSION_NOT_FOUND') return SAVE_NOT_FOUND_BY_WHERE[where];
  return typeof code === 'string' && Object.hasOwn(actionErrors, code) ? actionErrors[code]! : '行动未成功。进度未推进。';
}

export const FORBIDDEN_PACKAGE_WORDS = ['本地服务', '授权', 'MCP', '模型', '访问码'] as const;
/** Per-`where` package sentences (UI plan §5.4/§5.5). */
export const SAVE_LOCATION_COPY: Record<SaveLocation, { footHint: string; emptyNoSaves: string }> = {
  browser: { footHint: '存档只保存在这台设备的这个浏览器里。', emptyNoSaves: '还没有存档。开始新存档后，进度会自动保存在这个浏览器里。' },
  'host-file': { footHint: '存档保存在这台电脑上，可以整个文件夹拷走备份。', emptyNoSaves: '还没有存档。开始新存档后，进度会自动保存在这台电脑的存档文件夹里。' },
  'host-fallback': { footHint: '存档暂存在本程序的临时位置，不在存档文件夹里。', emptyNoSaves: '还没有存档。开始新存档后，进度会暂存在本程序的临时位置。' },
};
export const EXE_BANNER_COPY = {
  fallbackTitle: '存档改存在临时位置。',
  fallbackWriteFailed: '存档文件夹写不进去，进度改存在本程序的内部数据里：下次打开通常还在，但不能拷走备份。',
  fallbackHost: '播放器版本和这个游戏文件不匹配，用不了存档文件夹。进度仍会保存，但不能拷走备份。',
  unsavedExe: '存档文件夹和临时位置都写不进去。仍可正常游玩。',
} as const;

/** Every string the exe may show (must not contain 浏览器 or FORBIDDEN_PACKAGE_WORDS). */
export const EXE_PACKAGE_COPY = [
  ...Object.values(SAVE_NOT_FOUND_BY_WHERE).slice(1),
  ...Object.values(SAVE_LOCATION_COPY['host-file']), ...Object.values(SAVE_LOCATION_COPY['host-fallback']),
  ...Object.values(EXE_BANNER_COPY), '存档位置', '复制路径', '已复制', '临时位置', '正在打开…',
];
export const PACKAGE_COPY = [...Object.values(actionErrors), ...EXE_PACKAGE_COPY];
