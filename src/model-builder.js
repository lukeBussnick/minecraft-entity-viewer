import * as THREE from 'three';

const FACES = {
  // Match the per-face vertex order produced by THREE.BoxGeometry, which is
  // the order Blockbench writes UV corners into in Cube.preview_controller.
  east:  { normal: [1,0,0],  corners: (a,b) => [[b.x,b.y,b.z],[b.x,b.y,a.z],[b.x,a.y,b.z],[b.x,a.y,a.z]] },
  west:  { normal: [-1,0,0], corners: (a,b) => [[a.x,b.y,a.z],[a.x,b.y,b.z],[a.x,a.y,a.z],[a.x,a.y,b.z]] },
  up:    { normal: [0,1,0],  corners: (a,b) => [[a.x,b.y,a.z],[b.x,b.y,a.z],[a.x,b.y,b.z],[b.x,b.y,b.z]] },
  down:  { normal: [0,-1,0], corners: (a,b) => [[a.x,a.y,b.z],[b.x,a.y,b.z],[a.x,a.y,a.z],[b.x,a.y,a.z]] },
  south: { normal: [0,0,1],  corners: (a,b) => [[a.x,b.y,b.z],[b.x,b.y,b.z],[a.x,a.y,b.z],[b.x,a.y,b.z]] },
  north: { normal: [0,0,-1], corners: (a,b) => [[b.x,b.y,a.z],[a.x,b.y,a.z],[b.x,a.y,a.z],[a.x,a.y,a.z]] },
};

function radians(value = 0) { return THREE.MathUtils.degToRad(Number(value) || 0); }
function vector(value = [0,0,0]) { return new THREE.Vector3(...value.map(Number)); }

function autoUv(base, size) {
  const [u, v] = base;
  const [x, y, z] = size.map(Math.abs);
  return {
    east: [u, v + z, u + z, v + z + y],
    north: [u + z, v + z, u + z + x, v + z + y],
    west: [u + z + x, v + z, u + z + x + z, v + z + y],
    south: [u + z + x + z, v + z, u + z + x + z + x, v + z + y],
    up: [u + z + x, v + z, u + z, v],
    down: [u + z + x + x, v, u + z + x, v + z],
  };
}

function uvCorners(rect, width, height, rotation = 0) {
  if (!rect) return [[0,0],[1,0],[1,1],[0,1]];
  const [u1,v1,u2,v2] = rect.map(Number);
  let points = [[u1, v1], [u2, v1], [u1, v2], [u2, v2]];
  const steps = ((Math.round(rotation / 90) % 4) + 4) % 4;
  for (let i = 0; i < steps; i++) points = [points[2], points[0], points[3], points[1]];
  return points.map(([u,v]) => [u / width, 1 - v / height]);
}

