export type Child = Node | string | number | false | null | undefined | Child[];

export const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class' || key === 'className') el.className = String(value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'html') el.innerHTML = String(value);
    else if (key in el && key !== 'list') {
      try {
        (el as unknown as Record<string, unknown>)[key] = value;
      } catch {
        el.setAttribute(key, String(value));
      }
    } else el.setAttribute(key, String(value));
  }
  const appendChild = (child: Child): void => {
    if (Array.isArray(child)) {
      child.forEach(appendChild);
      return;
    }
    if (child === false || child === null || child === undefined) return;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  };
  children.forEach(appendChild);
  return el;
};

export const clear = (el: HTMLElement): void => {
  el.replaceChildren();
};

export const field = (label: string, input: HTMLElement, hint?: string): HTMLElement =>
  h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('small', { class: 'field-hint' }, hint) : null);

export const numInput = (value: number, step = 1, oninput?: (v: number) => void): HTMLInputElement =>
  h('input', {
    class: 'input',
    type: 'number',
    value: String(value),
    step: String(step),
    onchange: (e: Event) => oninput?.(Number((e.target as HTMLInputElement).value)),
  }) as HTMLInputElement;

export const selectInput = <T extends string>(value: T, options: [T, string][], onchange: (v: T) => void): HTMLSelectElement =>
  h(
    'select',
    { class: 'input', onchange: (e: Event) => onchange((e.target as HTMLSelectElement).value as T) },
    ...options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)),
  ) as HTMLSelectElement;

export const button = (label: string, onclick: () => void, variant: 'primary' | 'ghost' | 'danger' = 'ghost'): HTMLButtonElement =>
  h('button', { class: `btn btn-${variant}`, type: 'button', onclick }, label);

export const badge = (text: string, tone: 'ok' | 'bad' | 'warn' | 'neutral' = 'neutral'): HTMLElement =>
  h('span', { class: `badge badge-${tone}` }, text);

export const panelTitle = (title: string, sub?: string): HTMLElement =>
  h('div', { class: 'panel-title' }, h('h2', {}, title), sub ? h('p', {}, sub) : null);

export const switchRow = (label: string, control: HTMLElement): HTMLElement =>
  h('div', { class: 'switch-row' }, h('span', {}, label), control);
