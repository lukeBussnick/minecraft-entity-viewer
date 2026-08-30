import path from 'node:path';

const VALUE_FLAGS = new Set([
  '--model', '--texture', '--out', '--views', '--geometry',
  '--perspective-direction', '--perspective-fov',
]);
const BOOLEAN_FLAGS = new Set([
  '--agent', '--masks', '--clay', '--parts', '--surface-boundaries', '--json', '--help', '-h',
]);
const VALID_VIEWS = ['perspective', 'front', 'back', 'left', 'right', 'top', 'bottom'];

export class CaptureCliError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CaptureCliError';
    this.code = code;
  }
}

export function captureUsage() {
  return [
    'Usage: npm run capture -- --model <file.bbmodel|file.geo.json> [options]',
    '',
    'Core options:',
    '  --texture <texture.png>          Explicit PNG atlas (omit for an embedded .bbmodel texture)',
    '  --out <directory>                New, empty output directory',
    '  --views <comma-separated>        Default: perspective,front,back,left,right,top,bottom',
    '  --geometry <index|identifier>    Select one geometry from a multi-geometry file',
    '  --perspective-direction <x,y,z>  Override the perspective camera direction',
    '  --perspective-fov <10..80>       Override the perspective field of view',
    '',
    'Evidence options:',
    '  --agent                         Enable masks, clay, part IDs, and surface boundaries',
    '  --masks --clay --parts --surface-boundaries',
    '  --json                          Emit one machine-readable result object to stdout',
    '',
    'The output directory must be empty. Use a new iteration directory for every capture.',
  ].join('\n');
}

export function parseCaptureArgs(args, { root = process.cwd() } = {}) {
  const values = new Map();
  const booleans = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (VALUE_FLAGS.has(token)) {
      if (values.has(token)) throw new CaptureCliError('DUPLICATE_OPTION', `Option ${token} may be provided only once.`);
      const next = args[index + 1];
      if (!next || next.startsWith('--')) throw new CaptureCliError('MISSING_OPTION_VALUE', `Option ${token} requires a value.`);
      values.set(token, next);
      index += 1;
      continue;
    }
    if (BOOLEAN_FLAGS.has(token)) {
      if (booleans.has(token)) throw new CaptureCliError('DUPLICATE_OPTION', `Option ${token} may be provided only once.`);
      booleans.add(token);
      continue;
    }
    throw new CaptureCliError('UNKNOWN_OPTION', `Unknown option: ${token}`);
  }

  if (booleans.has('--help') || booleans.has('-h')) return { help: true, json: booleans.has('--json') };
  const model = values.get('--model');
  if (!model) throw new CaptureCliError('MODEL_REQUIRED', '--model is required.');
  const modelPath = path.resolve(model);
  const texture = values.get('--texture');
  const texturePath = texture ? path.resolve(texture) : null;
  const output = values.get('--out') || path.join(root, 'captures', path.basename(modelPath).replace(/\.geo\.json$|\.bbmodel$|\.json$/i, ''));
  const outputPath = path.resolve(output);
  if (outputPath === path.resolve(root) || outputPath === path.parse(outputPath).root) {
    throw new CaptureCliError('UNSAFE_OUTPUT', 'The output directory must not be the viewer root or a filesystem root.');
  }

  const views = (values.get('--views') || VALID_VIEWS.join(',')).split(',').map(value => value.trim()).filter(Boolean);
  if (!views.length) throw new CaptureCliError('VIEWS_REQUIRED', '--views must contain at least one view.');
  if (new Set(views).size !== views.length) throw new CaptureCliError('DUPLICATE_VIEW', '--views must not contain duplicates.');
  const unknownView = views.find(view => !VALID_VIEWS.includes(view));
  if (unknownView) throw new CaptureCliError('UNKNOWN_VIEW', `Unknown view ${unknownView}. Use: ${VALID_VIEWS.join(', ')}`);

  const directionText = values.get('--perspective-direction');
  const perspectiveDirection = directionText ? directionText.split(',').map(Number) : null;
  if (perspectiveDirection && (perspectiveDirection.length !== 3 || perspectiveDirection.some(value => !Number.isFinite(value)) || Math.hypot(...perspectiveDirection) === 0)) {
    throw new CaptureCliError('INVALID_PERSPECTIVE_DIRECTION', '--perspective-direction must be a finite nonzero x,y,z vector.');
  }
  const fovText = values.get('--perspective-fov');
  const perspectiveFov = fovText === undefined ? null : Number(fovText);
  if (perspectiveFov !== null && (!Number.isFinite(perspectiveFov) || perspectiveFov < 10 || perspectiveFov > 80)) {
    throw new CaptureCliError('INVALID_PERSPECTIVE_FOV', '--perspective-fov must be within 10..80 degrees.');
  }

  const agent = booleans.has('--agent');
  return {
    help: false,
    json: booleans.has('--json'),
    modelPath,
    texturePath,
    outputPath,
    views,
    geometry: values.get('--geometry') ?? null,
    perspectiveDirection,
    perspectiveFov,
    evidence: {
      masks: agent || booleans.has('--masks'),
      clay: agent || booleans.has('--clay'),
      parts: agent || booleans.has('--parts'),
      surfaceBoundaries: agent || booleans.has('--surface-boundaries'),
    },
  };
}

export const fixedViews = Object.freeze([...VALID_VIEWS]);
