import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildModel, createPartColorLegend, parseModelDocument } from '../src/model-builder.js';

test('parses and builds Bedrock geometry with bones and cubes', () => {
  const document = {
    format_version: '1.12.0',
    'minecraft:geometry': [{
      description: { identifier: 'geometry.test', texture_width: 32, texture_height: 32 },
      bones: [{ name: 'body', pivot: [0, 8, 0], cubes: [{ origin: [-4, 0, -2], size: [8, 8, 4], uv: [0, 0] }] }],
    }],
  };
  const parsed = parseModelDocument(document, 'test.geo.json');
  const built = buildModel(parsed, 0, null);
  assert.equal(parsed.type, 'bedrock');
  assert.equal(built.metadata.name, 'geometry.test');
  assert.equal(built.metadata.cubes, 1);
  let cube;
  built.object.traverse(child => { if (child.isMesh) cube = child; });
  assert.equal(cube.userData.partId, 'body:0');
  const box = new THREE.Box3().setFromObject(built.object);
  assert.deepEqual(box.min.toArray(), [-4, 0, -2]);
  assert.deepEqual(box.max.toArray(), [4, 8, 2]);
});

test('parses and builds Blockbench outliner cubes', () => {
  const document = {
    meta: { format_version: '4.10', model_format: 'bedrock' }, name: 'Test project', resolution: { width: 16, height: 16 },
    elements: [{ uuid: 'cube-1', name: 'cube', from: [-1, 0, -1], to: [1, 2, 1], origin: [0, 1, 0], faces: { north: { uv: [0,0,2,2] } } }],
    outliner: [{ uuid: 'group-1', name: 'root', origin: [0,0,0], children: ['cube-1'] }],
  };
  const parsed = parseModelDocument(document, 'test.bbmodel');
  const built = buildModel(parsed, 0, null);
  assert.equal(parsed.type, 'bbmodel');
  assert.equal(built.metadata.cubes, 1);
  assert.equal(built.metadata.bones, 1);
  let cube;
  built.object.traverse(child => { if (child.isMesh) cube = child; });
  assert.equal(cube.userData.partId, 'cube-1');
});

test('prefers a stable Forge cube id for Bedrock diagnostic ownership', () => {
  const document = { 'minecraft:geometry': [{ description: { identifier: 'geometry.parts' }, bones: [{ name: 'root', cubes: [{ forge_id: 'stable-cube-id', origin: [0,0,0], size: [1,1,1], uv: [0,0] }] }] }] };
  const built = buildModel(parseModelDocument(document), 0, null);
  let cube;
  built.object.traverse(child => { if (child.isMesh) cube = child; });
  assert.equal(cube.userData.partId, 'stable-cube-id');
});

test('allocates deterministic collision-free diagnostic colors', () => {
  const ids = ['mossback-cheek-left', 'mossback-moss-trail-last', 'third-part'];
  const first = createPartColorLegend(ids);
  const second = createPartColorLegend([...ids].reverse());
  assert.deepEqual(first, second);
  assert.equal(new Set(first.map(entry => entry.color)).size, ids.length);
});

test('rejects unrelated JSON', () => {
  assert.throws(() => parseModelDocument({ hello: 'world' }, 'nope.json'), /Unsupported JSON/);
});

test('converts asymmetric Bedrock X coordinates into Blockbench/Three space', () => {
  const document = { 'minecraft:geometry': [{ description: { identifier: 'geometry.asymmetric' }, bones: [{ name: 'root', pivot: [3,0,0], cubes: [{ origin: [2,0,0], size: [4,2,2], uv: [0,0] }] }] }] };
  const built = buildModel(parseModelDocument(document), 0, null);
  const box = new THREE.Box3().setFromObject(built.object);
  assert.equal(box.min.x, -6);
  assert.equal(box.max.x, -2);
});

test('uses an unlit material for textured visual parity', () => {
  const document = { 'minecraft:geometry': [{ description: { identifier: 'geometry.material' }, bones: [{ name: 'root', cubes: [{ origin: [0,0,0], size: [1,1,1], uv: [0,0] }] }] }] };
  const texture = new THREE.Texture();
  const built = buildModel(parseModelDocument(document), 0, texture);
  let material;
  built.object.traverse(child => { if (child.isMesh) material = child.material[0]; });
  assert.equal(material.isMeshBasicMaterial, true);
  assert.equal(material.transparent, false);
  assert.equal(material.depthWrite, true);
});

