import test from 'node:test';
import assert from 'node:assert/strict';
import { compareBeautyPixels, compareMaskPixels } from '../src/evidence-metrics.js';

function frame(colors) {
  return new Uint8ClampedArray(colors.flatMap(color => [...color, 255]));
}

test('beauty comparison reports exact changed pixels and normalized delta', () => {
  const baseline = frame([[0, 0, 0], [10, 20, 30]]);
  const candidate = frame([[0, 0, 0], [20, 20, 30]]);
  assert.deepEqual(compareBeautyPixels(baseline, candidate, 2, 1), {
    width: 2, height: 1, pixelCount: 2, changedPixelCount: 1, changedFraction: 0.5,
    meanAbsoluteRgbDelta: 0.006536, maximumChannelDelta: 10,
  });
});

test('mask comparison separates added and removed silhouette pixels', () => {
  const black = [0, 0, 0], white = [255, 255, 255];
  const baseline = frame([white, black, white, black]);
  const candidate = frame([white, white, black, black]);
  const result = compareMaskPixels(baseline, candidate, 2, 2);
  assert.deepEqual(result.metrics, {
    width: 2, height: 2, baselineForeground: 2, candidateForeground: 2, foregroundDelta: 0,
    intersection: 1, union: 3, iou: 0.333333, addedPixels: 1, removedPixels: 1,
    changedPixels: 2, changedFraction: 0.5, changedBounds: { x: 0, y: 0, width: 2, height: 2 },
  });
});
