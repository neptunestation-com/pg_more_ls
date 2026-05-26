# Changelog

All notable changes to the **web app surface** of `pg-policy-engine`.
The engine's pre-surface history (parser, normalizer, SMT analyzer,
compiler, drift detector, MVP CLI) is captured in the spec artifacts
under `spec/`.

Format follows [Keep a Changelog](https://keepachangelog.com/);
versions follow the [phasing plan](spec/web-app-phasing.md) — each
phase exits with a `v0.x.0-poc` tag.

---

## [Unreleased] — Phase 1 hardening

Bug-fix / hardening pass between Phase 1 and Phase 2. No new features;
no migration of existing data.

### Added

**Org delete** — `public.delete_org(p_org_id uuid)` SECURITY DEFINER RPC.
Verifies the caller is an owner of the org, removes any Vault secrets
referenced by the org's targets (FK CASCADE doesn't reach into the
`vault` schema), then deletes the org row; the existing `ON DELETE
CASCADE` chain cleans up `org_members`, `target_databases`, and the
`schema_*` snapshot rows. Sidebar grows a small × per org header that
opens a typed-confirmation modal. 13 new pgTAP tests; suite-wide total
106.

**Target delete UI** — the Phase 1.4 `DELETE /api/v1/targets/{id}`
endpoint + `delete_target` RPC was already wired but had no UI gesture.
Sidebar now shows a × on each target row that opens a confirmation
modal (lighter friction than the org variant — no typed gate, since
target deletion is more routine and the api owner-check already
prevents accidental cross-org damage). Production targets get an
extra "this is flagged as production" callout in the modal.

### Fixed

**CreateOrgForm anti-duplicate** — the form now enters a terminal
`succeeded` state after a successful insert and stays locked until
Realtime delivers the new orgs row and the parent unmounts it.
Previously the button only disabled during the in-flight request
(~500 ms); a user clicking through a Realtime stall could fire
several sequential inserts before the form realized it had already
won. Closes the failure mode that produced seven duplicate orgs in
seven seconds during the Phase 1.7 dogfood test. The original
proximate cause — missing tables in `supabase_realtime` — was
already fixed in `20260526010123_add_phase1_tables_to_realtime_publication.sql`;
this is the form-side belt-and-braces.

**Missing "Add organization" affordance** — Phase 1.6 shipped
`CreateOrgForm` gated on `orgs.length === 0` (empty-state welcome
screen) but never added a steady-state "+ Add organization" button
for users who already have at least one org. A signed-in user with
any org had no way to create another. Sidebar now has a
"+ Add organization" button at the bottom that opens an `AddOrgModal`
with the same anti-duplicate locking as the empty-state form.

**Column-name truncation in TableNode** — names like `created_at` /
`created_by` were getting clipped to "created…" even when they would
have fit in the node. Two fixes: (1) `min-width: 0` on `.col-name`
so the flex item can actually shrink past its intrinsic word-width
(default `min-width: auto` prevents that); (2) tooltip on each
`col-row` showing `name dataType` so the full text is always
recoverable for long names. Also caps `.col-type` at 45% width so an
exotic long type can't crowd out the column name. Verified against
the `wide` fixture on `/dev/overlay`.

**A11y lint + shared Modal component** — `eslint-plugin-jsx-a11y`
added to the web ESLint config. Initial run surfaced 19 errors,
mostly from four modals (`AddOrg`, `AddTarget`, `DeleteOrg`,
`DeleteTarget`) duplicating the click-on-backdrop pattern without a
keyboard equivalent. Extracted a shared `<Modal>` component that:
  - wraps the backdrop with `role="presentation"` (purely visual)
  - keeps `role="dialog"` + `aria-modal="true"` on the dialog itself
  - adds a `useEscapeKey` hook so Escape closes the modal alongside
    click-outside
  - centralizes the necessary eslint-disables with rationale, instead
    of scattering them
All four modals now use `<Modal>`; their bodies are pure
content. Remaining intentional disables: `autoFocus` on modal inputs
(legitimate UX in a just-opened modal) and `setState`-in-effect for
clearing the snapshot on target-id change (intentional). Lint is
clean: 0 errors, 0 warnings.

Not addressed in this PR (deferred follow-ups): full keyboard
navigation inside the React Flow canvas, screen-reader live regions
for Realtime-driven updates, formal contrast audit. The linter+visual
inspection covers the highest-impact issues; the rest deserve their
own pass.

