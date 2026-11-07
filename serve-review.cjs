'use strict';

const http = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const directory = path.join(__dirname, 'html-review');
const pages = new Set([
  'index.html', 'website.html', 'platform.html', 'bigscreen.html',
  'culture.html', 'library.html', 'mobility.html', 'scheduling.html',
  'field-app.html', 'repair-mini.html', 'style-lab.html', 'intake.html', 'editions.html',
  'materials.html', 'assets.html', 'reader.html', 'cues.html', 'atlas.html', 'depot.html', 'programme.html', 'handover.html', 'proofroom.html', 'policy-diff.html'
]);

function parsePort(value = '4173') {
  const port = Number(value);
  if (!/^\d+$/.test(value) || port < 1024 || port > 65535) {
    throw new RangeError('Port must be a decimal integer from 1024 to 65535.');
  }
  return port;
}

function createReviewServer() {
  const limits = { headersTimeout: 10_000, requestTimeout: 15_000, keepAliveTimeout: 5_000 };
  return http.createServer(limits, async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }

    // Match one known file before touching the filesystem. Preserve the original request
    // path here: URL normalization would turn a traversal into a valid-looking route.
    const rawPath = req.url.split('?', 1)[0];
    let pathname;
    try {
      pathname = decodeURIComponent(rawPath);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const name = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!rawPath.startsWith('/') || !pages.has(name)) {
      res.writeHead(404).end();
      return;
    }

    try {
      const content = await readFile(path.join(directory, name));
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': content.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer'
      });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500).end();
    }
  });
}

if (require.main === module) {
  try {
    if (process.argv.length > 3) throw new Error('Usage: node serve-review.cjs [port]');
    const port = parsePort(process.argv[2]);
    const server = createReviewServer();
    server.on('error', err => {
      console.error(err.code === 'EADDRINUSE' ? 'Port ' + port + ' is already in use.' : err.message);
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => {
      console.log('FORMA review ready: http://127.0.0.1:' + port + '/');
    });
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

module.exports = { createReviewServer, parsePort };
