import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createViewerServer } from '../server.mjs';
import { CaptureCliError, captureUsage, parseCaptureArgs } from '../src/capture-options.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawArgs = process.argv.slice(2);
const wantsJson = rawArgs.includes('--json');
let options;
let stage = 'parse-options';
let outputPrepared = false;

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

function errorCode(error) {
  if (error instanceof CaptureCliError) return error.code;
  if (stage === 'validate-inputs') return 'INPUT_READ_FAILED';
  if (stage === 'launch-browser') return 'BROWSER_LAUNCH_FAILED';
  if (stage === 'load-model') return 'MODEL_LOAD_FAILED';
  if (stage === 'select-geometry') return 'GEOMETRY_SELECTION_FAILED';
  return 'CAPTURE_FAILED';
}

async function prepareOutput(outputPath) {
  try {
    const info = await stat(outputPath);
    if (!info.isDirectory()) throw new CaptureCliError('OUTPUT_NOT_DIRECTORY', `Output path is not a directory: ${outputPath}`);
    const entries = await readdir(outputPath);
    if (entries.length) throw new CaptureCliError('OUTPUT_NOT_EMPTY', `Output directory is not empty: ${outputPath}. Use a new iteration directory.`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await mkdir(outputPath, { recursive: true });
  }
}

async function runCapture() {
  options = parseCaptureArgs(rawArgs, { root: ROOT });
  if (options.help) return { help: true };
  const log = message => { if (!options.json) console.log(message); };

  stage = 'validate-inputs';
  const modelBytes = await readFile(options.modelPath);
  const textureBytes = options.texturePath ? await readFile(options.texturePath) : null;
  const packageDocument = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const source = {
    modelSha256: sha256Buffer(modelBytes),
    textureSha256: textureBytes ? sha256Buffer(textureBytes) : null,
  };

  stage = 'prepare-output';
  await prepareOutput(options.outputPath);
  outputPrepared = true;
  const artifacts = [];
  async function writeArtifact(filename, data, kind, view = null) {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    await writeFile(path.join(options.outputPath, filename), buffer);
    artifacts.push({ path: filename, kind, ...(view ? { view } : {}), bytes: buffer.length, sha256: sha256Buffer(buffer) });
  }

  const server = createViewerServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  let browser;
  try {
    stage = 'launch-browser';
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const browserVersion = browser.version();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 1 });
    const browserMessages = [];
    const pageErrors = [];
    const httpErrors = [];
    page.on('console', message => {
      if (message.type() === 'error' || message.type() === 'warning') browserMessages.push({ level: message.type(), message: message.text() });
    });
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) httpErrors.push({ status: response.status(), url: response.url() }); });
    await page.goto(`http://127.0.0.1:${port}/?capture=1`, { waitUntil: 'networkidle' });

    stage = 'load-model';
    const files = [options.modelPath, ...(options.texturePath ? [options.texturePath] : [])];
    await page.setInputFiles('#file-input', files);
    try {
      await page.waitForFunction(() => document.body.dataset.modelLoaded === 'true', null, { timeout: 15000 });
    } catch (error) {
      const viewerStatus = await page.locator('#status').textContent();
      throw new CaptureCliError('MODEL_LOAD_FAILED', viewerStatus || error.message);
    }
    if (pageErrors.length) throw new CaptureCliError('VIEWER_PAGE_ERROR', pageErrors[0]);

    let selectedGeometry = null;
    if (options.geometry !== null) {
      stage = 'select-geometry';
      try {
        selectedGeometry = await page.evaluate(selector => window.__entityViewer.selectGeometry(selector), options.geometry);
      } catch (error) {
        throw new CaptureCliError('GEOMETRY_SELECTION_FAILED', error.message);
      }
    }
    const metadata = await page.evaluate(() => window.__entityViewer.metadata);
    const geometryNames = await page.evaluate(() => window.__entityViewer.geometryNames);
    const warnings = await page.evaluate(() => window.__entityViewer.warnings);
    const camera = await page.evaluate(config => window.__entityViewer.configureCapture(config), {
      ...(options.perspectiveDirection ? { perspectiveDirection: options.perspectiveDirection } : {}),
      ...(options.perspectiveFov !== null ? { perspectiveFov: options.perspectiveFov } : {}),
    });

    stage = 'render-views';
    for (const view of options.views) {
      const dataUrl = await page.evaluate(selected => window.__entityViewer.captureDataUrl(selected), view);
      await writeArtifact(`${view}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'), 'beauty', view);
      if (options.evidence.masks) {
        const maskUrl = await page.evaluate(selected => window.__entityViewer.captureMaskDataUrl(selected), view);
        await writeArtifact(`${view}.mask.png`, Buffer.from(maskUrl.split(',')[1], 'base64'), 'mask', view);
      }
      if (options.evidence.clay) {
        const clayUrl = await page.evaluate(selected => window.__entityViewer.captureClayDataUrl(selected), view);
        await writeArtifact(`${view}.clay.png`, Buffer.from(clayUrl.split(',')[1], 'base64'), 'clay', view);
      }
      if (options.evidence.parts) {
        const partUrl = await page.evaluate(selected => window.__entityViewer.capturePartDataUrl(selected), view);
        await writeArtifact(`${view}.parts.png`, Buffer.from(partUrl.split(',')[1], 'base64'), 'parts', view);
      }
      if (options.evidence.surfaceBoundaries) {
        const boundary = await page.evaluate(selected => window.__entityViewer.captureSurfaceBoundaries(selected), view);
        await writeArtifact(`${view}.surface-boundaries.json`, `${JSON.stringify({ ...boundary, source }, null, 2)}\n`, 'surface-boundaries', view);
      }
      log(`Saved evidence for ${view}`);
    }

    const sheetUrl = await page.evaluate(views => window.__entityViewer.contactSheetDataUrl(views), options.views);
    await writeArtifact('contact-sheet.png', Buffer.from(sheetUrl.split(',')[1], 'base64'), 'contact-sheet');
    if (options.evidence.parts) {
      const legend = await page.evaluate(() => window.__entityViewer.partLegend());
      await writeArtifact('part-legend.json', `${JSON.stringify(legend, null, 2)}\n`, 'part-legend');
    }
    if (options.evidence.surfaceBoundaries) {
      const surfaceInfo = {
        schemaVersion: 1,
        model: path.basename(options.modelPath),
        texture: options.texturePath ? path.basename(options.texturePath) : null,
        source,
        views: options.views,
      };
      await writeArtifact('surface-capture-info.json', `${JSON.stringify(surfaceInfo, null, 2)}\n`, 'surface-capture-info');
    }
    const consoleError = browserMessages.find(item => item.level === 'error');
    if (consoleError) throw new CaptureCliError('VIEWER_CONSOLE_ERROR', consoleError.message);
    if (httpErrors.length) throw new CaptureCliError('VIEWER_HTTP_ERROR', `HTTP ${httpErrors[0].status}: ${httpErrors[0].url}`);

    const renderInfo = {
      schemaVersion: 2,
      model: path.basename(options.modelPath),
      texture: options.texturePath ? path.basename(options.texturePath) : null,
      views: options.views,
      masks: options.evidence.masks,
      clay: options.evidence.clay,
      parts: options.evidence.parts,
      surfaceBoundaries: options.evidence.surfaceBoundaries,
      camera,
      metadata,
      source,
      warnings,
      geometryNames,
      selectedGeometry: selectedGeometry ?? { index: geometryNames.indexOf(metadata.name), name: metadata.name },
    };
    await writeArtifact('render-info.json', `${JSON.stringify(renderInfo, null, 2)}\n`, 'render-info');

    const structuredWarnings = [
      ...warnings.map(message => ({
        code: message.startsWith('No texture') ? 'NO_TEXTURE' : message.startsWith('This project declares multiple textures') ? 'MULTIPLE_TEXTURES' : 'VIEWER_WARNING',
        level: 'warning',
        message,
      })),
      ...browserMessages.filter(item => item.level === 'warning').map(item => ({ code: 'BROWSER_WARNING', ...item })),
    ];
    const manifest = {
      schemaVersion: 1,
      status: 'success',
      viewer: { name: packageDocument.name, version: packageDocument.version },
      inputs: {
        model: { name: path.basename(options.modelPath), sha256: source.modelSha256 },
        texture: options.texturePath ? { name: path.basename(options.texturePath), sha256: source.textureSha256 } : null,
        geometry: renderInfo.selectedGeometry,
      },
      options: { views: options.views, evidence: options.evidence, camera },
      model: metadata,
      warnings: structuredWarnings,
      runtime: { node: process.version, browser: browserVersion },
      outputs: { directory: path.basename(options.outputPath), artifacts: [...artifacts].sort((left, right) => left.path.localeCompare(right.path)) },
      proofBoundary: {
        supports: ['static cube geometry', 'bone and cube transforms', 'UV placement', 'texture pixels', 'silhouette', 'visible part ownership'],
        requiresMinecraft: ['animations', 'render controllers', 'Molang', 'entity scaling', 'materials and emissive effects', 'in-game lighting', 'attachment and gameplay behavior'],
      },
    };
    await writeFile(path.join(options.outputPath, 'capture-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    log(`Capture manifest saved to ${path.join(options.outputPath, 'capture-manifest.json')}`);
    return { status: 'success', outputDirectory: options.outputPath, manifest: path.join(options.outputPath, 'capture-manifest.json'), source, warnings: manifest.warnings };
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

try {
  const result = await runCapture();
  if (result.help) {
    if (wantsJson) console.log(JSON.stringify({ status: 'help', usage: captureUsage() }));
    else console.log(captureUsage());
  } else if (wantsJson) console.log(JSON.stringify(result));
} catch (error) {
  const failure = { schemaVersion: 1, status: 'failed', code: errorCode(error), stage, message: error.message };
  if (outputPrepared && options?.outputPath) {
    try { await writeFile(path.join(options.outputPath, 'capture-error.json'), `${JSON.stringify(failure, null, 2)}\n`); } catch {}
  }
  if (wantsJson) console.log(JSON.stringify(failure));
  else console.error(`[${failure.code}] ${failure.message}`);
  process.exitCode = 1;
}
