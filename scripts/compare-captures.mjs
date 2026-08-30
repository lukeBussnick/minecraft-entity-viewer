import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createViewerServer } from '../server.mjs';
import { fixedViews } from '../src/capture-options.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const wantsJson = args.includes('--json');
let stage = 'parse-options';
let outputPath;
let outputPrepared = false;

class CompareError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function parseArgs() {
  const values = new Map();
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--json') { json = true; continue; }
    if (token === '--help' || token === '-h') return { help: true, json };
    if (!['--baseline', '--candidate', '--out', '--views'].includes(token)) throw new CompareError('UNKNOWN_OPTION', `Unknown option: ${token}`);
    if (values.has(token)) throw new CompareError('DUPLICATE_OPTION', `Option ${token} may be provided only once.`);
    const next = args[index + 1];
    if (!next || next.startsWith('--')) throw new CompareError('MISSING_OPTION_VALUE', `Option ${token} requires a value.`);
    values.set(token, next); index += 1;
  }
  if (!values.get('--baseline') || !values.get('--candidate')) throw new CompareError('CAPTURES_REQUIRED', '--baseline and --candidate capture directories are required.');
  const baseline = path.resolve(values.get('--baseline'));
  const candidate = path.resolve(values.get('--candidate'));
  const out = path.resolve(values.get('--out') || path.join(path.dirname(candidate), 'comparisons', `${path.basename(baseline)}-to-${path.basename(candidate)}`));
  if (out === ROOT || out === path.parse(out).root) throw new CompareError('UNSAFE_OUTPUT', 'Comparison output must not be the viewer root or a filesystem root.');
  const views = (values.get('--views') || fixedViews.join(',')).split(',').map(value => value.trim()).filter(Boolean);
  if (!views.length || views.some(view => !fixedViews.includes(view))) throw new CompareError('INVALID_VIEWS', `Views must come from: ${fixedViews.join(', ')}`);
  return { help: false, baseline, candidate, out, views, json };
}

function usage() {
  return 'Usage: npm run compare -- --baseline <capture-dir> --candidate <capture-dir> [--out <new-empty-dir>] [--views <list>] [--json]';
}

