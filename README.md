# LeLong2025 App

This directory is the main app. The sibling `Lelong2025.github.io` and
`LHU-magazine` directories are legacy references only and should not be edited
for current development.

## Routes

| URL | Purpose |
| --- | --- |
| `/` | Landing page and shared auth entry |
| `/tapchi/` | Journal lookup, AI chat, account and payments |
| `/magazine/` | Magazine login/register |
| `/magazine/editor.html` | Magazine editor |

## Project Layout

```txt
backend/          Node API server for AI, account, payment, admin routes
magazine/         Magazine HTML entrypoints and legacy editor modules
tapchi/           Tapchi HTML entrypoint
src/shared/       Shared shell, Supabase, auth, config and API helpers
public/           Static runtime assets
index.html        Landing page
vite.config.js    Vite multi-page app config
```

## Frontend Dev

```bash
npm install
cp .env.example .env
npm run dev
```

Frontend `.env` only uses public browser variables:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_API_URL=
```

For local development, leave `VITE_API_URL` empty to call same-origin `/api`.
Vite proxies `/api/*` to `http://localhost:10000/api/*`.

## Backend Dev

```bash
cd backend
npm install
cp .env.example .env
npm start
```

Backend `.env` is separate from the frontend `.env` and may contain secrets:

```env
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
OPENAI_API_KEY=
SEPAY_WEBHOOK_AUTH=
SEPAY_WEBHOOK_SECRET=
SEPAY_WEBHOOK_API_KEY=
SEPAY_BANK=
SEPAY_ACCOUNT_NUMBER=
SEPAY_ACCOUNT_NAME=
ALLOWED_ORIGINS=
PORT=10000
```

Never put `SUPABASE_SECRET_KEY`, `OPENAI_API_KEY`, or SePay secrets in the
frontend `.env`.

## Backend API Surface

The frontend expects these routes to keep their current shape:

- `/api/chat`
- `/api/account`
- `/api/public/config`
- `/api/orders`
- `/api/orders/:code/status`
- `/api/admin/dashboard`
- `/api/admin/settings`
- `/hooks/sepay-payment`

## Refactor Notes

- Shared browser auth lives in `src/shared/utils/auth.js`.
- Shared Supabase client lives in `src/shared/utils/supabase.js`.
- Shared API calls should go through `src/shared/utils/api.js`.
- `tapchi/index.html` and Magazine legacy modules are being migrated
  gradually; keep URLs and Supabase database contracts stable while moving
  logic into shared modules.
