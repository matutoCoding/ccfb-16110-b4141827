import { EXPOSURE_LEVELS, exposureTimeline, radiantFluxAt } from '../../core/exposure';
import { temperatureAt } from '../../core/thermal';
import { fmtDuration, fmtTime } from '../../core/format';
import { store } from '../../state/store';
import { button, h, panelTitle, switchRow } from '../dom';
import { lineChart } from '../charts';

export const mountExposurePage = (panel: HTMLElement, dock: HTMLElement): (() => void) => {
  let selectedPointId = store.selectedPointId ?? store.data.points[0]?.id;
  let lastUpdate = 0;

  const tempsAt = (time: number): Float32Array => {
    const arr = new Float32Array(store.data.forgings.length);
    store.data.forgings.forEach((_, i) => {
      arr[i] = store.result ? temperatureAt(store.result, i, time, 'surface') : store.data.forgings[i].dischargeTempC;
    });
    return arr;
  };

  const render = (): void => {
    panel.replaceChildren();
    if (!store.data.points.some((p) => p.id === selectedPointId)) selectedPointId = store.data.points[0]?.id;
    panel.append(panelTitle('人员暴露', '测点辐射热通量、累计热剂量与超限时长；移动隔热屏后地面等值线即时刷新。'));

    panel.append(
      h('section', { class: 'section' },
        h('h3', {}, '等值线与布点'),
        switchRow('显示热通量等值线', makeSwitch(store.showHeatmap, (v) => { store.showHeatmap = v; store.emit('view'); })),
        switchRow('叠加红外测温标记', makeSwitch(store.showMarkers, (v) => { store.showMarkers = v; store.emit('view'); })),
        button(store.addPointMode ? '正在布点：点击场地放置（Esc 取消）' : '添加过道/工位测点', () => {
          store.addPointMode = !store.addPointMode;
          store.emit('page');
        }, store.addPointMode ? 'danger' : 'primary'),
        h('div', { style: 'display:grid;gap:6px;margin-top:12px' },
          ...EXPOSURE_LEVELS.map((l) => h('span', { style: 'display:flex;align-items:center;gap:8px;color:#475569' },
            h('i', { style: `width:28px;height:4px;border-radius:99px;background:${l.color}` }), l.label)),
        ),
      ),
    );

    const temps = tempsAt(store.timeSec);
    panel.append(
      h('section', { class: 'section' },
        h('h3', {}, `测点列表（${store.data.points.length}）`),
        h('div', { class: 'list' }, ...store.data.points.map((p) => {
          const q = radiantFluxAt(p.x, p.z, p.height, {
            forgings: store.data.forgings, tempC: temps, objects: store.data.objects, ambientC: store.data.site.ambientC,
          });
          return h('button', {
            class: `list-item ${selectedPointId === p.id ? 'active' : ''}`,
            onclick: () => { selectedPointId = p.id; store.select('point', p.id); render(); },
          }, h('strong', {}, p.name), h('span', { id: `flux-${p.id}` }, `当前 ${(q / 1000).toFixed(2)} kW/m² · (${p.x}, ${p.z})`));
        })),
      ),
    );

    const point = store.data.points.find((p) => p.id === selectedPointId);
    if (point && store.result) {
      const timeline = exposureTimeline(point, store.data, (i, t) => temperatureAt(store.result!, i, t, 'surface'), store.result.times);
      panel.append(
        h('section', { class: 'section' },
          h('h3', {}, `${point.name} 暴露曲线`),
          h('div', { class: 'grid-3' },
            metric('峰值 kW/m²', (timeline.maxFlux / 1000).toFixed(2)),
            metric('累计剂量 kJ/m²', timeline.finalDose.toFixed(0)),
            metric('超 1 kW/m²', fmtDuration(timeline.totalOverSec)),
          ),
          lineChart([
            { name: '辐射热通量 kW/m²', color: '#ea580c', points: timeline.flux.map((q, i) => [store.result!.times[i], q / 1000]) },
            { name: '累计剂量 /100', color: '#7c3aed', points: timeline.doseKjm2.map((d, i) => [store.result!.times[i], d / 100]) },
          ], { markers: [{ x: store.timeSec, color: '#0f766e' }] }),
          h('p', { class: 'field-hint' }, `当前时刻：${fmtTime(store.timeSec)}。剂量按超过 0.35 kW/m² 的部分积分。`),
        ),
      );
    } else {
      panel.append(h('div', { class: 'empty-state' }, h('strong', {}, '运行冷却推演后生成累计暴露曲线')));
    }

    dock.replaceChildren(
      h('div', { style: 'display:flex;justify-content:space-between;gap:16px;align-items:center;flex-wrap:wrap' },
        h('div', {}, h('strong', {}, '地面等值线高度 1.2 m'), h('div', { style: 'color:#64748b' }, '颜色为辐射热通量，线划分为 1.0 / 2.5 / 5.0 kW/m²')),
        h('div', { class: 'btn-row' },
          button(store.night ? '切日班' : '切夜班', () => { store.night = !store.night; store.emit('view'); }),
          button(store.split ? '关闭分屏' : '可见光/热像分屏', () => { store.split = !store.split; store.emit('view'); }, 'primary'),
        ),
      ),
    );
  };

  const updateFast = (): void => {
    const now = performance.now();
    if (now - lastUpdate < 350) return;
    lastUpdate = now;
    const temps = tempsAt(store.timeSec);
    for (const p of store.data.points) {
      const el = document.getElementById(`flux-${p.id}`);
      if (!el) continue;
      const q = radiantFluxAt(p.x, p.z, p.height, {
        forgings: store.data.forgings, tempC: temps, objects: store.data.objects, ambientC: store.data.site.ambientC,
      });
      el.textContent = `当前 ${(q / 1000).toFixed(2)} kW/m² · (${p.x}, ${p.z})`;
    }
  };

  const unsub = store.subscribe((event) => {
    if (event === 'page' || event === 'data' || event === 'selection' || event === 'result' || event === 'view') render();
    if (event === 'tick') updateFast();
  });
  render();
  return unsub;
};

const makeSwitch = (checked: boolean, onChange: (v: boolean) => void): HTMLLabelElement =>
  h('label', { class: 'switch' },
    h('input', { type: 'checkbox', checked, onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked) }),
    h('i', {}),
  ) as HTMLLabelElement;

const metric = (label: string, value: string): HTMLElement =>
  h('div', { class: 'metric-pill', style: 'display:grid;gap:4px;padding:12px' }, h('span', { style: 'color:#64748b' }, label), h('b', { style: 'font-size:20px' }, value));
