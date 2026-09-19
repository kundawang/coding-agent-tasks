// 零依赖静态服务器：node tools/serve.mjs [端口]
// 等价于 python -m http.server，纯为本地没有 Python 时备用。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] ?? 8000);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = normalize(join(root, urlPath === '/' ? 'index.html' : urlPath));
    if (!path.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`emberdeck on http://localhost:${port}`));