function makeCuboid(from, to, faceData, material, textureSize, inflate = 0) {
  const a = vector(from).addScalar(-inflate);
  const b = vector(to).addScalar(inflate);
  const positions = [], normals = [], uvs = [], indices = [], groups = [];
  let vertex = 0;
  Object.entries(FACES).forEach(([name, spec], faceIndex) => {
    const face = faceData?.[name];
    if (face == null || face?.texture === null) return;
    const corners = spec.corners(a,b);
    const rect = Array.isArray(face) ? face : face?.uv;
    const faceUvs = uvCorners(rect, textureSize[0], textureSize[1], face?.rotation || 0);
    corners.forEach((point, index) => {
      positions.push(...point); normals.push(...spec.normal); uvs.push(...faceUvs[index]);
    });
    indices.push(vertex,vertex+2,vertex+1, vertex+2,vertex+3,vertex+1);
    groups.push({ start: indices.length - 6, count: 6, materialIndex: faceIndex });
    vertex += 4;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  groups.forEach(group => geometry.addGroup(group.start, group.count, group.materialIndex));
  const materials = Array(6).fill(material);
  return new THREE.Mesh(geometry, materials);
}

function bedrockFaces(cube) {
  const mirrorRects = faces => {
    if (!cube.mirror) return faces;
    const swappedSides = { ...faces, east: faces.west, west: faces.east };
    return Object.fromEntries(Object.entries(swappedSides).map(([name, value]) => {
      const face = Array.isArray(value) ? { uv: value } : value;
      return [name, { ...face, uv: [face.uv[2], face.uv[1], face.uv[0], face.uv[3]] }];
    }));
  };
  // Blockbench flips Bedrock X coordinates but intentionally retains the
  // authored face keys. Swapping east/west here selects the wrong atlas areas.
  if (Array.isArray(cube.uv)) return mirrorRects(autoUv(cube.uv, cube.size));
  const result = {};
  for (const [name, data] of Object.entries(cube.uv || {})) {
    if (Array.isArray(data?.uv) && Array.isArray(data?.uv_size)) {
      let uv = [...data.uv, data.uv[0] + data.uv_size[0], data.uv[1] + data.uv_size[1]];
      // Blockbench reverses both axes for Bedrock top and bottom face UVs
      // while importing per-face UV definitions.
      if (name === 'up' || name === 'down') uv = [uv[2], uv[3], uv[0], uv[1]];
      result[name] = { uv, rotation: data.uv_rotation || 0 };
    }
  }
  return result;
}

function applyRotation(object, rotation = [0,0,0]) {
  object.rotation.order = 'ZYX';
  object.rotation.set(radians(rotation[0]), radians(rotation[1]), radians(rotation[2]));
}

function bedrockPoint(value = [0,0,0]) { return new THREE.Vector3(-Number(value[0] || 0), Number(value[1] || 0), Number(value[2] || 0)); }
function bedrockRotation(value = [0,0,0]) { return [-Number(value[0] || 0), -Number(value[1] || 0), Number(value[2] || 0)]; }

function materialFor(texture, wireframe = false) {
  const shared = {
    map: texture || null,
    color: texture ? 0xffffff : 0x92ad89,
    transparent: false,
    alphaTest: 0.01,
    side: THREE.DoubleSide,
    wireframe,
  };
  // Blockbench's textured edit view displays atlas colors without the severe
  // physical-light attenuation that made dark Minecraft textures look absent.
  // Keep lighting only for the textureless diagnostic material so cube depth
  // remains readable there.
  return texture
    ? new THREE.MeshBasicMaterial(shared)
    : new THREE.MeshStandardMaterial({ ...shared, roughness: 0.9, metalness: 0 });
}

function diagnosticPartColor(partId, attempt = 0) {
  let hash = 2166136261;
  for (const character of String(partId)) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  const hue = ((hash >>> 0) / 4294967296 + attempt * 0.618033988749895) % 1;
  return `#${new THREE.Color().setHSL(hue, 0.78, 0.58, THREE.SRGBColorSpace).getHexString()}`;
}

export function createPartColorLegend(partIds) {
  const entries = [], used = new Set();
  for (const partId of [...new Set(partIds.map(String))].sort((left, right) => left.localeCompare(right))) {
    let attempt = 0, color;
    do { color = diagnosticPartColor(partId, attempt++); } while (used.has(color));
    used.add(color); entries.push({ partId, color });
  }
  return entries;
}

export function parseModelDocument(document, filename = '') {
  if (document?.meta?.format_version && Array.isArray(document.elements)) {
    return { type: 'bbmodel', filename, names: [document.name || filename], document };
  }
  const geometries = document?.['minecraft:geometry'];
  if (Array.isArray(geometries)) {
    const names = geometries.map((geometry, index) => geometry.description?.identifier || `Geometry ${index + 1}`);
    return { type: 'bedrock', filename, names, document };
  }
  throw new Error('Unsupported JSON. Expected a Blockbench .bbmodel or Bedrock minecraft:geometry file.');
}

export function buildModel(parsed, selectedIndex, texture, options = {}) {
  const material = materialFor(texture, options.wireframe);
  if (parsed.type === 'bedrock') return buildBedrock(parsed.document['minecraft:geometry'][selectedIndex] || parsed.document['minecraft:geometry'][0], material);
  return buildBbmodel(parsed.document, material);
}

function buildBedrock(geometry, material) {
  const root = new THREE.Group();
  root.name = geometry.description?.identifier || 'bedrock-model';
  const textureSize = [geometry.description?.texture_width || 64, geometry.description?.texture_height || 64];
  const bones = geometry.bones || [];
  const groups = new Map();
  const bonePivots = new Map(bones.map(b => [b.name, bedrockPoint(b.pivot)]));
  let cubeCount = 0;

  bones.forEach(bone => {
    const group = new THREE.Group(); group.name = bone.name;
    const pivot = bonePivots.get(bone.name) || new THREE.Vector3();
    const parentPivot = bone.parent ? (bonePivots.get(bone.parent) || new THREE.Vector3()) : new THREE.Vector3();
    group.position.copy(pivot).sub(parentPivot); applyRotation(group, bedrockRotation(bone.rotation));
    (bone.cubes || []).forEach((cube, cubeIndex) => {
      const origin = cube.origin || [0,0,0], cubeSize = cube.size || [0,0,0];
      const from = new THREE.Vector3(-(Number(origin[0]) + Number(cubeSize[0])), Number(origin[1]), Number(origin[2]));
      const to = new THREE.Vector3(-Number(origin[0]), Number(origin[1]) + Number(cubeSize[1]), Number(origin[2]) + Number(cubeSize[2]));
      const mesh = makeCuboid(from.toArray(), to.toArray(), bedrockFaces({ ...cube, mirror: cube.mirror ?? bone.mirror }), material, textureSize, Number(cube.inflate ?? bone.inflate ?? 0));
      mesh.position.copy(pivot).multiplyScalar(-1);
      if (cube.pivot || cube.rotation) {
        const cubePivot = bedrockPoint(cube.pivot || bone.pivot);
        mesh.position.copy(cubePivot).sub(pivot);
        mesh.geometry.translate(-cubePivot.x, -cubePivot.y, -cubePivot.z);
        applyRotation(mesh, bedrockRotation(cube.rotation));
      }
      mesh.name = cube.forge_id || `${bone.name}:${cubeIndex}`;
      mesh.userData.kind = 'cube';
      mesh.userData.partId = mesh.name;
      group.add(mesh); cubeCount++;
    });
    groups.set(bone.name, group);
  });
  bones.forEach(bone => {
    const group = groups.get(bone.name);
    const parent = bone.parent && groups.get(bone.parent);
    (parent || root).add(group);
  });
  return { object: root, metadata: { name: root.name, cubes: cubeCount, bones: bones.length, textureSize, format: 'Bedrock geometry' } };
}

function buildBbmodel(document, material) {
  const root = new THREE.Group(); root.name = document.name || 'blockbench-model';
  const size = document.resolution || { width: 64, height: 64 };
  const textureSize = [Number(size.width || 64), Number(size.height || 64)];
  const elements = new Map((document.elements || []).map(element => [element.uuid, element]));
  let cubeCount = 0, groupCount = 0;

  function buildNode(node, parentPivot = new THREE.Vector3()) {
    if (typeof node === 'string') {
      const cube = elements.get(node); if (!cube) return null;
      const faceData = {};
      for (const [name, face] of Object.entries(cube.faces || {})) faceData[name] = face;
      const mesh = makeCuboid(cube.from, cube.to, faceData, material, textureSize, Number(cube.inflate || 0));
      const pivot = vector(cube.origin || [0,0,0]);
      if (cube.rotation) {
        mesh.geometry.translate(-pivot.x, -pivot.y, -pivot.z);
        mesh.position.copy(pivot).sub(parentPivot); applyRotation(mesh, cube.rotation);
      } else mesh.position.copy(parentPivot).multiplyScalar(-1);
      mesh.name = cube.name || cube.uuid; mesh.userData.kind = 'cube'; mesh.userData.partId = cube.uuid || cube.name; cubeCount++;
      return mesh;
    }
    const group = new THREE.Group(); const pivot = vector(node.origin || [0,0,0]);
    group.position.copy(pivot).sub(parentPivot); applyRotation(group, node.rotation);
    group.name = node.name || node.uuid || 'group'; groupCount++;
    (node.children || []).forEach(child => { const built = buildNode(child, pivot); if (built) group.add(built); });
    return group;
  }
  const referenced = new Set();
  function mark(node) { if (typeof node === 'string') referenced.add(node); else (node.children || []).forEach(mark); }
  (document.outliner || []).forEach(mark);
  (document.outliner || []).forEach(node => { const built = buildNode(node); if (built) root.add(built); });
  for (const [uuid] of elements) if (!referenced.has(uuid)) { const built = buildNode(uuid); if (built) root.add(built); }
  return { object: root, metadata: { name: root.name, cubes: cubeCount, bones: groupCount, textureSize, format: 'Blockbench project' } };
}

export function setWireframe(root, enabled) {
  root?.traverse(child => {
    if (!child.isMesh) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach(material => material.wireframe = enabled);
  });
}
