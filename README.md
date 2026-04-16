# Olivander Technologies

This repo is now set up for single-service Railway deployment from Git using Docker.

## What was added

- Root [Dockerfile](/Users/ollie/Downloads/OTechnologies/olivander-proto/Dockerfile)
  Builds the Vite frontend, packages the FastAPI backend, and serves the built app from one container.
- Root [.dockerignore](/Users/ollie/Downloads/OTechnologies/olivander-proto/.dockerignore)
  Keeps secrets, caches, logs, and local build artifacts out of the deploy build context.

## Deploy on Railway

1. Push the repo to GitHub.
2. In Railway, create a new service from the GitHub repo root.
3. Railway will detect the root [railway.toml](/Users/ollie/Downloads/OTechnologies/olivander-proto/railway.toml) and [Dockerfile](/Users/ollie/Downloads/OTechnologies/olivander-proto/Dockerfile).
4. Add the required service variables.
5. Deploy, then attach your public domain.

Required runtime environment variables:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `GROQ_API_KEY`
- `JWT_SECRET`
- `ENCRYPTION_KEY`
- `WEBHOOK_SECRET`
- `FRONTEND_ORIGIN`

Recommended values for deployed URLs:

- `FRONTEND_ORIGIN=https://your-app-domain`
- `GOOGLE_REDIRECT_URI=https://your-app-domain/auth/google/callback`

Railway healthcheck:

- `railway.toml` points Railway at `/health`
- [backend/main.py](/Users/ollie/Downloads/OTechnologies/olivander-proto/backend/main.py) now serves `200 OK` from that endpoint

Optional build variables:

- `VITE_API_URL`
  Leave blank for same-origin deployment. The frontend now falls back to `window.location.origin` in production.
- `VITE_GOOGLE_CLIENT_ID`

## Local Docker run

```bash
docker build -t olivander .
docker run --env-file backend/.env -e FRONTEND_ORIGIN=http://localhost:8000 -p 8000:8000 olivander
```

Then open [http://localhost:8000](http://localhost:8000).
