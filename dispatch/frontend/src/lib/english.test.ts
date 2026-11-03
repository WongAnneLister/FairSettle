import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CJK = /[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/;
const src = fileURLToPath(new URL('..', import.meta.url));
const readme = fileURLToPath(new URL('../../README.md', import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return ['.ts', '.tsx', '.css', '.mjs'].includes(extname(path)) ? [path] : [];
  });
}

describe('English storefront', () => {
  it('storefront text is English only', () => {
    const files = [...sourceFiles(src), readme];
    expect(files.length).toBeGreaterThanOrEqual(30);
    const offenders = files.flatMap(file => readFileSync(file, 'utf8').split('\n')
      .flatMap((line, index) => CJK.test(line) ? [`${file}:${index + 1}`] : []));
    expect(offenders.slice(0, 20)).toEqual([]);
  });

  it('document language is English', () => {
    const layout = readFileSync(join(src, 'app/layout.tsx'), 'utf8');
    expect(layout).toContain('lang="en"');
    expect(layout).not.toContain('lang="zh');
  });
});
