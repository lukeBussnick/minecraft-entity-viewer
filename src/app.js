import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { buildModel, createPartColorLegend, parseModelDocument, setWireframe } from './model-builder.js';

if (new URLSearchParams(window.location.search).get('capture') === '1') document.body.classList.add('capture-mode');

const $ = selector => document.querySelector(selector);
const els = {
  canvas: $('#viewport'), viewport: $('#viewport-wrap'), workspace: $('#workspace'),
  fileInput: $('#file-input'), folderInput: $('#folder-input'), openFolder: $('#open-folder'), drop: $('#drop-zone'),
  geometry: $('#geometry-select'), texture: $('#texture-select'), info: $('#model-info'), warnings: $('#warnings'),
  viewButtons: $('#view-buttons'), viewLabel: $('#view-label'), grid: $('#grid-toggle'), wire: $('#wire-toggle'), axes: $('#axes-toggle'),
  frame: $('#frame-model'), empty: $('#empty-state'), status: $('#status'),
  referenceInput: $('#reference-input'), referenceImage: $('#reference-image'), referenceOverlay: $('#reference-overlay'),
  compareMode: $('#compare-mode'), opacity: $('#reference-opacity'), opacityValue: $('#opacity-value'),
  exportCurrent: $('#export-current'), exportSheet: $('#export-sheet'),
};

const renderer = new THREE.WebGLRenderer({ canvas: els.canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x171c22, 1);

const scene = new THREE.Scene();
const perspectiveCamera = new THREE.PerspectiveCamera(32, 1, 0.01, 10000);
const orthoCamera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.01, 10000);
let activeCamera = perspectiveCamera;
const controls = new OrbitControls(perspectiveCamera, els.canvas);
controls.enableDamping = true; controls.dampingFactor = .08;

scene.add(new THREE.HemisphereLight(0xffffff, 0x3d4a56, 2.25));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.2); keyLight.position.set(-30, 45, -50); scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x9fc8ff, 0.7); fillLight.position.set(40, 20, 35); scene.add(fillLight);
const grid = new THREE.GridHelper(200, 40, 0x607080, 0x303944); scene.add(grid);
const axes = new THREE.AxesHelper(12); axes.visible = false; scene.add(axes);

const state = {
  files: [], modelFile: null, parsed: null, textureFiles: [], texture: null,
  model: null, metadata: null, view: 'perspective', box: null, sphere: null,
  perspectiveDirection: new THREE.Vector3(-1.7, 2.4, -1.7), perspectiveFov: 32,
};

function status(message, error = false) {
  els.status.textContent = message; els.status.style.color = error ? '#f2a0a0' : '';
}

function resize() {
  const { clientWidth: width, clientHeight: height } = els.viewport;
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  perspectiveCamera.aspect = width / height; perspectiveCamera.updateProjectionMatrix();
  if (state.view !== 'perspective') setView(state.view, false);
  render();
}
new ResizeObserver(resize).observe(els.viewport);

function render() { renderer.render(scene, activeCamera); }
function animate() { requestAnimationFrame(animate); controls.update(); render(); }
animate();

function fileKey(file) { return (file.webkitRelativePath || file.name).replaceAll('\\','/').toLowerCase(); }
function basename(value) { return value.replaceAll('\\','/').split('/').pop(); }

async function handleFiles(fileList) {
  const incoming = [...fileList]; if (!incoming.length) return;
  state.files = incoming;
  const candidates = incoming.filter(file => /\.(bbmodel|json)$/i.test(file.name));
  const parsedCandidates = [];
  for (const file of candidates) {
    try {
      const document = JSON.parse(await file.text());
      parsedCandidates.push({ file, parsed: parseModelDocument(document, file.name) });
    } catch (error) {
      if (/\.bbmodel$|\.geo\.json$/i.test(file.name)) status(`${file.name}: ${error.message}`, true);
    }
  }
  if (!parsedCandidates.length) { status('No supported .bbmodel or Bedrock .geo.json found.', true); return; }
  state.modelFile = parsedCandidates[0].file; state.parsed = parsedCandidates[0].parsed;
  state.textureFiles = incoming.filter(file => file.type === 'image/png' || /\.png$/i.test(file.name));
  populateGeometry(); populateTextures();
  await loadSelectedTexture(); rebuild();
}

