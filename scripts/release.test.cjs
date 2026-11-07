'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { request } = require('node:http');
const { readFile, readdir, stat } = require('node:fs/promises');
const path = require('node:path');
const { Script } = require('node:vm');
const { createReviewServer, parsePort } = require('../serve-review.cjs');

const root = path.resolve(__dirname, '..');
const review = path.join(root, 'html-review');
const samples = ['assets', 'atlas', 'bigscreen', 'bloom', 'blueprint', 'cues', 'culture', 'departures', 'depot', 'editions', 'field-app', 'handover', 'intake', 'library', 'materials', 'mobility', 'orbital', 'platform', 'policy-diff', 'programme', 'proofroom', 'reader', 'repair-mini', 'scheduling', 'splitline', 'sprout', 'style-lab', 'website'];
const expected = ['index', ...samples].map(name => name + '.html').sort();
let server;
let port;

before(async () => {
  server = createReviewServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  port = server.address().port;
});

after(async () => {
  if (server.listening) await new Promise(resolve => server.close(resolve));
});

// The raw request path matters for traversal tests. fetch() normalizes it first.
function get(target, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: target, method, agent: false }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve({
        status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks)
      }));
    });
    req.on('error', reject);
    req.setTimeout(5_000, () => req.destroy(new Error('Review request timed out')));
    req.end();
  });
}

test('the deployment directory contains only the published HTML files', async () => {
  const entries = await readdir(review, { withFileTypes: true });
  assert.deepEqual(entries.map(entry => entry.name).sort(), expected);
  assert.ok(entries.every(entry => entry.isFile()), 'Every deployed entry must be a regular file');
});

test('the review shell and each standalone page return the complete UTF-8 file', async () => {
  const index = await readFile(path.join(review, 'index.html'));
  for (const name of expected) {
    const res = await get('/' + name);
    assert.equal(res.status, 200, name);
    assert.match(res.headers['content-type'], /^text\/html;\s*charset=utf-8/i);
    assert.deepEqual(res.body, await readFile(path.join(review, name)), name);
    const head = await get('/' + name, 'HEAD');
    assert.equal(head.status, 200, name);
    assert.equal(Number(head.headers['content-length']), res.body.length, name);
    assert.equal(head.body.length, 0, name);
  }
  for (const target of ['/', ...samples.map(name => '/?page=' + name)]) {
    const res = await get(target);
    assert.equal(res.status, 200, target);
    assert.deepEqual(res.body, index, target);
  }
});

test('non-page requests cannot read source files or escape the review directory', async () => {
  for (const target of [
    '/README.md', '/serve-review.cjs', '/skills/forma-ui-ux-design/SKILL.md',
    '/../index.html', '/folder/../index.html', '/%2e%2e%2findex.html',
    '/%2e%2e%5cserve-review.cjs', '//example.test/index.html',
    'http://example.test/index.html', '/index.html%00'
  ]) {
    assert.equal((await get(target)).status, 404, target);
  }
  assert.equal((await get('/%GG')).status, 400);
  const rejected = await get('/index.html', 'POST');
  assert.equal(rejected.status, 405);
  assert.equal(rejected.headers.allow, 'GET, HEAD');
});

test('the CLI defaults to port 4173 and rejects invalid port arguments', () => {
  assert.equal(parsePort(), 4173);
  assert.equal(parsePort('4180'), 4180);
  for (const value of ['0', '1023', '65536', '80.5', '4e3', '0x104d', '']) {
    assert.throws(() => parsePort(value), RangeError);
  }
});

test('all review tabs and their frame targets resolve under a repository subpath', async () => {
  const html = await readFile(path.join(review, 'index.html'), 'utf8');
  const tabs = [...html.matchAll(/\bdata-page\s*=\s*["']([\w-]+)["']/g)].map(match => match[1]);
  assert.deepEqual(tabs.sort(), samples);
  const files = [...html.matchAll(/\bfile\s*:\s*["']([^"']+\.html)["']/g)].map(match => match[1]);
  const prefix = new URL('https://host.invalid/team/repository/');
  const paths = files.map(file => {
    const target = new URL(file, prefix);
    assert.equal(target.origin, prefix.origin);
    assert.ok(target.pathname.startsWith(prefix.pathname), file + ' escapes the Pages subpath');
    return target.pathname.slice(prefix.pathname.length);
  });
  assert.deepEqual(paths.sort(), samples.map(name => name + '.html'));
});

test('pages can render offline and all inline scripts parse', async () => {
  for (const name of expected) {
    const html = await readFile(path.join(review, name), 'utf8');
    const markup = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (tag, attributes, body, offset) => {
      assert.doesNotMatch(attributes, /\bsrc\s*=/i, name + ' requires an external script');
      const lineOffset = html.slice(0, offset).split('\n').length - 1;
      try {
        new Script(body, { filename: name, lineOffset });
      } catch (err) {
        assert.fail(err.stack);
      }
      return '';
    });
    // Navigation may link to cited sources. Rendered assets must travel with the HTML.
    for (const match of markup.matchAll(/<(?:img|source|link|iframe|image|use)\b[^>]*?\s(?:src|srcset|href)\s*=\s*["']([^"']+)["']/gi)) {
      assert.match(match[1], /^(?:#|data:)/, name + ' loads ' + match[1]);
    }
    for (const match of markup.matchAll(/\burl\(\s*["']?([^'")\s]+)["']?\s*\)/gi)) {
      assert.match(match[1], /^(?:#|data:)/, name + ' loads ' + match[1]);
    }
  }
});

test('relative links in the skill resolve inside its portable folder', async () => {
  const skillDir = path.join(root, 'skills', 'forma-ui-ux-design');
  const refs = (await readdir(path.join(skillDir, 'references'))).filter(name => name.endsWith('.md'));
  const guides = ['SKILL.md', ...refs.map(name => 'references/' + name)];
  for (const guide of guides) {
    const content = await readFile(path.join(skillDir, guide), 'utf8');
    for (const [, target] of content.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(?:https?:|#)/i.test(target)) continue;
      const filename = path.resolve(skillDir, path.dirname(guide), decodeURIComponent(target.split('#')[0]));
      assert.ok(filename.startsWith(skillDir + path.sep), guide + ' links outside the skill: ' + target);
      assert.ok((await stat(filename)).isFile(), guide + ' has a missing resource: ' + target);
    }
  }
});

test('README links and preview images are present in the upload', async () => {
  const content = await readFile(path.join(root, 'README.md'), 'utf8');
  for (const [, target] of content.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(?:https?:|#)/i.test(target)) continue;
    const filename = path.resolve(root, decodeURIComponent(target.split('#')[0]));
    assert.ok(filename.startsWith(root + path.sep), 'README link leaves the repository: ' + target);
    await stat(filename);
  }
});
