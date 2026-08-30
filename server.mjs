import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
]);

function routeToFile(urlPath) {
  const pathname = urlPath.split('?')[0];
  if (pathname === '/') return path.join(ROOT, 'index.html');
  if (pathname === '/vendor/three.module.js') {
    return path.join(ROOT, 'node_modules', 'three', 'build', 'three.module.js');
  }
  if (pathname === '/vendor/three.core.js') {
    return path.join(ROOT, 'node_modules', 'three', 'build', 'three.core.js');
  }
  if (pathname === '/vendor/OrbitControls.js') {
    return path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm', 'controls', 'OrbitControls.js');
  }
  const decoded = decodeURIComponent(pathname);
  const resolved = path.resolve(ROOT, `.${decoded}`);
  const relative = path.relative(ROOT, resolved);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? resolved : null;
}

export function resolveViewerPath(urlPath) {
  return routeToFile(urlPath);
}

export function createViewerServer() {
  return http.createServer(async (request, response) => {
    try {
      const target = routeToFile(request.url || '/');
      if (!target || !(await stat(target)).isFile()) throw new Error('Not found');
      const body = await readFile(target);
      response.writeHead(200, {
        'Content-Type': MIME.get(path.extname(target)) || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(body);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  const server = createViewerServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`Minecraft Entity Viewer: http://127.0.0.1:${port}`);
  });
}
