// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps small analyzer text readable with valid class-token selectors', () => {
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  const block = css.match(/#document-analyzer-tab \[class~="text-\[8px\]"\][\s\S]*?\}/)?.[0];
  expect(block).toBeTruthy();
  const selectors = block!.slice(0, block!.indexOf('{')).trim();
  const container = document.createElement('div');
  container.id = 'document-analyzer-tab';
  container.innerHTML = ['8px', '9px', '10px', '11px', '12px'].map(size => `<span class="text-[${size}]">Text</span>`).join('');
  document.body.append(container);
  expect(document.querySelectorAll(selectors)).toHaveLength(4);
  expect(block).toMatch(/font-size:\s*12px/);
  container.remove();
});
