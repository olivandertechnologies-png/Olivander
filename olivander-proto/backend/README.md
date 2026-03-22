Secrets are loaded from `.secrets/credentials.json` (preferred) or environment variables.

Expected JSON shape:

```json
{
  "GROQ_API_KEY": "your-groq-api-key",
  "GOOGLE_CLIENT_ID": "your-google-client-id",
  "GOOGLE_CLIENT_SECRET": "your-google-client-secret",
  "GOOGLE_REDIRECT_URI": "http://localhost:8000/auth/google/callback"
}
```

```bash
uvicorn main:app --reload
```
