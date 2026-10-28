import React from 'react';
import ReactDOM from 'react-dom/client';
import { I18nProvider } from '../lib/i18n';
import { bootPackage } from './boot';
import { PackageApp } from './PackageApp';
import '../styles.css';

// The `ai` manifest field is reserved (mode:'none') and intentionally never read here.
const loaded = bootPackage();
const locale = loaded.ok ? loaded.manifest.locale : 'zh-CN';
const title = loaded.ok ? loaded.manifest.title : loaded.title;
document.getElementById('btg-booting')?.remove();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider initialLocale={locale === 'en-US' ? 'en-US' : 'zh-CN'} documentTitle={title}>
      <PackageApp loaded={loaded} />
    </I18nProvider>
  </React.StrictMode>,
);
