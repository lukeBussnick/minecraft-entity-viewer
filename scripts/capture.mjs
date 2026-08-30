import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createViewerServer } from '../server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function value(flag) { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; }
function usage(code = 0) {
  console.log('Usage: npm run capture -- --model <file.bbmodel|file.geo.json> [--texture texture.png] [--out captures/name] [--views perspective,front,back,left,right,top,bottom] [--perspective-direction x,y,z] [--perspective-fov degrees] [--masks] [--clay] [--parts] [--surface-boundaries]');
  process.exit(code);
}
if (args.includes('--help') || args.includes('-h')) usage();

const model = value('--model');
if (!model) usage(1);
const modelPath = path.resolve(model);
const texture = value('--texture');
const output = path.resolve(value('--out') || path.join(ROOT, 'captures', path.basename(modelPath).replace(/\.geo\.json$|\.bbmodel$|\.json$/i, '')));
const views = (value('--views') || 'perspective,front,back,left,right,top,bottom').split(',').map(v => v.trim()).filter(Boolean);
const masks = args.includes('--masks');
const clay = args.includes('--clay');
const parts = args.includes('--parts');
const surfaceBoundaries = args.includes('--surface-boundaries');
const directionText = value('--perspective-direction');
const perspectiveDirection = directionText ? directionText.split(',').map(Number) : null;
if (perspectiveDirection && (perspectiveDirection.length !== 3 || perspectiveDirection.some(item => !Number.isFinite(item)) || Math.hypot(...perspectiveDirection) === 0)) throw new Error('--perspective-direction must be a finite nonzero x,y,z vector.');
const fovText = value('--perspective-fov');
const perspectiveFov = fovText === undefined ? null : Number(fovText);
if (perspectiveFov !== null && (!Number.isFinite(perspectiveFov) || perspectiveFov < 10 || perspectiveFov > 80)) throw new Error('--perspective-fov must be within 10..80 degrees.');
const validViews = new Set(['perspective','front','back','left','right','top','bottom']);
if (views.some(view => !validViews.has(view))) throw new Error(`Unknown view. Use: ${[...validViews].join(', ')}`);

await mkdir(output, { recursive: true });
async function sha256(file) { return createHash('sha256').update(await readFile(file)).digest('hex').toUpperCase(); }
const source = { modelSha256: await sha256(modelPath), textureSha256: texture ? await sha256(path.resolve(texture)) : null };
const server = createViewerServer();
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const port = server.address().port;
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 1 });
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') console.error(`Browser ${message.type()}: ${message.text()}`); });
  page.on('pageerror', error => console.error(`Browser error: ${error.message}`));
  page.on('response', response => { if (response.status() >= 400) console.error(`HTTP ${response.status()}: ${response.url()}`); });
  await page.goto(`http://127.0.0.1:${port}/?capture=1`, { waitUntil: 'networkidle' });
  const files = [modelPath, ...(texture ? [path.resolve(texture)] : [])];
  await page.setInputFiles('#file-input', files);
  try {
    await page.waitForFunction(() => document.body.dataset.modelLoaded === 'true', null, { timeout: 15000 });
  } catch (error) {
    console.error(`Viewer status: ${await page.locator('#status').textContent()}`);
    throw error;
  }
  const metadata = await page.evaluate(() => window.__entityViewer.metadata);
  const camera = await page.evaluate(config => window.__entityViewer.configureCapture(config), {
    ...(perspectiveDirection ? { perspectiveDirection } : {}),
    ...(perspectiveFov !== null ? { perspectiveFov } : {}),
  });
  for (const view of views) {
    const dataUrl = await page.evaluate(selected => window.__entityViewer.captureDataUrl(selected), view);
    await writeFile(path.join(output, `${view}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
    if (masks) {
      const maskUrl = await page.evaluate(selected => window.__entityViewer.captureMaskDataUrl(selected), view);
      await writeFile(path.join(output, `${view}.mask.png`), Buffer.from(maskUrl.split(',')[1], 'base64'));
    }
    if (clay) {
      const clayUrl = await page.evaluate(selected => window.__entityViewer.captureClayDataUrl(selected), view);
      await writeFile(path.join(output, `${view}.clay.png`), Buffer.from(clayUrl.split(',')[1], 'base64'));
    }
    if (parts) {
      const partUrl = await page.evaluate(selected => window.__entityViewer.capturePartDataUrl(selected), view);
      await writeFile(path.join(output, `${view}.parts.png`), Buffer.from(partUrl.split(',')[1], 'base64'));
    }
    if (surfaceBoundaries) {
      const boundary = await page.evaluate(selected => window.__entityViewer.captureSurfaceBoundaries(selected), view);
      await writeFile(path.join(output, `${view}.surface-boundaries.json`), `${JSON.stringify({ ...boundary, source }, null, 2)}\n`);
    }
    console.log(`Saved ${view}.png`);
  }
  const sheetUrl = await page.evaluate(() => window.__entityViewer.contactSheetDataUrl());
  await writeFile(path.join(output, 'contact-sheet.png'), Buffer.from(sheetUrl.split(',')[1], 'base64'));
  if (parts) {
    const legend = await page.evaluate(() => window.__entityViewer.partLegend());
    await writeFile(path.join(output, 'part-legend.json'), `${JSON.stringify(legend, null, 2)}\n`);
  }
  if (surfaceBoundaries) {
    await writeFile(path.join(output, 'surface-capture-info.json'), `${JSON.stringify({ schemaVersion: 1, model: modelPath, texture: texture ? path.resolve(texture) : null, source, views }, null, 2)}\n`);
  }
  await writeFile(path.join(output, 'render-info.json'), `${JSON.stringify({ model: modelPath, texture: texture ? path.resolve(texture) : null, views, masks, clay, parts, surfaceBoundaries, camera, metadata, source }, null, 2)}\n`);
  console.log(`Contact sheet and metadata saved to ${output}`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
