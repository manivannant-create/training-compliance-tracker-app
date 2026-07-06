const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PORT       = process.env.PORT || 3001;
const PUBLIC_DIR = path.join(__dirname, 'public');

const ALLOWED_HOSTS = [
  'qe5r30ot7h.execute-api.ap-south-1.amazonaws.com',  // login
  '6va3ybcm11.execute-api.ap-south-1.amazonaws.com',  // CBC training APIs
  '7owx3yayv1.execute-api.ap-south-1.amazonaws.com',  // staff management
  'qkpovsx8ol.execute-api.ap-south-1.amazonaws.com',  // activity calendar + question bank
  'training.masclass.in',                              // external training list
];

const MIME = {
  '.html':'text/html', '.js':'application/javascript',
  '.css':'text/css',   '.json':'application/json',
  '.png':'image/png',  '.ico':'image/x-icon',
};

function upstream(targetUrl, method, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const opts = {
      hostname: u.hostname,
      port:     u.port || 443,
      path:     u.pathname + u.search,
      method:   method || 'GET',
      headers:  { ...headers, Host: u.hostname },
    };
    delete opts.headers['origin'];
    delete opts.headers['referer'];
    delete opts.headers['host'];

    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end',  () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(25000, () => req.destroy(new Error('Upstream timeout')));
    if (body) req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-auth-token');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);

  // Health check
  if (reqUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'training-compliance-tracker' }));
    return;
  }

  // Proxy
  if (reqUrl.pathname === '/proxy') {
    const target = reqUrl.searchParams.get('target');
    if (!target) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing target' })); return; }
    let tUrl;
    try {
      tUrl = decodeURIComponent(target);
      if (!ALLOWED_HOSTS.includes(new URL(tUrl).hostname)) {
        res.writeHead(403); res.end(JSON.stringify({ error: 'Host not in allowlist' })); return;
      }
    } catch { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid URL' })); return; }

    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const fwd = { ...req.headers }; delete fwd['host'];
        const r = await upstream(tUrl, req.method, fwd, body || null);
        res.writeHead(r.status, { 'Content-Type': 'application/json' });
        res.end(r.body);
      } catch (e) {
        res.writeHead(502); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Static files
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