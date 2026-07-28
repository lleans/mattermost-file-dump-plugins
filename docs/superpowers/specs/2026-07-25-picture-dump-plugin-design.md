# Mattermost File Dump Plugin — Design

Date: 2026-07-25
Status: Approved for planning

## Summary

A Mattermost (v11, self-hosted) plugin that adds a custom Right-Hand-Side (RHS)
sidebar panel where a user can drag-and-drop up to 10 files at once. Each file
uploads directly from the browser to a self-hosted MinIO bucket (which sits
behind an APISIX gateway) using a short-lived presigned PUT URL minted by the
plugin's Go backend. File bytes never pass through the plugin server. As soon
as an individual file finishes uploading, its permanent public link appears in
the panel — files do not wait on each other.

Deferred, explicitly out of scope for this spec: auto-filling the uploaded
link into Mattermost's message/post creation dialog. This spec covers only
the RHS drag-drop → direct upload → link display flow.

## Architecture & Data Flow

```
Browser (RHS plugin component)          Plugin Backend (Go)              MinIO (behind APISIX)
────────────────────────────           ──────────────────              ─────────────────────
1. User drags/drops up to
   10 files onto RHS panel
2. Client pre-checks each file
   (extension + size) — reject
   obviously-bad files instantly,
   no network call
3. POST /presign  ─────────────────►  Validate ext/mime/size per file
                                       (server-side is source of truth).
                                       Mint presigned PUT URL per valid
                                       file via minio-go client
                                       configured with the PUBLIC APISIX
                                       hostname (not MinIO's internal
                                       address).
   ◄───────────────────────────────  Return array of per-file results:
                                       {id, uploadUrl, objectKey,
                                        publicUrl} or {id, error}
4. For each accepted file,
   PUT directly to uploadUrl  ─────────────────────────────────────►  APISIX (pass_host: pass,
   (XHR with upload progress                                          no proxy-rewrite host/path
   events, tracked independently                                      override, raised
   per file — one file finishing                                      client_max_body_size)
   does not block another's                                             → MinIO validates SigV4
   progress or completion)                                               signature, stores object
                                  ◄─────────────────────────────────────  under bucket (public-read
5. On PUT success, POST                                                  GET-only policy set once
   /complete ──────────────────►     Record metadata in plugin           at plugin activation)
                                      KV store (uploader id, filename,
                                      object key, size, timestamp)
6. Show publicUrl + copy button
   for that file immediately
   (independent per file)
```

### Why direct-to-MinIO presigned upload (not a proxy)

Confirmed via research before this design was finalized:

- Mattermost's plugin webapp API (`registerRightHandSidebarComponent`) is a
  stable, current API for adding a custom RHS panel — no version-specific
  issues found for v11.
- Mattermost's CSP only constrains `script-src` (which JS can execute); it
  sets no `connect-src`/`default-src`, so a plugin's frontend `fetch`/XHR to
  an external MinIO origin is not blocked by Mattermost itself — only normal
  browser CORS rules on MinIO's side apply.
- `minio-go`'s `PresignedPutObject` mints time-limited direct-upload URLs;
  this is a standard, well-documented pattern outside Mattermost.

### APISIX-specific requirement (critical, verified)

AWS SigV4 presigned URLs sign the exact `Host` header, path, and query
string. Because MinIO sits behind APISIX rather than being directly
internet-facing:

- The plugin's minio-go client used for presigning **must** be configured
  with APISIX's **public** hostname/scheme/port — not MinIO's internal
  address — since MinIO verifies the signature against whatever `Host`
  header the request actually arrives with (confirmed from MinIO's
  `signature-v4-utils.go`), not any configured server URL.
- The APISIX route for this traffic must leave `pass_host` at its default
  value `"pass"` (APISIX already forwards the client's original Host header
  unchanged by default — unlike plain Nginx) and must **not** attach a
  `proxy-rewrite` plugin that overrides `host` or rewrites the path/query on
  this route.
- APISIX's default body size limit (inherited from Nginx, 1MB) must be
  raised via `nginx_config.http.client_max_body_size` in APISIX's
  `config.yaml` to accommodate the 10MB per-file limit.
- Before wiring up the frontend, sanity-check with a raw `curl -X PUT`
  through the public APISIX hostname (not directly at MinIO) to confirm the
  signature validates end-to-end.

## Components

### Backend Plugin (Go)

- `plugin.go` — `OnActivate` reads config (MinIO public endpoint,
  access/secret key, bucket name, allowed extension/mime allowlist, max file
  size, max batch size) and builds one `minio-go` client pointed at the
  public APISIX hostname. Ensures the bucket has a public-read (GET-only)
  anonymous access policy set, idempotently, on activation.