async function prepareOutput(directory) {
  try {
    const info = await stat(directory);
    if (!info.isDirectory()) throw new CompareError('OUTPUT_NOT_DIRECTORY', `Output path is not a directory: ${directory}`);
    if ((await readdir(directory)).length) throw new CompareError('OUTPUT_NOT_EMPTY', `Output directory is not empty: ${directory}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await mkdir(directory, { recursive: true });
  }
}

function hash(buffer) { return createHash('sha256').update(buffer).digest('hex').toUpperCase(); }

async function imageComparison(page, baselineBytes, candidateBytes, mode) {
  return page.evaluate(async ({ baseline, candidate, mode }) => {
    const load = source => new Promise((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = source;
    });
    const [before, after] = await Promise.all([load(baseline), load(candidate)]);
    if (before.width !== after.width || before.height !== after.height) throw new Error(`Image dimensions differ: ${before.width}x${before.height} versus ${after.width}x${after.height}`);
    const canvas = document.createElement('canvas'); canvas.width = before.width; canvas.height = before.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(before, 0, 0); const beforePixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(after, 0, 0); const afterPixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const metricsModule = await import('/src/evidence-metrics.js');
    if (mode === 'beauty') return { metrics: metricsModule.compareBeautyPixels(beforePixels, afterPixels, canvas.width, canvas.height) };
    const result = metricsModule.compareMaskPixels(beforePixels, afterPixels, canvas.width, canvas.height);
    context.putImageData(new ImageData(result.diff, canvas.width, canvas.height), 0, 0);
    return { metrics: result.metrics, diffDataUrl: canvas.toDataURL('image/png') };
  }, {
    baseline: `data:image/png;base64,${baselineBytes.toString('base64')}`,
    candidate: `data:image/png;base64,${candidateBytes.toString('base64')}`,
    mode,
  });
}

async function run() {
  const options = parseArgs();
  if (options.help) return { help: true, json: options.json };
  outputPath = options.out;
  const log = message => { if (!options.json) console.log(message); };
  stage = 'load-manifests';
  let baselineManifest, candidateManifest;
  try {
    baselineManifest = JSON.parse(await readFile(path.join(options.baseline, 'capture-manifest.json'), 'utf8'));
    candidateManifest = JSON.parse(await readFile(path.join(options.candidate, 'capture-manifest.json'), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') throw new CompareError('MANIFEST_REQUIRED', 'Both capture directories must contain capture-manifest.json.');
    throw error;
  }
  if (baselineManifest.status !== 'success' || candidateManifest.status !== 'success') throw new CompareError('INVALID_MANIFEST', 'Both capture manifests must have status success.');
  const missingView = options.views.find(view => !baselineManifest.options?.views?.includes(view) || !candidateManifest.options?.views?.includes(view));
  if (missingView) throw new CompareError('MISSING_VIEW', `View ${missingView} is not present in both capture manifests.`);
  if (baselineManifest.viewer?.version !== candidateManifest.viewer?.version) throw new CompareError('VIEWER_VERSION_MISMATCH', 'Captures must use the same viewer version for numeric comparison.');
  if (JSON.stringify(baselineManifest.options?.camera) !== JSON.stringify(candidateManifest.options?.camera)) throw new CompareError('CAMERA_MISMATCH', 'Captures must use identical camera settings for numeric comparison.');

  stage = 'prepare-output';
  await prepareOutput(options.out); outputPrepared = true;
  const server = createViewerServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  let browser;
  try {
    stage = 'launch-browser';
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/?capture=1`, { waitUntil: 'networkidle' });
    const warnings = [];
    const views = {};
    for (const view of options.views) {
      stage = `compare-${view}`;
      const beforeBeauty = await readFile(path.join(options.baseline, `${view}.png`));
      const afterBeauty = await readFile(path.join(options.candidate, `${view}.png`));
      const beauty = await imageComparison(page, beforeBeauty, afterBeauty, 'beauty');
      const result = {
        beauty: beauty.metrics,
        artifacts: {
          baselineBeautySha256: hash(beforeBeauty),
          candidateBeautySha256: hash(afterBeauty),
        },
      };
      try {
        const beforeMask = await readFile(path.join(options.baseline, `${view}.mask.png`));
        const afterMask = await readFile(path.join(options.candidate, `${view}.mask.png`));
        const mask = await imageComparison(page, beforeMask, afterMask, 'mask');
        const diffBytes = Buffer.from(mask.diffDataUrl.split(',')[1], 'base64');
        await writeFile(path.join(options.out, `${view}.mask-diff.png`), diffBytes);
        result.mask = mask.metrics;
        result.artifacts.baselineMaskSha256 = hash(beforeMask);
        result.artifacts.candidateMaskSha256 = hash(afterMask);
        result.artifacts.maskDiff = { path: `${view}.mask-diff.png`, sha256: hash(diffBytes), bytes: diffBytes.length };
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        warnings.push({ code: 'MASKS_UNAVAILABLE', view, message: 'One or both mask files are missing; silhouette comparison was skipped.' });
      }
      views[view] = result;
      log(`Compared ${view}`);
    }
    const maskViews = Object.values(views).filter(view => view.mask);
    const report = {
      schemaVersion: 1,
      status: 'success',
      baseline: { directory: path.basename(options.baseline), source: baselineManifest.inputs, viewer: baselineManifest.viewer },
      candidate: { directory: path.basename(options.candidate), source: candidateManifest.inputs, viewer: candidateManifest.viewer },
      views,
      summary: {
        meanBeautyDelta: Math.round((Object.values(views).reduce((sum, view) => sum + view.beauty.meanAbsoluteRgbDelta, 0) / options.views.length) * 1e6) / 1e6,
        meanMaskIou: maskViews.length ? Math.round((maskViews.reduce((sum, view) => sum + view.mask.iou, 0) / maskViews.length) * 1e6) / 1e6 : null,
        changedSilhouetteViews: maskViews.filter(view => view.mask.changedPixels > 0).length,
      },
      warnings,
      interpretation: {
        beautyDelta: 'Exact rendered-pixel change; it does not distinguish geometry, texture, lighting, or camera causes.',
        maskIou: 'Exact same-camera silhouette overlap. It is evidence of contour change, not evidence that the change is better.',
      },
    };
    await writeFile(path.join(options.out, 'comparison.json'), `${JSON.stringify(report, null, 2)}\n`);
    return { status: 'success', outputDirectory: options.out, report: path.join(options.out, 'comparison.json'), summary: report.summary, warnings };
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

try {
  const result = await run();
  if (result.help) {
    if (wantsJson) console.log(JSON.stringify({ status: 'help', usage: usage() })); else console.log(usage());
  } else if (wantsJson) console.log(JSON.stringify(result));
  else console.log(`Comparison report saved to ${result.report}`);
} catch (error) {
  const failure = { schemaVersion: 1, status: 'failed', code: error.code || 'COMPARE_FAILED', stage, message: error.message };
  if (outputPrepared && outputPath) {
    try { await writeFile(path.join(outputPath, 'comparison-error.json'), `${JSON.stringify(failure, null, 2)}\n`); } catch {}
  }
  if (wantsJson) console.log(JSON.stringify(failure)); else console.error(`[${failure.code}] ${failure.message}`);
  process.exitCode = 1;
}