function populateGeometry() {
  els.geometry.innerHTML = '';
  state.parsed.names.forEach((name, index) => els.geometry.add(new Option(name, String(index))));
  els.geometry.disabled = state.parsed.names.length < 2;
}

function embeddedTextures() {
  if (state.parsed?.type !== 'bbmodel') return [];
  return (state.parsed.document.textures || []).filter(texture => /^data:image\//.test(texture.source || '')).map((texture, index) => ({
    name: texture.name || `Embedded texture ${index + 1}`, source: texture.source,
  }));
}

function preferredTextureIndex() {
  if (!state.textureFiles.length) return -1;
  if (state.parsed.type === 'bbmodel') {
    const expected = (state.parsed.document.textures || []).map(t => basename(t.path || t.name || '')).filter(Boolean);
    const index = state.textureFiles.findIndex(file => expected.some(name => name.toLowerCase() === file.name.toLowerCase()));
    if (index >= 0) return index;
  }
  const modelStem = state.modelFile.name.replace(/\.geo\.json$|\.bbmodel$|\.json$/i, '').toLowerCase();
  const index = state.textureFiles.findIndex(file => file.name.toLowerCase().includes(modelStem));
  return index >= 0 ? index : 0;
}

function populateTextures() {
  els.texture.innerHTML = '<option value="none">No texture (shape only)</option>';
  embeddedTextures().forEach((texture, index) => els.texture.add(new Option(`${texture.name} (embedded)`, `embedded:${index}`)));
  state.textureFiles.forEach((file, index) => els.texture.add(new Option(fileKey(file), `file:${index}`)));
  if (embeddedTextures().length) els.texture.value = 'embedded:0';
  else { const index = preferredTextureIndex(); els.texture.value = index >= 0 ? `file:${index}` : 'none'; }
  els.texture.disabled = els.texture.options.length <= 1;
}

async function loadTextureSource(source) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(source, texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      // uvCorners converts Blockbench's top-origin V coordinates to WebGL UVs.
      // TextureLoader's normal Y flip must stay enabled or the atlas is sampled
      // upside down and faces land on unrelated transparent pixels.
      texture.flipY = true;
      resolve(texture);
    }, undefined, reject);
  });
}

async function loadSelectedTexture() {
  state.texture?.dispose?.(); state.texture = null;
  const value = els.texture.value;
  if (value.startsWith('embedded:')) state.texture = await loadTextureSource(embeddedTextures()[Number(value.split(':')[1])].source);
  if (value.startsWith('file:')) {
    const file = state.textureFiles[Number(value.split(':')[1])];
    const url = URL.createObjectURL(file);
    try { state.texture = await loadTextureSource(url); } finally { URL.revokeObjectURL(url); }
  }
}

function disposeObject(root) {
  root?.traverse(child => { child.geometry?.dispose?.(); const mats = Array.isArray(child.material) ? child.material : [child.material]; mats.forEach(mat => mat?.dispose?.()); });
}

function rebuild() {
  if (!state.parsed) return;
  if (state.model) { scene.remove(state.model); disposeObject(state.model); }
  try {
    const built = buildModel(state.parsed, Number(els.geometry.value || 0), state.texture, { wireframe: els.wire.checked });
    state.model = built.object; state.metadata = built.metadata; scene.add(state.model);
    state.box = new THREE.Box3().setFromObject(state.model);
    state.sphere = state.box.getBoundingSphere(new THREE.Sphere());
    updateInfo(); els.empty.hidden = true; document.body.dataset.modelLoaded = 'true';
    setView(state.view, true);
    status(`Loaded ${state.modelFile.name} — ${state.metadata.cubes} cubes, ${state.metadata.bones} groups/bones`);
    window.dispatchEvent(new CustomEvent('entity-viewer-ready'));
  } catch (error) { status(`Render error: ${error.message}`, true); console.error(error); }
}

