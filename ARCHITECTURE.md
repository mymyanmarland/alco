# ALCO — Architecture (Phase 1)

## Request flows

### AI chat
```
Browser ──POST /api/chat (SSE)──▶ requireUserId (401)
        ──▶ rate limit (429 + Retry-After)
        ──▶ AI daily token quota (429 quota_exceeded)
        ──▶ load/create conversation (ownership-checked)
        ──▶ persist user message
        ──▶ getProvider().streamChat() ──▶ RelayModels /v1 (server-side key)
        ──▶ stream chunks ──▶ persist assistant message
                           ──▶ usage_events(kind=ai_tokens, model)
```

### App builder
```
POST /api/builder/plan     prompt ──▶ strict-JSON plan {features, files[], tasks}
POST /api/builder/generate plan  ──▶ per-file generation (sequential, markers
                                     <<<FILE path>>>…<<<END>>>)
                                  ──▶ validateFilePath (traversal/ext checks)
                                  ──▶ write to storage/projects/<id>/
                                  ──▶ git add + commit  (= version snapshot)
POST /api/builder/edit     instruction ──▶ rewrite ONLY returned files
                                          ──▶ new commit (others byte-identical)
GET  /api/builder/[id]/versions           git log
POST /api/builder/[id]/rollback {sha} ──▶ NEW commit restoring old tree
                                          (history is never rewritten)
```
All builder routes: auth → `requireOwnedProject` → rate limit → AI quota.

### Sandbox preview
```
POST /api/sandbox/run ──▶ auth/ownership ──▶ rate limit
  ──▶ tryAcquireSlot (2 concurrent/user, atomic)
  ──▶ daily budget (10 min)
  ──▶ git archive <sha> → ephemeral workdir
  ──▶ driver.run() ── docker:  --network none, --cpus 0.5, --memory 512m,
  │                               --pids-limit 64, --read-only, --user 65532,
  │                               --cap-drop ALL, no-new-privileges, env allowlist
  │                  └─ local:    DEV ONLY — cwd jail, scrubbed env, watchdog kill
  ──▶ stream logs (SSE) ──▶ sandbox_runs row
  ──▶ static success → preview URL: /api/sandbox/preview/<runId>?token=<64-hex>
                            (timing-safe compare, 15-min TTL, CSP: sandbox)
```

## Data model (Prisma, PostgreSQL)

Core: `User` (better-auth) → `Profile`, `Project[]`, `Conversation[]`,
`AgentRun[]`, `SandboxRun[]`, `UsageEvent[]`, `Deployment[]`, `Subscription?`,
`AuditLog[]`.

- `Project` 1—N `ProjectFile` (metadata mirror of the git worktree),
  1—N `ProjectVersion` (`snapshotRef` = git sha).
- `Conversation` 1—N `Message`; optional FK to `Project` (builder sessions).
- `UsageEvent { kind, quantity, model? }` — `ai_tokens` rows feed the daily
  quota; `model` attributes spend per model.
- `SandboxRun { status, exitCode, durationMs, driver, snapshotRef }`.
- better-auth tables: `user`, `session`, `account`, `verification`.

Authorization is **app-level**: every query is scoped `where: { userId }`
(or via `requireOwnedProject`). No Postgres RLS. The admin surface checks
`ADMIN_EMAILS` and returns 404 for everyone else.

## Sandbox design summary

- Untrusted code (generated apps, build steps) executes ONLY inside the
  sandbox driver — never on the app host, never in the web process.
- Production driver: Docker, `node:22-slim`, fully restricted flags
  (see flow above). Fails closed when Docker is unavailable.
- Dev driver: local subprocess, loudly marked DEV ONLY, refuses
  `NODE_ENV=production` unless `SANDBOX_ALLOW_LOCAL=1` (never in prod).
- Previews are capability URLs: unguessable 64-hex token, 15-min TTL,
  timing-safe comparison, `Content-Security-Policy: sandbox` on serve.
- Quotas: 2 concurrent runs/user (atomic in-memory semaphore), 10 min/day
  execution budget, 180 s per-run hard cap, 1 MB output cap.

## Trust boundaries

1. **Browser ↔ App**: session cookies (better-auth); AI keys never leave
   the server; preview tokens are bearer capabilities with TTL.
2. **App ↔ AI provider**: server-side HTTPS with secret key; honest error
   mapping (auth/rate_limit/provider/timeout/config) — no fake replies.
3. **App ↔ Sandbox**: one-way — worktree materialized in, logs out.
   No host env, no host FS, no Docker socket inside run containers.
4. **App ↔ Database**: single Prisma client; migrations are forward-only.

## Known single-instance limits (fix before scaling out)

Rate limiter, quota semaphores, and the preview registry are in-memory.
A second instance (or PM2 cluster) requires Redis for all three.
