import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveViewerPath } from '../server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('resolves viewer assets inside the project root', () => {
  assert.equal(resolveViewerPath('/'), path.join(ROOT, 'index.html'));
  assert.equal(resolveViewerPath('/src/app.js'), path.join(ROOT, 'src', 'app.js'));
});

test('rejects paths outside the project root', () => {
  assert.equal(resolveViewerPath('/../MinecraftEntityViewer-private/file.txt'), null);
  assert.equal(resolveViewerPath('/%2e%2e/MinecraftEntityViewer-private/file.txt'), null);
});