function updateInfo() {
  const m = state.metadata;
  els.info.innerHTML = `<dt>Format</dt><dd>${m.format}</dd><dt>Name</dt><dd>${m.name}</dd><dt>Cubes</dt><dd>${m.cubes}</dd><dt>Groups/bones</dt><dd>${m.bones}</dd><dt>Texture atlas</dt><dd>${m.textureSize.join(' × ')} px</dd>`;
  const warnings = [];
  if (!state.texture) warnings.push('No texture is active; the model is shown with a diagnostic material.');
  if (state.parsed.type === 'bbmodel' && (state.parsed.document.textures || []).length > 1) warnings.push('This project declares multiple textures. The viewer currently applies the selected atlas to all cubes.');
  els.warnings.hidden = !warnings.length; els.warnings.textContent = warnings.join(' ');
}

const DIRECTIONS = {
  front: new THREE.Vector3(0,0,-1), back: new THREE.Vector3(0,0,1),
  left: new THREE.Vector3(-1,0,0), right: new THREE.Vector3(1,0,0),
  top: new THREE.Vector3(0,1,0), bottom: new THREE.Vector3(0,-1,0),
};

function setView(name, refit = true) {
  state.view = name; els.viewLabel.textContent = name[0].toUpperCase() + name.slice(1);
  els.viewButtons.querySelectorAll('button').forEach(button => button.classList.toggle('active', button.dataset.view === name));
  if (!state.sphere || !Number.isFinite(state.sphere.radius)) return;
  const center = state.sphere.center, radius = Math.max(state.sphere.radius, 1);
  if (name === 'perspective') {
    activeCamera = perspectiveCamera; controls.object = perspectiveCamera;
    if (refit) perspectiveCamera.position.copy(center).add(state.perspectiveDirection.clone().normalize().multiplyScalar(radius * 4.2));
    perspectiveCamera.fov = state.perspectiveFov;
    perspectiveCamera.near = Math.max(radius / 1000, .01); perspectiveCamera.far = radius * 100; perspectiveCamera.updateProjectionMatrix();
    controls.target.copy(center); controls.enableRotate = true; controls.update();
  } else {
    activeCamera = orthoCamera; controls.object = orthoCamera; controls.enableRotate = false;
    const direction = DIRECTIONS[name]; const aspect = Math.max(els.viewport.clientWidth / Math.max(els.viewport.clientHeight, 1), .1);
    const extent = radius * 1.18;
    orthoCamera.left = -extent * aspect; orthoCamera.right = extent * aspect; orthoCamera.top = extent; orthoCamera.bottom = -extent;
    orthoCamera.near = .01; orthoCamera.far = radius * 100;
    orthoCamera.position.copy(center).add(direction.clone().multiplyScalar(radius * 5));
    orthoCamera.up.set(0,1,0); if (name === 'top') orthoCamera.up.set(0,0,1); if (name === 'bottom') orthoCamera.up.set(0,0,-1);
    orthoCamera.lookAt(center); orthoCamera.updateProjectionMatrix(); controls.target.copy(center); controls.update();
  }
  render();
}

