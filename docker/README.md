# docker

Container packaging and local-development orchestration. See
[`spec/web-app-architecture-decision.md`](../spec/web-app-architecture-decision.md)
§D12 (Compose for the POC) and §D14 (Fly.io for hosted POC).

## What's here

- **`Dockerfile`** — multi-stage build for the engine services.
  Build stage: `gradle:9-jdk21` produces `installDist` outputs for
  `api/` and `worker/`. Runtime stage: `eclipse-temurin:21-jre-noble`
  with both apps installed; `ENTRYPOINT` dispatches by `PROCESS_NAME`
  env var (`http` → Ktor api, `worker` → background worker).
- **`entrypoint.sh`** — the dispatch script invoked from the
  Dockerfile's ENTRYPOINT.
- **`.dockerignore`** — keeps `docs/`, `spec/`, `paper/`, `explainer/`,
  and other non-runtime assets out of the build context.
- **`docker-compose.yml`** — Phase 0.5 local-dev stack. See below.

## Local dev stack

Three services wired to Supabase Cloud per ADR D8:

| Service        | Image            | Port            | Purpose                                  |
|----------------|------------------|-----------------|------------------------------------------|
| `engine-api`   | `pgpe-engine:dev` | `8080`         | Ktor HTTP wrapping engine primitives     |
| `engine-worker`| `pgpe-engine:dev` | (none)         | Background pgmq poller                   |
| `web`          | `node:22-alpine` | `5173`          | Vite dev server with HMR over bind mount |

The two engine containers share the same built image; only their
`PROCESS_NAME` env var differs — matching the Fly.io two-process
deploy pattern (D14).

### First-time setup

1. Make sure `../.env.local` exists at the repo root with the
   Supabase URL, anon key, service-role key, JWT secret, DB URL,
   etc. (see `../.env.example` for the schema).
2. Make sure Docker Desktop (or another Docker daemon) is running.

### Bring the stack up

From the repo root:

```bash
docker compose -f docker/docker-compose.yml up --build
```

Or from inside this directory:

```bash
docker compose up --build
```

First build takes a few minutes (Gradle warm-up + Kotlin compile
inside the container). Subsequent rebuilds are fast — Docker caches
layers.

Detached: add `-d`. Tail logs: `docker compose -f docker/docker-compose.yml logs -f`.

### Verify

```bash
# api responds
curl http://localhost:8080/healthz
# -> {"status":"ok","service":"pgpe-api"}

# frontend serves
curl -I http://localhost:5173/
# -> HTTP/1.1 200 OK

# worker is polling pgmq
docker compose -f docker/docker-compose.yml logs engine-worker --tail 5
# -> ... alive — no messages on 'q_placeholder'
```

In the browser at <http://localhost:5173>, the Phase 0.4 flow works
end-to-end: email magic-link sign-in via Supabase Auth + "Call
/healthz" hitting the in-container api.

### Tear down

```bash
docker compose -f docker/docker-compose.yml down
```

## When to use compose vs native dev

Both workflows are supported.

| Workflow | Best for | Trade-off |
|----------|----------|-----------|
| `docker compose up` | Reproducible env across machines; one command brings the whole stack; closest to production (matches the Fly.io shape) | Slower iteration on Kotlin code (image rebuild required); HMR works but slightly slower than native |
| `gradle :api:run` + `gradle :worker:run` + `npm run dev` in three terminals | Fastest Kotlin iteration (Gradle hot incremental compile); native node for sharpest HMR | Three terminals; depends on local JDK/Node setup |

For day-to-day development on the Kotlin services, native is faster.
For testing the actual deploy shape or onboarding someone unfamiliar
with the project's local toolchain, compose is the single command
that "just works."

## Profiles

The compose file currently defines no explicit profiles — all three
services come up together with `up`. Phase 0.6 (Fly.io) doesn't use
compose; profiles can be added later if we need to differentiate
backend-only, frontend-only, or other slices.
