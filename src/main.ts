import './styles.css';
import { seedIfEmpty } from './db/seed';
import { h, clear } from './ui/dom';
import { mountViewport } from './ui/viewport';
import { mountSitePage } from './ui/pages/site_page';
import { mountBatchesPage } from './ui/pages/batches_page';
import { mountSimulationPage } from './ui/pages/simulation_page';
import { mountExposurePage } from './ui/pages/exposure_page';
import { mountRecordsPage } from './ui/pages/records_page';
import { ensureSimulation } from './state/simulation_actions';
import { store } from './state/store';
import type { PageKey } from './core/types';

const NAV: { key: PageKey; label: string; icon: string }[] = [
  { key: 'site', label: '场地布局', icon: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6' },
  { key: 'batches', label: '锻件批次', icon: 'M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zm0 0v9m0 0l8-4.5M12 12L4 7.5' },
  { key: 'simulation', label: '冷却推演', icon: 'M4 19V5m0 14h16M8 16l3-4 3 2 4-6' },
  { key: 'exposure', label: '人员暴露', icon: 'M12 12a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0' },
  { key: 'records', label: '工艺记录', icon: 'M7 3h7l5 5v13H7zM14 3v6h5M9 13h6M9 17h6' },
];

const app = document.querySelector<HTMLDivElement>('#app')!;
const panel = h('section', { class: 'panel', id: 'panel' });
const dock = h('div', { class: 'dock', id: 'dock' });
const canvas = h('canvas', { id: 'gpu-canvas', 'aria-label': '冷却场 WebGPU 三维视图' }) as HTMLCanvasElement;

const fpsPill = h('span', { class: 'metric-pill' }, 'FPS ', h('b', { id: 'fps-value' }, '—'));
const countPill = h('span', { class: 'metric-pill' }, '锻件 ', h('b', { id: 'count-value' }, '0'));
const gpuPill = h('span', { class: 'metric-pill' }, h('i', { class: 'status-dot' }), 'WebGPU');

const navButtons = NAV.map((item) => h('button', {
  class: 'nav-btn',
  dataset: { page: item.key },
  onclick: () => store.setPage(item.key),
},
  h('span', {
    class: 'nav-icon',
    html: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${item.icon}"/></svg>`,
  }),
  h('span', {}, item.label),
));

app.append(
  h('div', { class: 'shell' },
    h('aside', { class: 'sidebar' },
      h('div', { class: 'brand' }, h('div', { class: 'brand-mark' }), h('div', {}, h('h1', {}, '冷却场数字孪生'), h('p', {}, 'Thermal Yard Workbench'))),
      h('nav', { class: 'nav' }, ...navButtons),
      h('div', { class: 'sidebar-foot' }, h('strong', { style: 'color:#e2e8f0' }, '安全提示'), h('div', {}, '热通量超过 1 kW/m² 应缩短停留；5 kW/m² 区域按禁入管理。')),
    ),
    h('div', { class: 'workspace' },
      h('header', { class: 'topbar' },
        h('div', {}, h('h2', { id: 'page-title' }, '场地布局')),
        h('div', { class: 'meta' }, countPill, fpsPill, gpuPill),
      ),
      h('main', { class: 'layout' },
        panel,
        h('section', { class: 'stage', id: 'stage' },
          canvas,
          h('div', { class: 'stage-overlay' },
            h('div', { class: 'stage-tools', id: 'stage-tools' }),
          ),
          dock,
        ),
      ),
    ),
  ),
);

mountViewport(canvas);

let cleanupPage: (() => void) | undefined;
const renderRoute = (): void => {
  cleanupPage?.();
  cleanupPage = undefined;
  clear(panel);
  clear(dock);
  document.body.dataset.page = store.page;
  const current = NAV.find((n) => n.key === store.page)!;
  document.querySelector('#page-title')!.textContent = current.label;
  navButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.page === store.page));

  if (store.page === 'site') cleanupPage = mountSitePage(panel, dock);
  if (store.page === 'batches') cleanupPage = mountBatchesPage(panel, dock);
  if (store.page === 'simulation') cleanupPage = mountSimulationPage(panel, dock);
  if (store.page === 'exposure') cleanupPage = mountExposurePage(panel, dock);
  if (store.page === 'records') cleanupPage = mountRecordsPage(panel);
};

store.subscribe((event) => {
  if (event === 'page') renderRoute();
  if (event === 'fps') {
    const fpsEl = document.querySelector('#fps-value');
    if (fpsEl) fpsEl.textContent = store.fps ? String(store.fps) : '—';
    gpuPill.querySelector('.status-dot')?.setAttribute('style', store.webgpu ? '' : 'background:#f59e0b;box-shadow:0 0 10px #f59e0b');
  }
  if (event === 'data' || event === 'result') {
    const countEl = document.querySelector('#count-value');
    if (countEl) countEl.textContent = String(store.data.forgings.length);
  }
});

renderRoute();
seedIfEmpty()
  .then((data) => {
    store.setData(data);
    const countEl = document.querySelector('#count-value');
    if (countEl) countEl.textContent = String(data.forgings.length);
    return ensureSimulation();
  })
  .catch((error) => {
    console.error(error);
    panel.append(h('div', { class: 'empty-state' }, 'IndexedDB 初始化失败，请使用现代浏览器并允许本地存储。'));
  });
