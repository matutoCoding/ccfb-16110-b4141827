import { autoLayout, defaultCoolingArea } from '../../core/layout';
import { uid } from '../../core/format';
import type { Batch, Forging, LayoutPattern, ShapeKind } from '../../core/types';
import { store } from '../../state/store';
import { runSimulation } from '../../state/simulation_actions';
import { button, field, h, numInput, selectInput, panelTitle } from '../dom';
import { toast } from '../toast';
import { idbClear } from '../../db/database';

export const mountBatchesPage = (panel: HTMLElement, dock: HTMLElement): (() => void) => {
  const render = (): void => {
    panel.replaceChildren();
    const d = store.data;
    panel.append(panelTitle('锻件批次', '按法兰、齿圈和轴类参数化截面，批量自动排位，也可以在场地中手动拖动。'));

    panel.append(
      h('section', { class: 'section' },
        h('h3', {}, '性能与演示数据'),
        h('p', { class: 'field-hint' }, `当前场景共有 ${d.forgings.length} 件锻件。验收目标为 300 件同屏发光时 1080p ≥ 45 FPS。`),
        h('div', { class: 'btn-row' },
          button(d.forgings.length >= 300 ? '已达到 300 件' : '一键补足到 300 件压测', () => void addStressPieces(), 'primary'),
          button('重新运行推演', () => void runSimulation()),
          button('重置内置演示', () => {
            if (confirm('确定清空 IndexedDB 并重新生成 200 件演示数据？')) {
              void idbClear().then(() => location.reload());
            }
          }, 'danger'),
        ),
      ),
    );

    const batch = d.batches[0];
    if (batch) panel.append(batchEditor(batch));

    const selectedF = d.forgings.find((f) => f.id === store.selectedForgingId);
    if (selectedF) panel.append(forgingInspector(selectedF));

    panel.append(
      h('section', { class: 'section' },
        h('h3', {}, `锻件清单（显示前 120 件）`),
        h('div', { class: 'list' },
          ...d.forgings.slice(0, 120).map((f) => h('button', {
            class: `list-item ${store.selectedForgingId === f.id ? 'active' : ''}`,
            onclick: () => store.select('forging', f.id),
          }, h('strong', {}, f.code), h('span', {}, `${f.kind} · ${f.steel} · (${f.position.x.toFixed(1)}, ${f.position.z.toFixed(1)})`))),
        ),
      ),
    );

    dock.replaceChildren(
      h('div', { class: 'timeline-row' },
        h('strong', {}, '批次规则'),
        h('span', { style: 'color:#64748b' }, '网格/错列适合密集堆场，环形排位适合圆形齿圈；间距修改后请点击“按规则重新排位”。'),
      ),
    );
  };

  const batchEditor = (b: Batch): HTMLElement => {
    const sec = h('section', { class: 'section' }, h('h3', {}, b.code));
    const update = (patch: Partial<Batch>): void => {
      Object.assign(b, patch);
    };
    sec.append(
      field('批次号', h('input', { class: 'input', value: b.code, onchange: (e: Event) => update({ code: (e.target as HTMLInputElement).value }) })),
      h('div', { class: 'grid-2' },
        field('钢种 / CCT', selectInput(b.steel, [['Q355E', 'Q355E'], ['42CrMo4', '42CrMo4'], ['45#', '45#']], (steel) => update({ steel }))),
        field('类型', selectInput<ShapeKind>(b.kind, [['flange', '法兰'], ['ring', '齿圈'], ['shaft', '轴类']], (kind) => update({ kind }))),
        field('数量', numInput(b.count, 1, (v) => update({ count: Math.round(v) }))),
        field('出炉温度 ℃', numInput(b.dischargeTempC, 10, (v) => update({ dischargeTempC: v }))),
        field('X 向中心距 m', numInput(b.spacingX, .1, (v) => update({ spacingX: v }))),
        field('Z 向中心距 m', numInput(b.spacingZ, .1, (v) => update({ spacingZ: v }))),
      ),
      field('码放规则', selectInput<LayoutPattern>(b.pattern, [['grid', '矩阵网格'], ['staggered', '错列密码'], ['ring', '同心圆环']], (pattern) => update({ pattern }))),
      h('h3', { style: 'margin-top:16px' }, '截面参数 m'),
      h('div', { class: 'grid-2' },
        field('外径', numInput(b.dims.outerDiameter ?? 2.8, .1, (v) => { b.dims.outerDiameter = v; })),
        field('内径', numInput(b.dims.innerDiameter ?? 2.2, .1, (v) => { b.dims.innerDiameter = v; })),
        field('厚度/高度', numInput(b.dims.height ?? .55, .05, (v) => { b.dims.height = v; })),
        field('轴直径', numInput(b.dims.diameter ?? .8, .05, (v) => { b.dims.diameter = v; })),
        field('轴长度', numInput(b.dims.length ?? 4, .1, (v) => { b.dims.length = v; })),
      ),
      h('div', { class: 'btn-row' },
        button('保存批次', async () => { await store.save('batches'); toast('批次参数已保存'); }, 'primary'),
        button('按规则重新排位', () => void relayout(b)),
      ),
    );
    return sec;
  };

  const forgingInspector = (f: Forging): HTMLElement =>
    h('section', { class: 'section' },
      h('h3', {}, f.code),
      h('div', { class: 'grid-2' },
        field('X m', numInput(f.position.x, .1, (v) => { f.position.x = v; void store.save('forgings'); })),
        field('Z m', numInput(f.position.z, .1, (v) => { f.position.z = v; void store.save('forgings'); })),
        field('出炉温度', numInput(f.dischargeTempC, 10, (v) => { f.dischargeTempC = v; void store.save('forgings'); })),
        field('旋转 °', numInput(Math.round(f.rotation * 180 / Math.PI), 1, (v) => { f.rotation = v * Math.PI / 180; void store.save('forgings'); })),
      ),
    );

  const relayout = async (b: Batch): Promise<void> => {
    const area = defaultCoolingArea(store.data.site.width, store.data.site.depth);
    const positions = autoLayout(b.count, b.kind, b.dims, b.spacingX, b.spacingZ, b.pattern, area);
    const old = store.data.forgings.filter((f) => f.batchId === b.id);
    const next: Forging[] = positions.map((p, i) => {
      const existing = old[i];
      return existing
        ? { ...existing, position: { x: p.x, z: p.z }, row: p.row, col: p.col, rotation: p.rotation }
        : {
            id: uid('f'), batchId: b.id, code: `${b.code}-${String(i + 1).padStart(3, '0')}`,
            kind: b.kind, steel: b.steel, dims: { ...b.dims, height: b.dims.height ?? .55 },
            dischargeTempC: b.dischargeTempC, dischargeAt: b.dischargeAt,
            position: { x: p.x, z: p.z }, rotation: p.rotation, row: p.row, col: p.col,
          };
    });
    store.data.forgings = [...store.data.forgings.filter((f) => f.batchId !== b.id), ...next];
    b.count = next.length;
    await Promise.all([store.save('forgings'), store.save('batches')]);
    store.emit('data');
    toast(`已按${b.pattern === 'grid' ? '网格' : b.pattern === 'staggered' ? '错列' : '圆环'}规则排位 ${next.length} 件`);
    void runSimulation();
  };

  const addStressPieces = async (): Promise<void> => {
    const need = Math.max(0, 300 - store.data.forgings.length);
    if (!need) {
      toast('已经有 300 件，可以直接观察 FPS');
      return;
    }
    let batch = store.data.batches.find((b) => b.id === 'batch-stress-100');
    if (!batch) {
      batch = {
        id: 'batch-stress-100', code: 'STRESS-300', steel: 'Q355E', kind: 'flange',
        dims: { outerDiameter: 2.8, innerDiameter: 2.18, height: .55 }, count: 0,
        spacingX: 3.25, spacingZ: 3.3, pattern: 'grid', dischargeTempC: 830,
        dischargeAt: new Date().toISOString(), createdAt: new Date().toISOString(), note: '性能压测批次',
      };
      store.data.batches.push(batch);
    }
    const addCount = Math.min(need, 100);
    for (let i = 0; i < addCount; i++) {
      const row = Math.floor(i / 34);
      const col = i % 34;
      store.data.forgings.push({
        id: uid('stress'), batchId: batch.id, code: `ST-${String(store.data.forgings.length + 1).padStart(3, '0')}`,
        kind: 'flange', steel: 'Q355E', dims: { outerDiameter: 2.8, innerDiameter: 2.18, height: .55 },
        dischargeTempC: 830, dischargeAt: batch.dischargeAt,
        position: { x: -53 + col * 3.25, z: -14.2 - row * 3.35 }, rotation: 0, row, col,
      });
    }
    batch.count = store.data.forgings.filter((f) => f.batchId === batch!.id).length;
    await Promise.all([store.save('forgings'), store.save('batches')]);
    store.emit('data');
    toast(`已补足 ${addCount} 件，当前 ${store.data.forgings.length} 件`);
    void runSimulation();
  };

  const unsub = store.subscribe((event) => {
    if (event === 'data' || event === 'selection' || event === 'page') render();
  });
  render();
  return unsub;
};
