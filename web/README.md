# web

React + TypeScript + Vite frontend for the pg-policy-engine web app
surface. See
[`spec/web-app-architecture-decision.md`](../spec/web-app-architecture-decision.md)
§D1 (frontend framework) and §D4 (Realtime).

## Phase 0.4 scope

Minimum-viable scaffold:

- React 19 + TypeScript + Vite
- `@supabase/supabase-js` wired to the POC Supabase project
- Email magic-link sign-in via Supabase Auth
- A "Call /healthz" button that hits the Ktor api (D2)

Future phases layer features on top of this shell:

- Phase 1 (Schema Overlay): React Flow graph, target connection UI,
  Realtime subscriptions on `schema_status`
- Phase 2 (Simulator): table viewer, session-variable inputs
- Phase 3 (Editor): CodeMirror, three-pane layout
- Phase 4+: proof inspector, drift timeline, binder, recommendation wizard

## Local development

Prereqs: Node 18+ (Vite 8 requirement), npm.

```bash
cd web
npm install
cp .env.example .env.local
# edit .env.local with values from supabase/README.md (POC project)
npm run dev
```

The dev server runs on `http://localhost:5173`. Hot-module-reload is on.

Make sure the Ktor api is running on `http://localhost:8080` (or set
`VITE_API_URL` in `.env.local`) so the "Call /healthz" button has
something to hit.

## Environment variables

See `.env.example`. Only `VITE_*`-prefixed variables are exposed to the
client bundle.

| Name                       | Required | Notes                                                     |
|----------------------------|----------|-----------------------------------------------------------|
| `VITE_SUPABASE_URL`        | yes      | POC: `https://lqapmmlwmpffbqaqtvtc.supabase.co`            |
| `VITE_SUPABASE_ANON_KEY`   | yes      | Publishable; safe to ship to clients                       |
| `VITE_API_URL`             | no       | Defaults to `http://localhost:8080` if unset               |

`.env.local` is gitignored.

## Build

```bash
npm run build
```

Produces `dist/` — static assets ready for Cloudflare Pages (Phase 0.7).

## Layout

```
web/
├── index.html             # entry; title set to "pg-policy-engine"
├── src/
│   ├── main.tsx           # React root
│   ├── App.tsx            # sign-in + /healthz placeholder UI
│   ├── App.css            # scoped styles for App
│   ├── index.css          # body / root resets
│   ├── vite-env.d.ts      # typed env vars
│   └── lib/
│       └── supabase.ts    # supabase-js client singleton
├── .env.example
├── .env.local             # gitignored
├── package.json
├── vite.config.ts
└── tsconfig*.json
```
