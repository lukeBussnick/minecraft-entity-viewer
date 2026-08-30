import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseCaptureArgs } from '../src/capture-options.js';

test('agent capture preset enables every diagnostic channel', () => {
  const parsed = parseCaptureArgs(['--model', 'mob.geo.json', '--agent', '--geometry', 'geometry.mob', '--json'], { root: 'C:/viewer' });
  assert.deepEqual(parsed.evidence, { masks: true, clay: true, parts: true, surfaceBoundaries: true });
  assert.equal(parsed.geometry, 'geometry.mob');
  assert.equal(parsed.json, true);
  assert.equal(parsed.modelPath, path.resolve('mob.geo.json'));
});

test('capture options reject duplicate views and unsafe output roots', () => {
  assert.throws(() => parseCaptureArgs(['--model', 'mob.geo.json', '--views', 'front,front']), error => error.code === 'DUPLICATE_VIEW');
  assert.throws(() => parseCaptureArgs(['--model', 'mob.geo.json', '--out', 'C:\\']), error => error.code === 'UNSAFE_OUTPUT');
});

test('capture options reject unknown flags with a stable code', () => {
  assert.throws(() => parseCaptureArgs(['--model', 'mob.geo.json', '--magic']), error => error.code === 'UNKNOWN_OPTION');
});
