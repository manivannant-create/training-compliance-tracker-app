const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3001;
const PUBLIC_DIR = path.join(__dirname, 'public');

// SECURITY: Only these hosts can be proxied to.
// Stops the public server from being abused as an open relay.
const ALLOWED_HOSTS = [
  'qe5r30ot7h.execute-api.ap-south-1.amazonaws.com',
  '6va3ybcm11.execute-api.ap-south-1.amazonaws.com',
  '7owx3yayv1.execute-api.ap-south-1.amazonaws.com',
  'training.masclass.in',
];

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function makeUpstreamRequest(targetUrl, method, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: method || 'GET',
      headers: { ...headers, Host: parsed.hostname },
    };
    delete options.headers['origin'];
    delete options.headers['referer'];
    delete options.headers['host'];
    options.headers['Host'] = parsed.hostname;

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('Upstream request timed out')));
    if (body) req.write(body);
    req.end();
  });
}

function handleProxy(req, res, reqUrl) {
  const target = reqUrl.searchParams.get('target');

  if (!target) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing target param' }));
    return;
  }

  let targetUrl;
  try {
    targetUrl = decodeURIComponent(target);
    const parsedHost = new URL(targetUrl).hostname;
    if (!ALLOWED_HOSTS.includes(parsedHost)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Host not in allowlist', host: parsedHost }));
      return;
    }
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid target URL' }));
    return;
  }

  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', async () => {
    try {
      const forwardHeaders = { ...req.headers };
      delete forwardHeaders['host'];
      const result = await makeUpstreamRequest(targetUrl, req.method, forwardHeaders, body || null);
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(result.body);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

function handleStatic(req, res, reqUrl) {
  let filePath = reqUrl.pathname === '/' ? '/index.html' : reqUrl.pathname;
  filePath = path.join(PUBLIC_DIR, filePath);

  // Prevent path traversal outside the public directory
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      // SPA-style fallback: serve index.html for unknown paths
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, fallback) => {
        if (err2) {
          res.writeHead(404);
          res.end('Not found');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(fallback);
        }
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  // CORS headers (harmless even same-origin; useful if anyone embeds it)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-auth-token');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);

  if (reqUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'training-compliance-tracker' }));
    return;
  }

  if (reqUrl.pathname === '/proxy') {
    handleProxy(req, res, reqUrl);
    return;
  }

  handleStatic(req, res, reqUrl);
});

server.listen(PORT, () => console.log(`✅ Training Compliance Tracker running on port ${PORT}`));
