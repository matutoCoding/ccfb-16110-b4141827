import { downloadJson, uid } from '../../core/format';
import type { ProcessRecord } from '../../core/types';
import { store } from '../../state/store';
import { persist } from '../../db/database';
import { badge, button, field, h, numInput, panelTitle } from '../dom';
import { lineChart } from '../charts';
import { toast } from '../toast';

export const mountRecordsPage = (panel: HTMLElement): (() => void) => {
  let selectedId = store.data.records[0]?.id;
  const compare = new Set<string>(store.data.records.slice(0, 2).map((r) => r.id));

  const render = (): void => {
    panel.replaceChildren();
    panel.append(panelTitle('工艺记录', '摆放方案、推演结果、实测硬度和同钢种同截面历史批次放在同一条证据链上。'));
    const selected = store.data.records.find((r) => r.id === selectedId) ?? store.data.records[0];

    const layout = h('div', { class: 'records-layout' });
    const list = h('section', { class: 'section', style: 'overflow:auto' },
      h('h3', {}, `历史批次（${store.data.records.length}）`),
      h('div', { class: 'list' }, ...store.data.records.map((r) => h('button', {
        class: `list-item ${selected?.id === r.id ? 'active' : ''}`,
        onclick: () => { selectedId = r.id; render(); },
      },
        h('strong', {}, r.batchCode),
        h('span', {}, `${r.steel} · 间距 ${r.spacingX.toFixed(1)}m · 不合格 ${r.summary.failedCount}`),
        h('label', {
          style: 'display:flex;gap:6px;align-items:center;margin-top:6px;pointer-events:auto',
          onclick: (e: Event) => e.stopPropagation(),
        }, h('input', {
          type: 'checkbox', checked: compare.has(r.id),
          onchange: () => { compare.has(r.id) ? compare.delete(r.id) : compare.add(r.id); render(); },
        }), '加入冷速对比'),
      ))),
    );

    const detail = h('div', { class: 'records-detail' });
    if (selected) detail.append(renderDetail(selected));
    layout.append(list, detail);
    panel.append(layout);
  };

  const renderDetail = (r: ProcessRecord): HTMLElement => {
    const wrap = h('div', {});
    wrap.append(
      h('section', { class: 'section' },
        h('div', { style: 'display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap' },
          h('div', {}, h('h3', { style: 'margin-bottom:4px' }, r.batchCode), h('p', { class: 'field-hint' }, `${r.layoutName} · ${new Date(r.createdAt).toLocaleString()}`)),
          h('div', { class: 'btn-row' },
            button('导出 JSON', () => downloadJson(`${r.batchCode}-process-record.json`, r), 'primary'),
            button('保存当前推演到记录', () => void attachCurrentResult(r)),
          ),
        ),
        h('dl', { class: 'kv', style: 'margin-top:12px' },
          kv('钢种', r.steel), kv('类型', r.kind),
          kv('摆放快照', `${r.layoutSnapshot.length} 点`),
          kv('最低冷速', `${r.summary.minRate85.toFixed(4)} ℃/s`),
          kv('仿真不合格', `${r.summary.failedCount} 件`),
          kv('工艺备注', r.summary.note),
        ),
      ),
    );

    const compared = store.data.records.filter((x) => compare.has(x.id));
    const series = compared.map((x, i) => {
      if (x.historyCurve) {
        return {
          name: x.batchCode,
          color: ['#0f766e', '#2563eb', '#f97316', '#dc2626'][i % 4],
          points: x.historyCurve.times.map((t, j) => [t, x.historyCurve!.avgC[j]] as [number, number]),
        };
      }
      if (x.id === 'record-current' && store.result) {
        const points: [number, number][] = [];
        const frames = store.result.times.length;
        for (let f = 0; f < frames; f += 5) {
          let sum = 0;
          for (let p = 0; p < store.result.pieceIds.length; p++) sum += store.result.avg[p * frames + f];
          points.push([store.result.times[f], sum / store.result.pieceIds.length]);
        }
        return { name: `${x.batchCode} 当前推演`, color: '#dc2626', points };
      }
      return { name: x.batchCode, color: '#94a3b8', points: [] as [number, number][] };
    });
    wrap.append(h('section', { class: 'section' }, h('h3', {}, '同钢种 / 同截面冷速对比'), lineChart(series, { yMin: 0, yMax: 900 })));

    wrap.append(
      h('section', { class: 'section' },
        h('h3', {}, `实测硬度（${r.hardness.length} 点）`),
        hardnessForm(r),
        h('div', { class: 'table-wrap', style: 'margin-top:12px;max-height:360px' },
          h('table', { class: 'data-table' },
            h('thead', {}, h('tr', {}, h('th', {}, '件号'), h('th', {}, 'X'), h('th', {}, 'Z'), h('th', {}, 'HB'), h('th', {}, '判定'))),
            h('tbody', {}, ...r.hardness.map((x) => h('tr', {},
              h('td', {}, x.code), h('td', {}, x.x.toFixed(1)), h('td', {}, x.z.toFixed(1)), h('td', {}, String(x.hb)),
              h('td', {}, badge(x.pass ? '合格' : '低点', x.pass ? 'ok' : 'bad')),
            ))),
          ),
        ),
      ),
    );
    return wrap;
  };

  const hardnessForm = (r: ProcessRecord): HTMLElement => {
    let code = `HB-${r.hardness.length + 1}`;
    let x = 0;
    let z = 0;
    let hb = 150;
    return h('div', { class: 'grid-3' },
      field('件号/点号', h('input', { class: 'input', defaultValue: code, onchange: (e: Event) => { code = (e.target as HTMLInputElement).value; } })),
      field('X m', numInput(0, .1, (v) => { x = v; })),
      field('Z m', numInput(0, .1, (v) => { z = v; })),
      field('硬度 HB', numInput(150, 1, (v) => { hb = v; })),
      h('div', { style: 'display:flex;align-items:flex-end' }, button('追加实测记录', () => {
        r.hardness.unshift({ id: uid('hb'), code, x, z, hb, pass: hb >= 145 });
        void persist.records(store.data.records);
        toast('硬度记录已挂到该批次');
        render();
      }, 'primary')),
    );
  };

  const attachCurrentResult = async (r: ProcessRecord): Promise<void> => {
    if (!store.result) {
      toast('请先在冷却推演页运行仿真');
      return;
    }
    const rates = [...store.result.byId.values()].map((x) => x.rate85);
    r.summary.failedCount = [...store.result.byId.values()].filter((x) => x.failed).length;
    r.summary.minRate85 = Math.min(...rates);
    r.summary.durationSec = store.result.durationSec;
    r.layoutSnapshot = store.data.forgings.map((f) => ({ x: f.position.x, z: f.position.z, code: f.code }));
    await persist.records(store.data.records);
    store.emit('data');
    toast('推演摘要和摆放快照已挂接');
    render();
  };

  const unsub = store.subscribe((event) => {
    if (event === 'page' || event === 'data' || event === 'result') render();
  });
  render();
  return unsub;
};

const kv = (k: string, v: string): [HTMLElement, HTMLElement] => [h('dt', {}, k), h('dd', {}, v)];
