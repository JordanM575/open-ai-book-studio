import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';

test('authoring source has only local pure imports and no send/write/timer/runtime primitives', () => {
  const directory = new URL('../../src/authoring/', import.meta.url);
  for (const file of readdirSync(directory).filter(file => file.endsWith('.ts'))) {
    const source = readFileSync(new URL(file, directory), 'utf8');
    for (const match of source.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)) {
      expect(match[1]?.startsWith('./')).toBe(true);
    }
    expect(source).not.toMatch(/\b(?:fetch|setTimeout|setInterval|require|eval|Function|import)\s*\(/);
    expect(source).not.toMatch(/\b(?:Bun|process|window|globalThis|navigator|Date)\s*\./);
  }
});