- `http.go` — `ServeHTTP` router exposing two endpoints. Both require the
  `Mattermost-User-Id` header (Mattermost injects this for any authenticated
  session; missing header → 401). No further RBAC — any logged-in user may
  upload.
  - `POST /api/v1/uploads/presign` — body: array of
    `{filename, size, contentType}`, max 10 entries (else 400 for the whole
    request). Validates each file independently against the extension
    allowlist, declared MIME type, and 10MB size cap. Returns one array,
    positionally matching the request, where each entry is either
    `{id, uploadUrl, objectKey, publicUrl}` or `{id, error}` — one invalid
    file does not block the others in the same batch.
  - `POST /api/v1/uploads/complete` — body: `{objectKey, filename, size}`.
    Called by the browser after each individual PUT succeeds. Writes
    metadata to the plugin KV store under key `upload:<objectKey>`
    (uploader user id, filename, size, upload timestamp). This is how the
    backend learns an upload actually completed, since file bytes never
    pass through it.
- `minio.go` — thin wrapper around `minio-go`:
  `PresignedPutObject(bucket, objectKey, 5*time.Minute)`. 5-minute expiry
  since the browser uploads immediately after the URL is minted.
- Object keys: a random ID plus the original file extension (e.g.
  `a1b2c3d4e5f6.png`). The original filename is kept only in KV metadata,
  never exposed in the object key or public URL.

### Frontend RHS Component (webapp, React)

- Registered via `registerRightHandSidebarComponent`. Receives Mattermost's
  active theme as a prop; styling reuses Mattermost's existing CSS
  variables/utility classes rather than introducing a separate design
  system, so the panel reads as native rather than bolted-on, and adapts to
  light/dark themes automatically. No heavy UI dependency (e.g. no
  drag-drop library) — a small hand-rolled `onDragOver`/`onDrop` handler
  keeps the bundle light.
- On drop, each file is checked client-side first (extension, 10MB size,
  10-file batch cap). Files failing this check are rejected instantly with
  an inline message and never reach the network. This is a UX convenience
  only — the server re-validates everything.
- Files that pass the client check are sent in one batch to `/presign`.
  Each returned file then gets its own row with independent state:
  `pending → uploading (XHR with upload-progress-driven progress bar) → done
  (public link + copy-to-clipboard button + thumbnail for images) → error
  (message + retry button)`.
- Retry re-requests a fresh presigned URL rather than reusing a
  potentially-expired one.
- Files are entirely independent: one file's failure, slowness, or success
  never blocks or waits on another's.

## Security & Validation

- File-type allowlist: images (jpg, jpeg, png, gif, webp, svg) plus common
  documents (pdf, docx, xlsx, pptx, txt, zip). Checked server-side against
  both the file extension and the browser-declared `Content-Type` — this
  server-side check is the source of truth; the client-side check exists
  only to give immediate feedback.
- Max file size: 10MB per file, enforced server-side before a presigned URL
  is minted.
- Max batch size: 10 files per drop/request, enforced server-side.
- Access control: any authenticated Mattermost user (identified via the
  `Mattermost-User-Id` header) may use the panel and request presigned
  URLs. No additional role/permission gating.
- Bucket policy: public-read GET only (no public list, no public write) —
  this is what makes the returned `publicUrl` usable as a stable,
  permanent, unauthenticated link with no expiry logic needed on the read
  side.
- Presigned PUT URLs themselves expire after 5 minutes (upload-only,
  separate from the permanent public read link).
- Known, accepted limitation: a presigned PUT URL (unlike a presigned POST
  policy) does not cryptographically enforce the declared file size at the
  storage layer — a user could in principle PUT more bytes than declared
  against a validly-minted URL. Given the "any logged-in user, effectively
  trusted internal tool" access model chosen for this spec, this residual
  risk is accepted rather than engineered around (e.g. via a post-upload
  HEAD-and-delete sweep). This can be revisited later if it becomes a real
  problem; it is out of scope now.

## Error Handling

- Client-side rejections (disallowed extension, oversized file, more than
  10 files in one drop) are shown instantly with no network call.
- `/presign` returns per-file success/error entries, so one invalid file in
  a batch never blocks the valid ones.
- PUT failures (network error, CORS misconfiguration, signature mismatch)
  surface as a per-file error state with a retry button; retry mints a
  fresh presigned URL.
- If `/presign` or `/complete` is unreachable (MinIO/APISIX down), the
  panel shows a simple "try again" error — no automatic retry loop.

## Testing

- Backend: Go unit tests for the validation logic (extension/MIME/size/
  batch-count checks) and for presigned URL generation against a local
  MinIO test container.
- Frontend: component tests for the per-file state machine
  (pending/uploading/done/error) with mocked XHR.
- End-to-end / manual QA: a local docker-compose stack (Mattermost server +
  Postgres + MinIO + APISIX, with the APISIX route configured exactly as
  described above) will be stood up for manual, human-driven QA — this
  spec does not include automated browser E2E tests or automated visual/
  theme regression testing. Theme correctness (light/dark) is verified
  visually during manual QA.

## Explicitly Out of Scope

- Auto-filling the uploaded file's link into Mattermost's post/message
  compose dialog (deferred to a future spec).
- Persistent upload history in the RHS panel across page reloads (panel
  only shows the current session's drop results; metadata is still
  recorded server-side for tracking, just not surfaced as a history UI).
- Any role/permission restriction beyond "is a logged-in Mattermost user."
- Presigned multipart upload for files larger than a single PUT can handle
  (not needed at the current 10MB cap).
