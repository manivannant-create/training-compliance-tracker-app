# Training Compliance Tracker

A single combined Node.js app that serves the dashboard frontend **and** proxies
calls to the training APIs (MSMS / CBC training systems) — no separate proxy
service needed, no CORS configuration needed, one URL for the whole team.

## Project structure

```
.
├── server.js          # Node server: serves /public AND handles /proxy requests
├── package.json
├── render.yaml         # one-click Render deploy config
└── public/
    └── index.html      # the full dashboard app (frontend)
```

## Run locally

```bash
npm install   # no dependencies, but sets things up
npm start
```

Then open **http://localhost:3001** in your browser. That's it — frontend and
proxy are both served from this one address, so there's nothing else to
configure.

## Deploy to Render (free tier)

1. Push this folder to a GitHub repo (private is fine).
2. Go to [render.com](https://render.com) → **New** → **Web Service** → connect
   the repo.
3. Render will detect `render.yaml` automatically. Click **Create Web Service**.
4. After the build finishes (~1-2 min), you'll get a public URL like:
   ```
   https://training-compliance-tracker.onrender.com
   ```
5. Share that URL with your training team and manager. Everyone logs in with
   their own MSMS username/reference code — no shared credentials needed.

## Security note

`server.js` only proxies requests to a fixed allowlist of training-API hosts
(see `ALLOWED_HOSTS` at the top of the file). Any other target is rejected
with `403 Host not in allowlist`, so the public proxy endpoint can't be used
to relay traffic anywhere else.

## Updating the dashboard later

Edit `public/index.html` directly and redeploy (push to GitHub — Render
auto-redeploys on push if connected to your repo).
