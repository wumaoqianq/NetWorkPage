import { GlobeHemisphereWest, HardDrives } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { getIcon } from '../model.js';

/** 图标状态：ready（受管私有图）/ loading（中性骨架）/ failed（本地加载失败）/ missing（字母回退）。 */
export function SiteIcon({ site, small = false, lazy = true }) {
  const managed = getIcon(site);
  const resourceUrl = managed.url || site.icon;
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(Boolean(managed.present));
  useEffect(() => { setFailed(false); setLoading(Boolean(managed.present)); }, [resourceUrl, managed.present]);
  const builtIn = ['tinypng', 'excalidraw', 'squoosh'].includes(site.icon) ? 'png' : 'svg';
  return <span className={`site-icon ${small ? 'small' : ''} ${loading ? 'icon-loading' : ''} icon-${managed.present ? 'managed' : site.icon || 'generic'}`}>
    {managed.present && !failed
      ? <img src={managed.url} loading={lazy ? 'lazy' : 'eager'} decoding="async" alt="" onLoad={() => setLoading(false)} onError={() => { setLoading(false); setFailed(true); }} />
      : site.icon === 'resources' ? <HardDrives size={26} weight="fill" aria-hidden="true" />
        : failed || !site.icon || site.icon === 'generic' || !['tinypng', 'excalidraw', 'squoosh', 'github', 'figma', 'notion'].includes(site.icon)
          ? <span className="icon-fallback-letter" aria-hidden="true">{site.name?.slice(0, 1) || <GlobeHemisphereWest size={24} />}</span>
          : <img src={`/assets/${site.icon}.${builtIn}`} loading={lazy ? 'lazy' : 'eager'} alt="" onError={() => setFailed(true)} />}
  </span>;
}