test('maps Blockbench face UVs in the same vertex order as THREE.BoxGeometry', () => {
  const document = {
    meta: { format_version: '4.10', model_format: 'bedrock' },
    resolution: { width: 16, height: 16 },
    elements: [{
      uuid: 'cube-1', from: [0,0,0], to: [1,1,1],
      faces: { east: { uv: [2,4,6,8] } },
    }],
    outliner: ['cube-1'],
  };
  const built = buildModel(parseModelDocument(document), 0, null);
  let mesh;
  built.object.traverse(child => { if (child.isMesh) mesh = child; });
  assert.deepEqual(Array.from(mesh.geometry.attributes.position.array.slice(0, 12)), [
    1,1,1, 1,1,0, 1,0,1, 1,0,0,
  ]);
  assert.deepEqual(Array.from(mesh.geometry.attributes.uv.array.slice(0, 8)), [
    0.125,0.75, 0.375,0.75, 0.125,0.5, 0.375,0.5,
  ]);
  assert.deepEqual(Array.from(mesh.geometry.index.array.slice(0, 6)), [0,2,1,2,3,1]);
});

test('reverses Bedrock per-face UV coordinates for top and bottom like Blockbench', () => {
  const document = {
    'minecraft:geometry': [{
      description: { identifier: 'geometry.uv', texture_width: 16, texture_height: 16 },
      bones: [{ name: 'root', cubes: [{
        origin: [0,0,0], size: [1,1,1],
        uv: { up: { uv: [2,4], uv_size: [4,2] } },
      }] }],
    }],
  };
  const built = buildModel(parseModelDocument(document), 0, null);
  let mesh;
  built.object.traverse(child => { if (child.isMesh) mesh = child; });
  assert.deepEqual(Array.from(mesh.geometry.attributes.uv.array.slice(0, 8)), [
    0.375,0.625, 0.125,0.625, 0.375,0.75, 0.125,0.75,
  ]);
});

test('retains authored Bedrock east and west face keys after X conversion', () => {
  const document = {
    'minecraft:geometry': [{
      description: { identifier: 'geometry.sides', texture_width: 16, texture_height: 16 },
      bones: [{ name: 'root', cubes: [{
        origin: [0,0,0], size: [1,1,1],
        uv: { east: { uv: [2,4], uv_size: [4,2] } },
      }] }],
    }],
  };
  const built = buildModel(parseModelDocument(document), 0, null);
  let mesh;
  built.object.traverse(child => { if (child.isMesh) mesh = child; });
  assert.deepEqual(Array.from(mesh.geometry.attributes.position.array.slice(0, 12)), [
    0,1,1, 0,1,0, 0,0,1, 0,0,0,
  ]);
  assert.deepEqual(Array.from(mesh.geometry.attributes.uv.array.slice(0, 8)), [
    0.125,0.75, 0.375,0.75, 0.125,0.625, 0.375,0.625,
  ]);
});

test('maps Bedrock box UV east and west regions like Blockbench', () => {
  const document = {
    'minecraft:geometry': [{
      description: { identifier: 'geometry.box_uv', texture_width: 64, texture_height: 32 },
      bones: [{ name: 'root', cubes: [{ origin: [-4,12,-2], size: [8,12,4], uv: [16,16] }] }],
    }],
  };
  const built = buildModel(parseModelDocument(document), 0, null);
  let mesh;
  built.object.traverse(child => { if (child.isMesh) mesh = child; });
  assert.deepEqual(Array.from(mesh.geometry.attributes.uv.array.slice(0, 8)), [
    0.25,0.375, 0.3125,0.375, 0.25,0, 0.3125,0,
  ]);
  assert.deepEqual(Array.from(mesh.geometry.attributes.uv.array.slice(8, 16)), [
    0.4375,0.375, 0.5,0.375, 0.4375,0, 0.5,0,
  ]);
});
