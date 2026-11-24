import { h } from './dom';

export const toast = (message: string): void => {
  let wrap = document.querySelector<HTMLElement>('.toast-wrap');
  if (!wrap) {
    wrap = h('div', { class: 'toast-wrap' });
    document.body.append(wrap);
  }
  const el = h('div', { class: 'toast' }, message);
  wrap.append(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-6px)';
    setTimeout(() => el.remove(), 220);
  }, 2600);
};
