# Olivander Technologies

AI operations layer for NZ South Island service SMEs. See `CLAUDE.md` for full project guide.

## Deploy on Render

This repo uses a [Render Blueprint](https://render.com/docs/blueprint-spec) (`render.yaml`).

1. Push the repo to GitHub.
2. In Render, go to **New → Blueprint** and connect the GitHub repo.
3. Render will read `render.yaml` and configure the service automatically.
4. Add the required environment variables (see below) in the Render dashboard.
5. Deploy.

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `RENDER` | Set to `true` (enables production mode) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL (e.g. `https://olivander-api.onrender.com/auth/google/callback`) |
| `FRONTEND_ORIGIN` | Frontend URL (e.g. `https://olivander.vercel.app`) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service-role key (bypasses RLS) |
| `GROQ_API_KEY` | Groq API key for LLM |
| `JWT_SECRET` | Secret for HS256 JWT session tokens |
| `ENCRYPTION_KEY` | Fernet key for encrypting OAuth tokens |
| `WEBHOOK_SECRET` | Secret for Gmail Pub/Sub webhook auth |

Generate secrets:
```bash
# ENCRYPTION_KEY
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

# JWT_SECRET / WEBHOOK_SECRET
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### Healthcheck

Render uses `/health` (configured in `render.yaml`). Returns `200 OK` with `{"status": "ok"}`.

## Local Development

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # Fill in all values
uvicorn main:app --reload --port 8000

# Frontend
cd frontend
npm install
cp .env.example .env  # Set VITE_API_URL=http://localhost:8000
npm run dev
```

## Local Docker Run

```bash
docker build -t olivander .
docker run --env-file backend/.env -e FRONTEND_ORIGIN=http://localhost:5173 -p 8000:8000 olivander
```
