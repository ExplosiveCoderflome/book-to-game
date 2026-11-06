import type {
  BlockSpec, CatalogEntry, CatalogKind, FunProfile, SimulationStrategy, StatTemplate,
} from '@novel-game/contracts';
import { useI18n } from '../../lib/i18n';
import { catalogEntryDescription, catalogEntryTitle } from '../../lib/block-library-utils';

function Chips({values}: {values: readonly (string | number)[]}) {
  return <div className="block-library-chips">{values.length ? values.map(value => <span key={String(value)}>{String(value)}</span>) : <small>—</small>}</div>;
}

function Field({label, children}: {label: string; children: React.ReactNode}) {
  return <div className="block-library-field"><dt>{label}</dt><dd>{children}</dd></div>;
}

export function CatalogDetails({kind, entry}: {kind: CatalogKind; entry: CatalogEntry}) {
  const {t} = useI18n();
  return <div className="block-library-details">
    <div className="block-library-detail-heading">
      <div><span className="eyebrow">{entry.origin === 'builtin' ? t('内置只读') : t('自定义')}</span><h2>{catalogEntryTitle(entry)}</h2></div>
      <span className="block-library-version">v{entry.version}</span>
    </div>
    <p className="block-library-detail-id">{entry.id}</p>
    <p className="block-library-detail-description">{catalogEntryDescription(entry)}</p>
    {kind === 'block' && <BlockDetails block={entry.data as BlockSpec} />}
    {kind === 'fun-profile' && <ProfileDetails profile={entry.data as FunProfile} />}
    {kind === 'stat-template' && <StatDetails template={entry.data as StatTemplate} />}
    {kind === 'simulation-strategy' && <StrategyDetails strategy={entry.data as SimulationStrategy} />}
  </div>;
}

function BlockDetails({block}: {block: BlockSpec}) {
  const {t} = useI18n();
  return <>
    <dl className="block-library-definition-grid">
      <Field label={t('体验标签')}><Chips values={block.funTags} /></Field>
      <Field label={t('货架')}><Chips values={block.shelves} /></Field>
      <Field label="requires"><Chips values={block.requires} /></Field>
      <Field label="provides"><Chips values={block.provides} /></Field>
      <Field label="dependsOn"><Chips values={block.composesWith.dependsOn} /></Field>
      <Field label="conflictsWith"><Chips values={block.composesWith.conflictsWith} /></Field>
      <Field label={t('验收指标')}><Chips values={block.acceptance} /></Field>
    </dl>
    <section className="block-library-params"><h3>{t('参数与默认值')}</h3>
      {block.params.length ? <div className="block-library-table-wrap"><table><thead><tr><th>{t('参数')}</th><th>{t('类型')}</th><th>{t('默认值')}</th><th>{t('说明 / 选项')}</th></tr></thead>
        <tbody>{block.params.map(param => <tr key={param.key}><td><strong>{param.label}</strong><small>{param.key}</small></td><td>{param.type}</td><td><code>{param.default === undefined ? '—' : JSON.stringify(param.default)}</code></td><td>{param.description ?? ''}{param.options?.length ? <small>{param.options.join(' / ')}</small> : null}</td></tr>)}</tbody></table></div>
        : <p className="hint">{t('这个积木没有可调参数。')}</p>}
    </section>
  </>;
}

function ProfileDetails({profile}: {profile: FunProfile}) {
  const {t} = useI18n();
  return <dl className="block-library-definition-grid">
    <Field label={t('体验标签')}><Chips values={profile.funTags} /></Field>
    <Field label="suggestedBlocks"><Chips values={profile.suggestedBlocks} /></Field>
    <Field label="strategies"><Chips values={profile.strategies} /></Field>
    <Field label="pacingLine"><code>{profile.pacingLine.decisions} decisions / {profile.pacingLine.uniqueChars} chars</code></Field>
    <Field label={t('验收指标')}><Chips values={Object.entries(profile.metricMatrix).filter(([, enabled]) => enabled).map(([id]) => id)} /></Field>
    <Field label="thresholds"><pre>{JSON.stringify(profile.thresholds, null, 2)}</pre></Field>
  </dl>;
}

function StatDetails({template}: {template: StatTemplate}) {
  const {t} = useI18n();
  return <>
    <div className="block-library-table-wrap"><table><thead><tr><th>{t('变量')}</th><th>{t('类型')}</th><th>{t('初值')}</th><th>{t('角色')}</th></tr></thead>
      <tbody>{template.variables.map(variable => <tr key={variable.name}><td><strong>{variable.displayLabel ?? variable.name}</strong><small>{variable.name}</small></td><td>{variable.type}</td><td><code>{JSON.stringify(variable.initial)}</code></td><td>{variable.role}</td></tr>)}</tbody></table></div>
    <section className="block-library-params"><h3>promptHint</h3><p>{template.promptHint}</p></section>
  </>;
}

function StrategyDetails({strategy}: {strategy: SimulationStrategy}) {
  const {t} = useI18n();
  return <dl className="block-library-definition-grid"><Field label={t('复用的内置选择器')}><Chips values={[strategy.baseStrategy]} /></Field></dl>;
}
