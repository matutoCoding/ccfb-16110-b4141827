import { uid } from '../../core/format';
import type { ScreenMaterial, SiteObject, SiteObjectType } from '../../core/types';
import { store } from '../../state/store';
import { scheduleSimulation } from '../../state/simulation_actions';
import { button, field, h, numInput, selectInput, panelTitle } from '../dom';
import { toast } from '../toast';

export const mountSitePage = (panel: HTMLElement, dock: HTMLElement): (() => void) => {
  const render = (): void => {
    panel.replaceChildren();
    const d = store.data;
    panel.append(panelTitle('场地布局', '按实测米制尺寸维护地坪、过道、隔热屏与风机；在画面中可直接拖动对象。'));

    panel.append(
      h('section', { class: 'section' },
        h('h3', {}, '场地尺寸'),
        h('div', { class: 'grid-2' },
          field('长度 m', numInput(d.site.width, 1, (v) => { d.site.width = v; void store.save('site'); })),
          field('进深 m', numInput(d.site.depth, 1, (v) => { d.site.depth = v; void store.save('site'); })),
        ),
        field('夏季环境温度 ℃', numInput(d.site.ambientC, 1, (v) => { d.site.ambientC = v; void store.save('site'); scheduleSimulation(); })),
      ),
    );

    const add = (type: SiteObjectType): void => {
      const base: SiteObject = {
        id: uid('obj'), type, name: typeLabel(type), x: 0, z: 0,
        width: type === 'screen' ? 12 : 4, depth: type === 'aisle' ? 4 : type === 'fan' ? 1.4 : 5,
        height: type === 'screen' ? 2.4 : type === 'station' ? 2.6 : 0.02,
        material: type === 'screen' ? 'aluminum' : undefined, yaw: 0,
      };
      d.objects.push(base);
      store.selectedObjectId = base.id;
      void store.save('objects').then(() => store.emit('data'));
      toast(`${base.name}已添加，可在场地中拖动`);
    };

    panel.append(
      h('section', { class: 'section' },
        h('h3', {}, '添加场地对象'),
        h('div', { class: 'btn-row' },
          button('隔热屏', () => add('screen'), 'primary'),
          button('风机', () => add('fan')),
          button('过道', () => add('aisle')),
          button('工位', () => add('station')),
        ),
      ),
    );

    const selected = d.objects.find((o) => o.id === store.selectedObjectId);
    if (selected) panel.append(inspector(selected));

    panel.append(
      h('section', { class: 'section' },
        h('h3', {}, `对象清单（${d.objects.length}）`),
        h('div', { class: 'list' },
          ...d.objects.map((o) => h('button', {
            class: `list-item ${store.selectedObjectId === o.id ? 'active' : ''}`,
            onclick: () => store.select('object', o.id),
          }, h('strong', {}, o.name), h('span', {}, `${typeLabel(o.type)} · (${o.x.toFixed(1)}, ${o.z.toFixed(1)}) · ${o.width}×${o.depth}m`))),
        ),
      ),
    );

    dock.replaceChildren(
      h('div', { class: 'timeline-row' },
        h('div', {}, h('strong', {}, '操作提示'), h('div', { style: 'color:#64748b' }, '左键空白旋转 · 右键/Shift 平移 · 滚轮缩放 · 拖动对象改位')),
        h('span', { class: 'badge badge-neutral' }, '改动自动写入 IndexedDB'),
      ),
    );
  };

  const inspector = (o: SiteObject): HTMLElement => {
    const sec = h('section', { class: 'section' }, h('h3', {}, '选中对象属性'));
    const update = (patch: Partial<SiteObject>): void => {
      Object.assign(o, patch);
      void store.save('objects');
      scheduleSimulation();
    };
    sec.append(
      field('名称', h('input', { class: 'input', value: o.name, onchange: (e: Event) => update({ name: (e.target as HTMLInputElement).value }) })),
      h('div', { class: 'grid-2' },
        field('X m', numInput(o.x, .1, (v) => update({ x: v }))),
        field('Z m', numInput(o.z, .1, (v) => update({ z: v }))),
        field('宽度 m', numInput(o.width, .1, (v) => update({ width: v }))),
        field('进深 m', numInput(o.depth, .1, (v) => update({ depth: v }))),
        field('高度 m', numInput(o.height, .1, (v) => update({ height: v }))),
        field('旋转 °', numInput(Math.round((o.rotation ?? 0) * 180 / Math.PI), 1, (v) => update({ rotation: v * Math.PI / 180 }))),
      ),
    );
    if (o.type === 'screen') {
      sec.append(
        field('隔热屏材质', selectInput<ScreenMaterial>(o.material ?? 'steel', [
          ['aluminum', '抛光铝板 ε≈0.18'],
          ['steel', '耐热钢板 ε≈0.58'],
          ['ceramic', '陶瓷纤维 ε≈0.88'],
          ['watercooled', '水冷屏 ε≈0.32'],
        ], (material) => update({ material }))),
        h('p', { class: 'field-hint' }, '材质与高度变化会立即重算可见性、人员热通量和相邻锻件辐射角系数。'),
      );
    }
    if (o.type === 'fan') {
      sec.append(field('吹风方向角 °', numInput(Math.round((o.yaw ?? 0) * 180 / Math.PI), 5, (v) => update({ yaw: v * Math.PI / 180 }))));
    }
    sec.append(h('div', { class: 'btn-row', style: 'margin-top:12px' },
      button('删除对象', () => {
        store.data.objects = store.data.objects.filter((x) => x.id !== o.id);
        store.selectedObjectId = undefined;
        void store.save('objects').then(() => store.emit('data'));
        scheduleSimulation();
      }, 'danger'),
    ));
    return sec;
  };

  const unsub = store.subscribe((event) => {
    if (event === 'data' || event === 'selection' || event === 'page') render();
  });
  render();
  return unsub;
};

const typeLabel = (t: SiteObjectType): string => ({
  screen: '隔热屏', fan: '风机', aisle: '过道', station: '工位', zone: '区域',
}[t]);
