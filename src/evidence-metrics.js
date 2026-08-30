function validateFrames(baseline, candidate, width, height) {
  const expected = width * height * 4;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error('Frame dimensions must be positive integers.');
  if (baseline.length !== expected || candidate.length !== expected) throw new Error(`Expected ${expected} RGBA bytes per frame.`);
}

function foreground(data, offset) {
  return data[offset] !== 0 || data[offset + 1] !== 0 || data[offset + 2] !== 0;
}

function rounded(value) {
  return Math.round(value * 1e6) / 1e6;
}

export function compareBeautyPixels(baseline, candidate, width, height) {
  validateFrames(baseline, candidate, width, height);
  let changedPixelCount = 0;
  let absoluteRgbDelta = 0;
  let maximumChannelDelta = 0;
  for (let offset = 0; offset < baseline.length; offset += 4) {
    let changed = false;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(baseline[offset + channel] - candidate[offset + channel]);
      absoluteRgbDelta += delta;
      maximumChannelDelta = Math.max(maximumChannelDelta, delta);
      if (delta !== 0) changed = true;
    }
    if (baseline[offset + 3] !== candidate[offset + 3]) changed = true;
    if (changed) changedPixelCount += 1;
  }
  const pixelCount = width * height;
  return {
    width,
    height,
    pixelCount,
    changedPixelCount,
    changedFraction: rounded(changedPixelCount / pixelCount),
    meanAbsoluteRgbDelta: rounded(absoluteRgbDelta / (pixelCount * 3 * 255)),
    maximumChannelDelta,
  };
}

export function compareMaskPixels(baseline, candidate, width, height) {
  validateFrames(baseline, candidate, width, height);
  const diff = new Uint8ClampedArray(baseline.length);
  let baselineForeground = 0;
  let candidateForeground = 0;
  let intersection = 0;
  let union = 0;
  let added = 0;
  let removed = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    const before = foreground(baseline, offset);
    const after = foreground(candidate, offset);
    if (before) baselineForeground += 1;
    if (after) candidateForeground += 1;
    if (before && after) intersection += 1;
    if (before || after) union += 1;
    let color = [0, 0, 0, 0];
    if (!before && after) { added += 1; color = [0, 200, 255, 255]; }
    else if (before && !after) { removed += 1; color = [255, 0, 180, 255]; }
    else if (before && after) color = [90, 90, 90, 255];
    diff.set(color, offset);
    if (before !== after) {
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const changed = added + removed;
  return {
    metrics: {
      width,
      height,
      baselineForeground,
      candidateForeground,
      foregroundDelta: candidateForeground - baselineForeground,
      intersection,
      union,
      iou: union === 0 ? 1 : rounded(intersection / union),
      addedPixels: added,
      removedPixels: removed,
      changedPixels: changed,
      changedFraction: rounded(changed / (width * height)),
      changedBounds: changed === 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    },
    diff,
  };
}
