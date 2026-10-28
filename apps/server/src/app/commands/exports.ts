import type { Workbench } from '../workbench.js';
import { command, emptySchema } from './definition.js';
import { exportPlayPackageInputSchema } from '../../modules/exports/index.js';

export function exportCommands(w: Workbench) {
  return [
    command('export_play_package',
      'M1b：把一个已发布版本导出为可离线游玩的包。target=html（默认）→ 单文件网页，返回报告与 html 文本；'
      + 'target=windows-exe → 预编译 Windows 播放器 + 同一份 HTML 原样 + 52 字节尾部标记（BTGPKG01 · 长度 · SHA-256 · hostApiVersion），'
      + '报告带 fileBase64（整个 .exe）、payloadSha256、player{version,hostApiVersion}，size 为 exe 字节数；播放器缺失 → EXPORT_TARGET_UNAVAILABLE（details.playerPath）。'
      + '内容按导出时版本/目录冻结，图片内联，manifest 记 contentHash/formatVersion/runtimeVersion 与 ai.mode=none；检测到密钥即中止。服务端不落盘。',
      exportPlayPackageInputSchema, true, input => w.exporter.exportPlayPackage(input)),
    command('export_targets',
      'M1b-2：查询当前可导出的目标（只读）。返回 { html: {available}, "windows-exe": {available, unavailableReason?, playerPath, version?, hostApiVersion?} }；'
      + 'Windows 播放器文件不在时 available=false、unavailableReason=player-missing。',
      emptySchema, true, () => w.exporter.exportTargets()),
  ];
}
