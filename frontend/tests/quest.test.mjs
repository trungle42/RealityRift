import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import ts from 'typescript';

const source = ts.transpileModule(await readFile(new URL('../src/adventure/quest.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const Q = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('a well-formed verify response is accepted and the seen text is cut', () => {
  assert.deepEqual(Q.parseVerifyResponse({ match: true, seen: ' a book ', source: 'gemini' }), { match: true, seen: 'a book', source: 'gemini' });
  assert.equal(Q.parseVerifyResponse({ match: false, seen: 'x'.repeat(200), source: 'fallback' }).seen.length, 80);
});

test('missing seen is allowed, anything else malformed is rejected', () => {
  assert.equal(Q.parseVerifyResponse({ match: true, source: 'fallback' }).seen, '');
  for (const bad of [null, 'yes', {}, { match: 'true', source: 'gemini' }, { match: true, source: 'other' }, { seen: 'a', source: 'gemini' }]) assert.equal(Q.parseVerifyResponse(bad), undefined);
});