function safeName(value) { return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g,'').toLowerCase() || 'entity'; }
function download(dataUrl, filename) { const link = document.createElement('a'); link.href = dataUrl; link.download = filename; link.click(); }
function captureDataUrl(view = state.view) { setView(view, false); render(); return renderer.domElement.toDataURL('image/png'); }
function configureCapture(input = {}) {
  const direction = input.perspectiveDirection;
  if (direction !== undefined) {
    if (!Array.isArray(direction) || direction.length !== 3 || direction.some(value => !Number.isFinite(value)) || Math.hypot(...direction) === 0) throw new Error('perspectiveDirection must be a finite nonzero 3-vector.');
    state.perspectiveDirection.set(...direction);
  }
  if (input.perspectiveFov !== undefined) {
    if (!Number.isFinite(input.perspectiveFov) || input.perspectiveFov < 10 || input.perspectiveFov > 80) throw new Error('perspectiveFov must be within 10..80 degrees.');
    state.perspectiveFov = input.perspectiveFov;
  }
  if (state.sphere) setView('perspective', true);
  return { perspectiveDirection: state.perspectiveDirection.toArray(), perspectiveFov: state.perspectiveFov };
}
function captureMaskDataUrl(view = state.view) {
  const previousGrid = grid.visible, previousOverride = scene.overrideMaterial;
  const previousColor = renderer.getClearColor(new THREE.Color()).getHex(), previousAlpha = renderer.getClearAlpha();
  grid.visible = false; scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff }); renderer.setClearColor(0x000000, 1);
  try { setView(view, false); render(); return renderer.domElement.toDataURL('image/png'); }
  finally { scene.overrideMaterial.dispose(); scene.overrideMaterial = previousOverride; grid.visible = previousGrid; renderer.setClearColor(previousColor, previousAlpha); render(); }
}
function captureClayDataUrl(view = state.view) {
  const previousGrid = grid.visible, previousOverride = scene.overrideMaterial;
  const clay = new THREE.MeshStandardMaterial({ color: 0x8b735f, roughness: 0.82, metalness: 0 });
  grid.visible = false; scene.overrideMaterial = clay;
  try { setView(view, false); render(); return renderer.domElement.toDataURL('image/png'); }
  finally { clay.dispose(); scene.overrideMaterial = previousOverride; grid.visible = previousGrid; render(); }
}
function resolvedPartColors() {
  const partIds = [];
  state.model?.traverse(child => {
    if (!child.isMesh || child.userData.kind !== 'cube') return;
    partIds.push(String(child.userData.partId || child.name || 'unnamed-cube'));
  });
  return new Map(createPartColorLegend(partIds).map(entry => [entry.partId, entry.color]));
}
function partLegend() {
  return [...resolvedPartColors()].map(([partId, color]) => ({ partId, color }));
}
function capturePartDataUrl(view = state.view) {
  const previousGrid = grid.visible, previousAxes = axes.visible;
  const previousColor = renderer.getClearColor(new THREE.Color()).getHex(), previousAlpha = renderer.getClearAlpha();
  const replacements = [];
  grid.visible = false; axes.visible = false; renderer.setClearColor(0x000000, 1);
  const colors = resolvedPartColors();
  state.model?.traverse(child => {
    if (!child.isMesh || child.userData.kind !== 'cube') return;
    const previous = child.material;
    const partId = String(child.userData.partId || child.name || 'unnamed-cube');
    const material = new THREE.MeshBasicMaterial({ color: colors.get(partId), side: THREE.DoubleSide });
    child.material = Array.isArray(previous) ? previous.map(() => material) : material;
    replacements.push({ child, previous, material });
  });
  try { setView(view, false); render(); return renderer.domElement.toDataURL('image/png'); }
  finally {
    for (const replacement of replacements) { replacement.child.material = replacement.previous; replacement.material.dispose(); }
    grid.visible = previousGrid; axes.visible = previousAxes; renderer.setClearColor(previousColor, previousAlpha); render();
  }
}

