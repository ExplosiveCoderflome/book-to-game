import { useEffect, useMemo, useState } from 'react';
import {
  GuardedSaveStore, type OpenPackageContent, type PackageLoadResult, type SaveStoreStatus, type StoryPackageContent,
} from '@novel-game/play-runtime';
import { openPackageSaveStore } from './open-save-store';
import { SAVE_LOCATION_COPY } from './package-copy';
import { SaveLocationHint } from './SaveLocationHint';
import { useI18n } from '../lib/i18n';
import { PlayerShellLayout } from '../components/player/PlayerShellLayout';
import { PlayerStoryPage } from '../components/player/PlayerStoryPage';
import { PlayerWorldPage } from '../components/player/PlayerWorldPage';
import type { PackageChrome } from '../components/player/package-chrome';
import { packageStoryPort, packageWorldPort } from './package-ports';
import { goPackage, parsePackageRoute, saveHash, startHash, type PackageRoute } from './package-route';
import { PackageErrorPage } from './PackageErrorPage';
import { StorageBanner } from './StorageBanner';

type Props = { loaded: PackageLoadResult & { rawManifest?: Record<string, unknown> } };

/** Export package root: four states only — start, in-session, ended (inside the pages), error. */
export function PackageApp({ loaded }: Props) {
  if (!loaded.ok) {
    const raw = loaded.rawManifest ?? {};
    return (
      <PlayerShellLayout showBackWorkbench={false} brandHref="#/" onBrand={() => goPackage(startHash())}>
        <PackageErrorPage
          kind={loaded.kind}
          title={loaded.title}
          formatVersion={typeof raw.formatVersion === 'number' ? raw.formatVersion : undefined}
          runtimeVersion={typeof raw.runtimeVersion === 'string' ? raw.runtimeVersion : undefined}
          contentHash={typeof raw.contentHash === 'string' ? raw.contentHash : undefined}
          reason={loaded.reason}
        />
      </PlayerShellLayout>
    );
  }
  return <PackageBoot manifest={loaded.manifest} content={loaded.content} />;
}

type Manifest = Extract<PackageLoadResult, { ok: true }>['manifest'];
type Content = Extract<PackageLoadResult, { ok: true }>['content'];

/** booting (X11): the exe host is async, so saves are preloaded before the pages render. Browser: one microtask. */
function PackageBoot({ manifest, content }: { manifest: Manifest; content: Content }) {
  const { t } = useI18n();
  const [store, setStore] = useState<GuardedSaveStore | null>(null);
  useEffect(() => {
    let live = true;
    void openPackageSaveStore(manifest.packageId).then(opened => { if (live) setStore(opened.store); });
    return () => { live = false; };
  }, [manifest.packageId]);
  if (!store) {
    return (
      <PlayerShellLayout showBackWorkbench={false} brandHref="#/" onBrand={() => goPackage(startHash())}>
        <p className="hint" role="status" data-testid="package-booting">{t('正在打开…')}</p>
      </PlayerShellLayout>
    );
  }
  return <PackagePlayer manifest={manifest} content={content} store={store} />;
}

function PackagePlayer({ manifest, content, store }: { manifest: Manifest; content: Content; store: GuardedSaveStore }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<SaveStoreStatus>(store.status);
  const [epoch, setEpoch] = useState(0);
  const [route, setRoute] = useState<PackageRoute>(() => parsePackageRoute());

  useEffect(() => store.onStatus(next => { setStatus(next); setEpoch(n => n + 1); }), [store]);
  useEffect(() => {
    const onHash = () => setRoute(parsePackageRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const ports = useMemo(() => manifest.mode === 'story'
    ? { story: packageStoryPort(manifest, content as StoryPackageContent, store).port }
    : { world: packageWorldPort(manifest, content as OpenPackageContent, store).port }, [manifest, content, store]);

  const pkg: PackageChrome = useMemo(() => ({
    hash: (id?: string) => id ? saveHash(id) : startHash(),
    autosaveHint: status.persistent ? t('行动成功后自动保存。') : t('本局不会保存。'),
    storageEpoch: epoch,
    where: status.where,
    footHint: t(SAVE_LOCATION_COPY[status.where].footHint),
    locationDetails: status.where === 'host-file' ? <SaveLocationHint packageId={manifest.packageId} /> : undefined,
    emptyNoSaves: t(SAVE_LOCATION_COPY[status.where].emptyNoSaves),
  }), [status.persistent, status.where, epoch, t, manifest.packageId]);

  const saveId = route.kind === 'save' ? route.saveId : undefined;
  return (
    <PlayerShellLayout showBackWorkbench={false} brandHref="#/" onBrand={() => goPackage(startHash())} banner={<StorageBanner status={status} />}>
      {ports.story
        ? <PlayerStoryPage port={ports.story} revisionId={manifest.revision.id} initialSessionId={saveId} pkg={pkg} />
        : <PlayerWorldPage port={ports.world!} revisionId={manifest.revision.id} initialAdventureId={saveId} pkg={pkg} />}
    </PlayerShellLayout>
  );
}
