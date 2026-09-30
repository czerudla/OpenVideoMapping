// Lokální server: servíruje editor a přeposílá příkazy PJLink na projektor.
// Prohlížeč neumí otevřít TCP spojení, proto tento malý most.
// Spuštění: npm start (nebo node server/serve.js). Bez závislostí, Node 18+.

import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '127.0.0.1'; // jen tento počítač

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

// Povolené příkazy – most nepřeposílá nic jiného.
const ALLOWED = new Set(['AVMT 31', 'AVMT 30', 'AVMT ?', 'POWR 1', 'POWR 0', 'POWR ?']);
const HOST_RE = /^[a-zA-Z0-9.\-:]{1,253}$/;

function pjlink({ host, password = '', command, port = 4352 }) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port });
    sock.setEncoding('latin1');
    let buf = '';
    let sent = false;
    let done = false;

    const finish = (err, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      if (err) reject(err); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('Projektor neodpověděl do 4 s. Zkontrolujte IP a zapnutí PJLink v menu projektoru.')), 4000);

    sock.on('error', (err) => finish(new Error(`Spojení selhalo: ${err.code || err.message}`)));
    sock.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\r')) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!sent) {
          if (line.startsWith('PJLINK 0')) {
            sock.write(`%1${command}\r`);
            sent = true;
          } else if (line.startsWith('PJLINK 1')) {
            if (!password) return finish(new Error('Projektor vyžaduje heslo PJLink.'));
            const random = line.slice(9).trim();
            const digest = crypto.createHash('md5').update(random + password).digest('hex');
            sock.write(`${digest}%1${command}\r`);
            sent = true;
          } else if (line.includes('ERRA')) {
            return finish(new Error('Projektor odmítl heslo PJLink.'));
          } else {
            return finish(new Error(`Neočekávaná odpověď: ${line}`));
          }
        } else {
          if (line.includes('ERRA')) return finish(new Error('Projektor odmítl heslo PJLink.'));
          return finish(null, line);
        }
      }
    });
  });
}

function sendJson(res, code, body) {
  res.writeHead(code, { 'Content-Type': MIME['.json'] });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 10_000) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > limit) throw new Error('Příliš velký požadavek');
  }
  return data;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/pjlink' && req.method === 'POST') {
    try {
      const { host, password, command } = JSON.parse(await readBody(req));
      if (!HOST_RE.test(String(host))) return sendJson(res, 400, { ok: false, error: 'Neplatná adresa projektoru.' });
      if (!ALLOWED.has(command)) return sendJson(res, 400, { ok: false, error: 'Nepovolený příkaz.' });
      const response = await pjlink({ host, password, command });
      console.log(`PJLink ${host}: ${command} → ${response}`);
      return sendJson(res, 200, { ok: true, response });
    } catch (err) {
      return sendJson(res, 200, { ok: false, error: err.message });
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }

  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(ROOT, `.${rel}`);
  if (!file.startsWith(ROOT + path.sep) || file.includes(`${path.sep}server${path.sep}`)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if (!(await stat(file)).isFile()) throw new Error();
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nenalezeno');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Videomapping běží na http://localhost:${PORT}`);
});
