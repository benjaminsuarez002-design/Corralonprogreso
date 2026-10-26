import { readFile } from 'node:fs/promises';

export async function loadArticlePager() {
  const source = await readFile(new URL('../corralon-system.js', import.meta.url), 'utf8');
  const start = source.indexOf('  const ARTICLE_OPTION_PAGER = (() => {');
  const end = source.indexOf('  const WEB_VERSION_NOTIFIER =', start);
  if (start < 0 || end < 0) throw new Error('No se encontró el paginador compartido');
  return Function(`${source.slice(start, end)}; return ARTICLE_OPTION_PAGER;`)();
}