const FACE_IDS = ['east', 'west', 'up', 'down', 'south', 'north'];
function rounded(value) { return Math.round(value * 1e6) / 1e6; }
function roundedArray(values) { return Array.from(values, rounded); }
function cameraEvidence(view) {
  activeCamera.updateMatrixWorld(true);
  activeCamera.updateProjectionMatrix();
  return {
    view,
    type: activeCamera.isPerspectiveCamera ? 'perspective' : 'orthographic',
    position: roundedArray(activeCamera.position.toArray()),
    quaternion: roundedArray(activeCamera.quaternion.toArray()),
    near: activeCamera.near,
    far: activeCamera.far,
    projectionMatrix: roundedArray(activeCamera.projectionMatrix.elements),
    viewMatrix: roundedArray(activeCamera.matrixWorldInverse.elements),
    ...(activeCamera.isPerspectiveCamera
      ? { fov: activeCamera.fov, aspect: activeCamera.aspect }
      : { left: activeCamera.left, right: activeCamera.right, top: activeCamera.top, bottom: activeCamera.bottom }),
  };
}
function captureSurfaceBoundaries(view = state.view) {
  const previousGrid = grid.visible, previousAxes = axes.visible;
  const previousColor = renderer.getClearColor(new THREE.Color()).getHex(), previousAlpha = renderer.getClearAlpha();
  const replacements = [], colors = resolvedPartColors();
  grid.visible = false; axes.visible = false; renderer.setClearColor(0x000000, 1);
  state.model?.traverse(child => {
    if (!child.isMesh || child.userData.kind !== 'cube') return;
    const previous = child.material;
    const partId = String(child.userData.partId || child.name || 'unnamed-cube');
    const material = new THREE.MeshBasicMaterial({ color: colors.get(partId), side: THREE.DoubleSide });
    child.material = Array.isArray(previous) ? previous.map(() => material) : material;
    replacements.push({ child, previous, material });
  });
  try {
    setView(view, false); state.model?.updateMatrixWorld(true); render();
    const width = renderer.domElement.width, height = renderer.domElement.height;
    const pixels = new Uint8Array(width * height * 4);
    renderer.getContext().readPixels(0, 0, width, height, renderer.getContext().RGBA, renderer.getContext().UNSIGNED_BYTE, pixels);
    const foreground = (x, y) => {
      if (x < 0 || x >= width || y < 0 || y >= height) return false;
      const index = ((height - 1 - y) * width + x) * 4;
      return pixels[index] !== 0 || pixels[index + 1] !== 0 || pixels[index + 2] !== 0;
    };
    const raycaster = new THREE.Raycaster(), normalMatrix = new THREE.Matrix3(), records = [];
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      if (!foreground(x, y) || (foreground(x - 1, y) && foreground(x + 1, y) && foreground(x, y - 1) && foreground(x, y + 1))) continue;
      raycaster.setFromCamera(new THREE.Vector2(((x + 0.5) / width) * 2 - 1, 1 - ((y + 0.5) / height) * 2), activeCamera);
      const hit = raycaster.intersectObject(state.model, true).find(item => item.object?.userData?.kind === 'cube');
      if (!hit?.face) continue;
      const cameraPoint = hit.point.clone().applyMatrix4(activeCamera.matrixWorldInverse);
      const worldNormal = hit.face.normal.clone().applyMatrix3(normalMatrix.getNormalMatrix(hit.object.matrixWorld)).normalize();
      records.push({
        x, y,
        partId: String(hit.object.userData.partId || hit.object.name || 'unnamed-cube'),
        faceId: FACE_IDS[hit.face.materialIndex] || `material-${hit.face.materialIndex}`,
        linearDepth: rounded(-cameraPoint.z),
        worldPosition: roundedArray(hit.point.toArray()),
        worldNormal: roundedArray(worldNormal.toArray()),
      });
    }
    return { schemaVersion: 1, view, width, height, camera: cameraEvidence(view), records };
  } finally {
    for (const replacement of replacements) { replacement.child.material = replacement.previous; replacement.material.dispose(); }
    grid.visible = previousGrid; axes.visible = previousAxes; renderer.setClearColor(previousColor, previousAlpha); render();
  }
}

