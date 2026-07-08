const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PORT       = process.env.PORT || 3001;
const PUBLIC_DIR = path.join(__dirname, 'public');

const ALLOWED_HOSTS = [
  'qe5r30ot7h.execute-api.ap-south-1.amazonaws.com',
  '6va3ybcm11.execute-api.ap-south-1.amazonaws.com',
  '7owx3yayv1.execute-api.ap-south-1.amazonaws.com',
  'qkpovsx8ol.execute-api.ap-south-1.amazonaws.com',
  'training.masclass.in',
];

const MIME = {
  '.html':'text/html', '.js':'application/javascript',
  '.css':'text/css',   '.json':'application/json',
  '.png':'image/png',  '.ico':'image/x-icon',
};

// masclass.in requires its own fixed static API key, separate from the user's session token.
// Kept server-side only (Render env var) — never shipped to the browser or committed to git.
const MASCLASS_API_KEY = process.env.MASCLASS_API_KEY || '';

// Every auth header variant any API might need — all must be in CORS allow list
const CORS_HEADERS = 'Content-Type,Authorization,X-API-Key,x-api-key,token,x-auth-token,x-access-token,apikey,api-key';

function upstream(targetUrl, method, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const fwd = { ...headers, Host: u.hostname };

    // Strip browser-only headers that break upstream HTTPS requests
    delete fwd['origin'];
    delete fwd['referer'];
    delete fwd['host'];
    delete fwd['connection'];

    // masclass.in checks X-Api-Key against its own static key, not the login session token.
    // Overwrite whatever the client sent with the real key, injected server-side only.
    if (u.hostname === 'training.masclass.in') {
      if (MASCLASS_API_KEY) {
        fwd['x-api-key'] = MASCLASS_API_KEY;
        delete fwd['X-Api-Key']; // avoid sending a duplicate/stale key under a different case
      } else {
        console.warn('[proxy] MASCLASS_API_KEY env var is not set — masclass.in calls will 401');
      }
    }

    // Log auth headers being forwarded — visible in Render logs
    const authPresent = ['x-api-key','authorization','token','x-auth-token']
      .filter(h => fwd[h])
      .map(h => `${h}=${String(fwd[h]).substring(0,15)}...`);
    console.log(`[proxy] ${method} ${u.hostname}${u.pathname.substring(0,40)} | auth: ${authPresent.length ? authPresent.join(', ') : '⚠️ NONE'}`);

    // Collapse accidental double slashes in the path (e.g. '/api/v1//foo' -> '/api/v1/foo')
    // Some upstream API gateways fail to match routes with empty path segments and
    // respond with a generic 401/403 instead of a routing error, which is confusing to debug.
    const cleanPath = u.pathname.replace(/\/{2,}/g, '/');

    const opts = {
      hostname: u.hostname,
      port:     u.port || 443,
      path:     cleanPath + u.search,
      method:   method || 'GET',
      headers:  fwd,
    };

    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        console.log(`[proxy] ← HTTP ${res.statusCode} from ${u.hostname}`);
        resolve({ status: res.statusCode, body: data });
      });
    });
    req.on('error', reject);
    req.setTimeout(25000, () => req.destroy(new Error('Upstream timeout')));
    if (body) req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', CORS_HEADERS);
  res.setHeader('Access-Control-Max-Age',       '86400');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);

  if (reqUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'training-compliance-tracker' }));
    return;
  }

  if (reqUrl.pathname === '/proxy') {
    const target = reqUrl.searchParams.get('target');
    if (!target) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing target param' }));
      return;
    }

    let tUrl;
    try {
      tUrl = decodeURIComponent(target);
      const host = new URL(tUrl).hostname;
      if (!ALLOWED_HOSTS.includes(host)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Host not in allowlist', host }));
        return;
      }
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid target URL' }));
      return;
    }

    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const result = await upstream(tUrl, req.method, req.headers, body || null);
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(result.body);
      } catch (e) {
        console.error('[proxy] upstream error:', e.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Static file serving
  let filePath = path.join(PUBLIC_DIR, reqUrl.pathname === '/' ? 'index.html' : reqUrl.pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, fb) => {
        if (e2) { res.writeHead(404); res.end('Not found'); }
        else    { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(fb); }
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  });
});

server.listen(PORT, () => console.log(`✅ Training Compliance Tracker running on port ${PORT}`));
