import { useI18n } from '../../lib/i18n';
import { StudioIcon } from './StudioIcon';

export function ConnectionScreen({connecting, error, onRetry, onDemo}: {connecting: boolean; error: string | null; onRetry: () => void; onDemo: () => void}) {
  const {t} = useI18n();
  return <div className="studio-connection"><span className="studio-connection-mark"><StudioIcon name="branch" /></span>
    <h1>{t(connecting ? '正在连接你的工作空间' : '工作空间暂未连接')}</h1>
    <p>{t(connecting ? '正在读取作品、制作任务与对话记录。' : '启动本地服务后重新连接，你的作品和对话会继续保留。')}</p>
    {!connecting && error && <p role="alert" className="agent-error-copy">{error}</p>}
    <div><button className="primary" onClick={onRetry} disabled={connecting}>{t(connecting ? '正在连接…' : '重新连接')}</button>
      <button className="quiet" onClick={onDemo}>{t('打开可玩示例')}<StudioIcon name="arrow" /></button></div>
  </div>;
}