**Vitest + initial logic tests** — Vitest + `@testing-library/react`
+ `jsdom` wired into `web/`. Two pure-logic modules extracted so
they're testable without rendering: `lib/tablePill.ts` (governance
pill content selection) and `lib/schemaGraph.ts` (already extracted
in the previous CHANGELOG entry; now covered by tests for the
parallel-edge bundle indexing). 14 tests in two files. Run with
`npm test` (or `npm run test:watch`). Not yet in CI — that's a
separate follow-up since the existing `engine-ci` workflow only runs
Gradle tests.

**`/dev/overlay` visual-test route** — fixtures-based harness for
`SchemaGraph`. Mounted at `/dev/overlay` (no auth, no real data
fetched; Cloudflare Pages' SPA fallback handles the deep link).
Picker on the left switches between synthetic snapshots: empty,
single table, wide-with-long-names, parallel FKs, linear chain,
hub-and-spoke, all-status-variants, cyclic FKs, and a 20-table
schema. Unblocks visual regression testing for overlay changes
without needing to introspect a real PostgreSQL database. Add new
scenarios in `src/lib/overlayFixtures.ts`. Also doubles as a pitch
asset: the page works as a static gallery of the kinds of schemas
the overlay renders.

Refactor underneath: `SchemaOverlay` split into a presentational
`SchemaGraph` (snapshot in → canvas + legend out, used by both the
production overlay and the demo) and the existing toolbar +
data-fetching wrapper. `buildGraph` moves to `src/lib/schemaGraph.ts`
so it's importable from Vitest later (no React, no IO).

**Schema overlay: parallel FK edges** — when a table had two FKs to
the same target table (e.g. `friendships(user_a_id, user_b_id)`),
React Flow's default bezier rendered both relationships on the same
path and one column-pair was invisible. New `ParallelEdge` custom
edge type groups relationships by `(source_table, target_table)` and
fans the edges out perpendicular to the straight line (quadratic
bezier, control point offset by `(index − (total − 1) / 2) × 35 px`).
Single edges still route as a straight quadratic with zero offset.

**Schema overlay status: color unification + non-color signal** —
the legend swatches, table borders, and status pills now share a
single source of truth via `--status-{red,yellow,green}-{border,bg,text}`
CSS variables (previously three different yellows etc., none of
which matched). On top of the color fix, governance status now
carries a *non-color* signal so the encoding is usable by viewers
with red-green colorblindness or on monochrome displays: table
borders are **dashed** for no-RLS, **solid** for RLS-on, **double**
for proven-safe. Status pills gain a small `⚠` glyph for no-RLS and
`✓` for proven-safe. The legend mirrors all of it (same border
style, same glyphs) so users can scan a table → legend match without
relying on hue. The pill text (`no rls` / `rls` / `proven`) already
carries semantic meaning for screen readers; the glyphs are
`aria-hidden`.

---

## [v0.1.0-poc] — Phase 1 exit (Schema Overlay) — 2026-05-25

First user-facing feature shipped. A signed-in user can register a
target PostgreSQL database, trigger introspection, and see its
`public`-schema topology rendered as an interactive graph color-coded
by RLS governance status. Closes vision-doc Feature 1.

### Added

**Backend schema** (Phase 1.1)
- `target_databases`, `schema_tables`, `schema_columns`,
  `schema_relationships` with RLS keyed off org membership.
- `governance_status` generated column on `schema_tables` —
  `'red'` (no RLS) or `'yellow'` (RLS on, no proofs run). Phase 4
  will widen this to `'green'` once `proof_runs` lands.
- Two SECURITY DEFINER helpers: `target_belongs_to_my_org` and
  `target_belongs_to_my_owned_org`.
- 36 new pgTAP tests; suite-wide total 58.

**Vault wrappers** (Phase 1.2)
- `set_target_db_password` / `get_target_db_password` — SECURITY
  DEFINER, JWT-claim-gated inside, EXECUTE explicitly granted only
  to `service_role` and revoked from `public` / `authenticated` /
  `anon` to defeat Supabase's project-level default privileges.
- Lesson encoded in commit history: inside SECURITY DEFINER,
  `current_user` is the function owner — for the *caller* identity
  read the JWT claim that PostgREST sets per-request.

**JWT verification** (Phase 1.3)
- Ktor api verifies Supabase JWTs via JWKS (the project signs ES256
  asymmetrically — no shared secret). Lazy fetch + 24h cache.
- All routes opt into auth by living inside `authenticate("supabase")
  {...}`. `/healthz` stays public.
- Placeholder endpoint `GET /api/v1/me` returns `{userId, role, email}`
  from the JWT claims.

**Target management endpoints + RPC wrappers** (Phase 1.4)
- `POST /api/v1/targets`, `POST /api/v1/targets/{id}/introspect`,
  `DELETE /api/v1/targets/{id}` — api is a thin proxy that forwards
  the caller's Bearer JWT to PostgREST.
- Three SECURITY DEFINER RPCs (`create_target`, `enqueue_introspect`,
  `delete_target`) atomically do the cross-schema work (Vault, pgmq)
  and check `auth.uid()` against org membership / ownership.
- New `q_introspect` pgmq queue.
- 21 new pgTAP tests; suite-wide total 93.

**Introspect worker** (Phase 1.5)
- Worker switched from `q_placeholder` polling to `q_introspect`.
- Per job: load target row, decrypt password via Vault wrapper,
  open per-target JDBC connection with timeouts, query
  `information_schema` + `pg_class` for public-schema topology,
  apply via DELETE-then-INSERT inside a backend transaction, stamp
  `last_introspected_at`.
- Errors are logged and the message archived (no retry/DLQ for
  Phase 1 — that's a Phase 5 concern).

**Frontend workspace shell** (Phase 1.6)
- Header (project name + email + sign-out) + sidebar (orgs grouped
  with their targets, live via Supabase Realtime) + main pane.
- Add-target modal with full form (org/name/host/port/db/user/pw/
  ssl_mode/is_production); POSTs to the api endpoint from 1.4.
- New users (no org memberships) land on a "create your first
  organization" form; trigger auto-assigns them as owner.
- Removed the Phase 0.4 `/healthz` debug card.

**Schema overlay** (Phase 1.7)
- React Flow graph (`@xyflow/react`) of the target's public schema,
  auto-laid-out with dagre (left-to-right).
- Custom `TableNode` shows table name, RLS pill, first 5 columns
  with types ("…N more" if truncated). Border color tracks
  `governance_status`.
- FK edges labeled `source_col → target_col`.
- "Refresh schema" button calls `enqueueIntrospect`; the worker
  processes the job and Realtime repaints the graph when
  `schema_*` rows update.
- Legend explains the color codes (with green dimmed until Phase 4).

### Known gaps

- Drift detection / timeline (Phase 5 wishlist)
- Proof status surfacing — `governance_status` stays at red/yellow
  until Phase 4 wires the `proof_runs` table
- Per-target "Edit" gesture isn't in the UI yet (`Delete` shipped in
  the Unreleased / post-Phase-1 hardening pass)
- pgTAP suite still not in CI (needs an ephemeral test database
  story)
- Frontend has no tests yet (Vitest setup deferred again)
- Branch-protection "1 approving review" requirement was removed
  mid-Phase-0 because we're a single-contributor POC; reinstate
  when collaborators join

### Migrations / breaking changes

- Additive only — no schema renames or destructive changes.
- `q_placeholder` pgmq queue still exists in the project (created
  in Phase 0.3) but the worker no longer polls it. Harmless;
  cleanup deferred.

[v0.1.0-poc]: https://github.com/dventimisupabase/pg-policy-engine/releases/tag/v0.1.0-poc

---

## [v0.0.0-poc] — Phase 0 exit — 2026-05-25

Infrastructure scaffolding for the web app surface. No user-facing
features yet; the next phase (Phase 1, Schema Overlay) builds on top
of everything below.

### Added

**Engine subproject** (Phase 0.1)
- Converted the single-module Gradle build into a multi-project
  layout: `engine/`, `api/`, `worker/`. All 100 existing engine tests
  still pass. `application` plugin + CLI moved to the engine
  subproject — invoke via `gradle :engine:run`.
- Added the foojay-resolver plugin so anyone with internet + a JVM
  can build without first installing a JDK 21 by hand.

**Supabase backend** (Phase 0.2)
- Provisioned the `pgpe-poc` project on supabase.com (org
  `supabase-demo`, ref `lqapmmlwmpffbqaqtvtc`, region us-east-1).
  Originally on supabase.green; moved to supabase.com mid-phase
  after staging SMTP credentials proved unusable for magic-link
  auth.
- Initial migration: `orgs`, `org_members`, RLS keyed off
  `auth.uid()`, a `SECURITY DEFINER` membership helper, and a
  trigger that auto-adds an org's creator as its owner. Plus a
  pgmq queue placeholder and the pgtap extension.
- 22 pgTAP tests covering schema sanity, the trigger, and
  member-vs-non-member RLS visibility — runs via
  `supabase test db --linked`.

**Kotlin services** (Phase 0.3)
- `api/`: Ktor 3.1.3 + Netty + kotlinx-serialization. `GET /healthz`
  returns `{"status":"ok","service":"pgpe-api"}`. CORS plugin
  installed (Phase 0.7 wires the deployed frontend's origin).
- `worker/`: Kotlin coroutine loop polling pgmq via direct JDBC.
  Logs `alive — no messages on '<queue>'` on every empty cycle.
- `docker/Dockerfile`: single multi-stage image (`pgpe-engine`) that
  packs both apps; `docker/entrypoint.sh` dispatches based on
  CLI arg (Fly's `[processes]`) or `PROCESS_NAME` env (Compose).

**Frontend scaffold** (Phase 0.4)
- `web/`: Vite + React 19 + TypeScript 6 + `@supabase/supabase-js`.
  Magic-link sign-in flow, "Call /healthz" probe button, light/dark
  CSS, no design dependencies beyond what Vite ships with.

**Local Compose stack** (Phase 0.5)
- `docker/docker-compose.yml` brings up api + worker + web wired to
  Supabase Cloud via root `.env.local`. `docker compose up` from a
  fresh checkout is the one-command onboarding path.

**Fly.io deployment** (Phase 0.6)
- `fly.toml` configures two-process deploy of the engine image:
  `http` (Ktor api, `:8080`) and `worker` (pgmq poller, no exposed
  port). Deployed at <https://pgpe-engine-poc.fly.dev>.

**Cloudflare Pages deployment** (Phase 0.7)
- Frontend live at <https://pgpe-poc.pages.dev>, deployed via
  `wrangler pages deploy`.
- `supabase/config.toml` carries the canonical auth URL allowlist
  (localhost + Pages prod + per-deploy wildcards), synced with
  `supabase config push`.
- Documented the gotcha: `supabase config push` is a full-sync of
  `[auth]`; treat `config.toml` as source-of-truth for everything
  you want preserved on the remote, not just the bits you intend
  to change.

**CI/CD** (Phase 0.8)
- Three GitHub Actions workflows:
  - `engine-ci.yml` — `gradle :engine:test` on PRs + pushes
  - `fly-deploy.yml` — `flyctl deploy --remote-only` on push-to-main
  - `pages-deploy.yml` — Vite build (with prod `VITE_*` env vars)
    + `wrangler pages deploy` on push-to-main
- Path-filtered triggers keep doc-only commits from kicking deploys.
- Setup doc lists every required repo secret with exact commands
  to obtain each value locally.

### Documentation

- **Architecture**: `spec/web-app-vision.md` (set during pre-Phase-0
  planning), `spec/web-app-architecture-decision.md` (14 decisions
  including the supabase.com / Fly / Cloudflare / monorepo choices),
  `spec/web-app-phasing.md` (the 8-chunk plan).
- **Setup**: `docs/setup/supabase.md`, `docs/setup/fly.md`,
  `docs/setup/cloudflare-pages.md`, `docs/setup/github-actions.md`.
- **Wishlist**: `spec/surfaces-wishlist.md` + 11 GitHub issues
  (#5–#15) for the surfaces and post-v1 features deliberately out
  of scope.

### Known gaps

- JWT verification in the Ktor api is deferred to Phase 1 (the first
  authenticated route lands then). `/healthz` is public; signed-in
  identity is not yet enforced server-side.
- pgTAP tests aren't in CI yet (needs a non-prod test database
  story). Deferred.
- Frontend has no tests yet (Vitest setup is Phase 1).
- Branch protection on `main` is off; PRs aren't required. Optional
  polish — enable when the team grows or the surface stabilizes.
- The `web/package-lock.json` shuffles between host npm and the
  Compose container's Linux npm install. Cosmetic; ignored.

### Migrations / breaking changes

- The engine's source directory moved from `src/` to `engine/src/`.
  No git history was lost (all 49 files were detected as 100%
  renames).
- The CLI entrypoint moved with the engine; invoke via
  `gradle :engine:run` instead of `gradle run`.

[v0.0.0-poc]: https://github.com/dventimisupabase/pg-policy-engine/releases/tag/v0.0.0-poc