async function contactSheetDataUrl() {
  const views = ['perspective','front','back','left','right','top','bottom'];
  const cellW = 600, cellH = 600, header = 44, columns = 4, rows = 2;
  const sheet = document.createElement('canvas'); sheet.width = columns * cellW; sheet.height = rows * (cellH + header);
  const context = sheet.getContext('2d'); context.fillStyle = '#11161b'; context.fillRect(0,0,sheet.width,sheet.height);
  const previous = state.view;
  for (let index = 0; index < views.length; index++) {
    const view = views[index]; setView(view, false); render();
    const image = await createImageBitmap(renderer.domElement);
    const x = (index % columns) * cellW, y = Math.floor(index / columns) * (cellH + header);
    const scale = Math.min(cellW / image.width, cellH / image.height);
    const drawWidth = image.width * scale, drawHeight = image.height * scale;
    context.drawImage(image, x + (cellW - drawWidth) / 2, y + (cellH - drawHeight) / 2, drawWidth, drawHeight); image.close();
    context.fillStyle = '#202831'; context.fillRect(x, y + cellH, cellW, header);
    context.fillStyle = '#eef2f5'; context.font = '22px ui-monospace, monospace'; context.fillText(view.toUpperCase(), x + 16, y + cellH + 29);
  }
  context.fillStyle = '#202831'; context.fillRect(3 * cellW, cellH + header, cellW, cellH + header);
  context.fillStyle = '#9ba8b5'; context.font = '18px ui-monospace, monospace'; context.fillText(state.metadata?.name || 'Minecraft entity', 3 * cellW + 20, cellH + header + 40);
  setView(previous, false); return sheet.toDataURL('image/png');
}

els.fileInput.addEventListener('change', event => handleFiles(event.target.files));
els.folderInput.addEventListener('change', event => handleFiles(event.target.files));
els.openFolder.addEventListener('click', () => els.folderInput.click());
for (const type of ['dragenter','dragover']) els.drop.addEventListener(type, event => { event.preventDefault(); els.drop.classList.add('drag'); });
for (const type of ['dragleave','drop']) els.drop.addEventListener(type, event => { event.preventDefault(); els.drop.classList.remove('drag'); });
els.drop.addEventListener('drop', event => handleFiles(event.dataTransfer.files));
els.geometry.addEventListener('change', rebuild);
els.texture.addEventListener('change', async () => { await loadSelectedTexture(); rebuild(); });
els.viewButtons.addEventListener('click', event => { if (event.target.dataset.view) setView(event.target.dataset.view, true); });
els.grid.addEventListener('change', () => grid.visible = els.grid.checked);
els.axes.addEventListener('change', () => axes.visible = els.axes.checked);
els.wire.addEventListener('change', () => setWireframe(state.model, els.wire.checked));
els.frame.addEventListener('click', () => setView(state.view, true));
els.referenceInput.addEventListener('change', event => {
  const file = event.target.files[0]; if (!file) return; const url = URL.createObjectURL(file);
  els.referenceImage.src = url; els.referenceOverlay.src = url;
  els.compareMode.querySelector('[data-mode=side]').click();
});
els.compareMode.addEventListener('click', event => {
  const mode = event.target.dataset.mode; if (!mode) return;
  els.workspace.classList.toggle('overlay', mode === 'overlay'); els.workspace.classList.toggle('side', mode === 'side');
  els.compareMode.querySelectorAll('button').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
  resize();
});
els.opacity.addEventListener('input', () => { els.referenceOverlay.style.opacity = String(Number(els.opacity.value) / 100); els.opacityValue.textContent = `${els.opacity.value}%`; });
els.referenceOverlay.style.opacity = '.5';
els.exportCurrent.addEventListener('click', () => { if (state.model) download(captureDataUrl(), `${safeName(state.metadata.name)}-${state.view}.png`); });
els.exportSheet.addEventListener('click', async () => { if (state.model) download(await contactSheetDataUrl(), `${safeName(state.metadata.name)}-contact-sheet.png`); });

window.__entityViewer = {
  setView,
  configureCapture,
  captureDataUrl,
  captureMaskDataUrl,
  captureClayDataUrl,
  capturePartDataUrl,
  captureSurfaceBoundaries,
  partLegend,
  contactSheetDataUrl,
  get metadata() { return state.metadata; },
  get view() { return state.view; },
};
resize();
