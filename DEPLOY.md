# Deploying PitchPerfect

Hybrid setup: GPU backend on Modal, static frontend on Vercel.
The frontend makes all API calls to `/api/*`; Vercel rewrites them to Modal.

---

## 1. Deploy the backend to Modal

```bash
# Install Modal CLI (one-time)
pip install modal

# Authenticate (one-time) — opens browser for login
modal setup

# Deploy from the project root
modal deploy modal_app.py
```

Modal will print a URL like:
```
https://your-workspace--pitchperfect-fastapi-app.modal.run
```

Copy that URL. You need it in the next step.

---

## 2. Wire the frontend to Modal

Open `frontend/vercel.json` and replace `MODAL_URL` with the URL from step 1:

```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://your-workspace--pitchperfect-fastapi-app.modal.run/api/:path*"
    },
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

---

## 3. Deploy the frontend to Vercel

```bash
# Install Vercel CLI (one-time)
npm i -g vercel

# From the frontend/ directory
cd frontend
vercel --prod
```

When prompted:
- **Root directory**: `frontend` (it should detect this automatically)
- **Build command**: `npm run build`
- **Output directory**: `dist`
- **Framework**: Vite

Vercel will print a URL like `https://pitchperfect.vercel.app`. Share that with your beta testers.

---

## Updating after code changes

**Backend change** (Python files in `backend/`):
```bash
modal deploy modal_app.py
```
This rebuilds the container image and hot-swaps it with zero downtime.

**Frontend change** (files in `frontend/src/`):
```bash
cd frontend && vercel --prod
```

---

## Useful Modal commands

```bash
# View live logs
modal logs pitchperfect

# Open the Modal dashboard
modal dashboard

# Check current deployments
modal app list

# Stop the app (scale to zero immediately)
modal app stop pitchperfect
```

---

## Cost estimates

| Component | Cost |
|---|---|
| Modal A10G GPU | ~$0.60/hr, billed per second while processing |
| Modal idle (scale to zero) | $0 |
| Vercel frontend | Free (Hobby tier) |
| Modal Volume (1 GB) | ~$0.20/month |

For 5-10 beta users processing ~10 songs total: expect **under $5 total**.

---

## Local development (unchanged)

```bash
# Backend
cd backend && uvicorn backend.main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend && npm run dev
```
