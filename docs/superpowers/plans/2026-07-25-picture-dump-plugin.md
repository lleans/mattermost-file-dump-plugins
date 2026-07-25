# Picture Dump Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Mattermost v11 plugin with an RHS drag-drop panel that uploads files directly from the browser to a self-hosted MinIO bucket (behind APISIX) via presigned PUT URLs, showing each file's permanent public link as soon as that file finishes.

**Architecture:** Go plugin backend (gorilla/mux HTTP handlers + minio-go client configured with the public APISIX endpoint) mints short-lived presigned PUT URLs and records completed-upload metadata in the plugin KV store. A React RHS component (registered via `registerRightHandSidebarComponent`) handles drag-drop, client-side pre-validation, per-file XHR uploads with progress, and displays each file's public link independently.

**Tech Stack:** Go 1.25, gorilla/mux, minio-go/v7, google/uuid, Mattermost plugin SDK (`mattermost/server/public`); React 18 + TypeScript (Mattermost webapp plugin conventions), Jest + @testing-library/react; Docker Compose (Mattermost, Postgres, MinIO, APISIX standalone mode) for manual QA.

Spec: `docs/superpowers/specs/2026-07-25-picture-dump-plugin-design.md`

## Global Constraints

- Plugin ID: `com.acumenstrategy.picture-dump`. Go module: `github.com/acumenstrategy/picture-dump-plugin`.
- Allowed file extensions (enforced identically on client and server): `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.svg`, `.pdf`, `.docx`, `.xlsx`, `.pptx`, `.txt`, `.zip`.
- Max file size: 10MB (`10 * 1024 * 1024` bytes) per file, server-side is the source of truth.
- Max batch size: 10 files per drop/request, server-side is the source of truth.
- Presigned PUT URL expiry: 5 minutes.
- Object key format: random UUID + original file extension only — never the original filename or a user/date path.
- Bucket policy: public-read `GetObject` only — no public list, no public write.
- Auth: any request to the plugin's HTTP API must carry a non-empty `Mattermost-User-ID` header (Mattermost injects this automatically for authenticated sessions); no further role/permission gating.
- The minio-go client used for presigning MUST be configured with the public, APISIX-fronted endpoint — never MinIO's internal address — because MinIO verifies a presigned URL's signature against whatever `Host` header the request actually arrives with.
- The APISIX route for uploads must leave `pass_host` at its default (`pass`), must not attach a `proxy-rewrite` plugin that overrides `host` or rewrites path/query on this route, and must raise `client_max_body_size` to fit the 10MB cap.
- Out of scope — do not build: auto-filling links into the post/message compose dialog, a persistent upload-history UI, any role/permission restriction beyond "logged in," presigned multipart upload.

---

## File Structure

```
go.mod, go.sum, plugin.json, Makefile, build/            (from official starter template, Task 1)
server/
  main.go                                                 (unchanged from template)
  plugin.go                                               (Plugin struct, OnActivate)
  configuration.go                                        (MinIO settings)
  api.go                                                   (HTTP routes: /uploads/presign, /uploads/complete)
  api_test.go
  upload/
    validate.go / validate_test.go                        (extension/size/batch validation)
    minio.go / minio_test.go                               (presigned PUT client, bucket policy)
    store.go / store_test.go                                (KV metadata recording)
webapp/
  src/
    index.tsx                                             (RHS + channel header button registration)
    components/
      upload_icon.tsx
      upload_panel/
        index.tsx
        index.test.tsx
        file_dropzone.tsx
        file_dropzone.test.tsx
        file_row.tsx
        validate.ts / validate.test.ts
        upload_client.ts
        use_uploads.ts / use_uploads.test.ts
        types.ts
        upload_panel.scss
docker/
  docker-compose.yml
  apisix_conf/
    config-standalone.yaml
    apisix-standalone.yaml
  README.md
```

---

### Task 1: Scaffold plugin from the official starter template

**Files:**
- Create: entire repo skeleton via clone (`go.mod`, `go.sum`, `plugin.json`, `Makefile`, `build/`, `server/main.go`, `server/plugin.go`, `server/api.go`, `server/configuration.go`, `webapp/*`, `assets/`, `public/`)
- Modify: none (fresh clone)
- Test: none (this task's acceptance is "it builds")

**Interfaces:**
- Consumes: nothing (first task)
- Produces: a buildable, minimal plugin skeleton with `Plugin` struct (`server/plugin.go`), an authenticated-but-empty router (`server/api.go`), and `configuration` struct (`server/configuration.go`) that Tasks 2-5 build on.

- [ ] **Step 1: Clone the official starter template into the repo**

The official `mattermost-plugin-starter-template` is designed to be forked/cloned as a base, not hand-written — this avoids reproducing ~15 boilerplate files (Makefile, build tooling, webpack/babel/jest config) from scratch.

```bash
TEMPLATE_DIR=$(mktemp -d)
git clone --depth 1 https://github.com/mattermost/mattermost-plugin-starter-template.git "$TEMPLATE_DIR"
rsync -a --exclude='.git' "$TEMPLATE_DIR"/ ./
rm -rf "$TEMPLATE_DIR"
```

Expected: repo root now contains `go.mod`, `plugin.json`, `Makefile`, `build/`, `server/`, `webapp/`, `assets/`, `public/` alongside the existing `docs/`, `.claude/`, `.gitignore`.

- [ ] **Step 2: Rename plugin id, name, and Go module path**

Replace `plugin.json` with:

```json
{
    "id": "com.acumenstrategy.picture-dump",
    "name": "Picture Dump",
    "description": "Drag-and-drop file uploads with direct-to-MinIO presigned links.",
    "homepage_url": "",
    "support_url": "",
    "icon_path": "assets/starter-template-icon.svg",
    "min_server_version": "9.0.0",
    "server": {
        "executables": {
            "linux-amd64": "server/dist/plugin-linux-amd64",
            "linux-arm64": "server/dist/plugin-linux-arm64",
            "darwin-amd64": "server/dist/plugin-darwin-amd64",
            "darwin-arm64": "server/dist/plugin-darwin-arm64",
            "windows-amd64": "server/dist/plugin-windows-amd64.exe"
        }
    },
    "webapp": {
        "bundle_path": "webapp/dist/main.js"
    },
    "settings_schema": {
        "header": "",
        "footer": "",
        "settings": []
    }
}
```

Then rename the Go module (macOS `sed -i` requires the empty `''` backup-suffix argument):

```bash
sed -i '' 's|module github.com/mattermost/mattermost-plugin-starter-template|module github.com/acumenstrategy/picture-dump-plugin|' go.mod
sed -i '' 's|github.com/mattermost/mattermost-plugin-starter-template|github.com/acumenstrategy/picture-dump-plugin|g' server/*.go
```

- [ ] **Step 3: Strip demo-only functionality not needed by this plugin**

The template ships a slash-command demo, a background cluster job demo, and a KV-store demo — none of which this plugin uses.

```bash
rm -rf server/command server/job.go server/store server/plugin_test.go public/hello.html
```

- [ ] **Step 4: Replace `server/plugin.go` with a minimal Plugin struct**

```go
package main

import (
	"sync"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/plugin"
)

// Plugin implements the interface expected by the Mattermost server to
// communicate between the server and plugin processes.
type Plugin struct {
	plugin.MattermostPlugin

	configurationLock sync.RWMutex
	configuration     *configuration

	router *mux.Router
}

func (p *Plugin) OnActivate() error {
	p.router = p.initRouter()
	return nil
}
```

- [ ] **Step 5: Replace `server/api.go` with a minimal authenticated router**

```go
package main

import (
	"net/http"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/plugin"
)

func (p *Plugin) initRouter() *mux.Router {
	router := mux.NewRouter()
	router.Use(p.mattermostAuthorizationRequired)
	router.PathPrefix("/api/v1").Subrouter()
	return router
}

func (p *Plugin) ServeHTTP(c *plugin.Context, w http.ResponseWriter, r *http.Request) {
	p.router.ServeHTTP(w, r)
}

func (p *Plugin) mattermostAuthorizationRequired(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Mattermost-User-ID") == "" {
			http.Error(w, "Not authorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}
```

- [ ] **Step 6: Replace `server/configuration.go` with an empty configuration (fields added in Task 3)**

```go
package main

import (
	"github.com/pkg/errors"
)

type configuration struct {
}

func (c *configuration) Clone() *configuration {
	clone := *c
	return &clone
}

func (p *Plugin) getConfiguration() *configuration {
	p.configurationLock.RLock()
	defer p.configurationLock.RUnlock()

	if p.configuration == nil {
		return &configuration{}
	}
	return p.configuration
}

func (p *Plugin) setConfiguration(configuration *configuration) {
	p.configurationLock.Lock()
	defer p.configurationLock.Unlock()

	if configuration != nil && p.configuration == configuration {
		panic("setConfiguration called with the existing configuration")
	}
	p.configuration = configuration
}

func (p *Plugin) OnConfigurationChange() error {
	var configuration = new(configuration)

	if err := p.API.LoadPluginConfiguration(configuration); err != nil {
		return errors.Wrap(err, "failed to load plugin configuration")
	}

	p.setConfiguration(configuration)
	return nil
}
```

- [ ] **Step 7: Verify the scaffold builds**

```bash
go build ./server/...
cd webapp && npm install && npm run build && cd ..
```

Expected: both succeed with no errors. (The webapp's default `index.tsx` has no RHS registration yet — that's added in Task 6.)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Scaffold plugin from mattermost-plugin-starter-template, strip demo code"
```

---

### Task 2: File validation package

**Files:**
- Create: `server/upload/validate.go`
- Test: `server/upload/validate_test.go`

**Interfaces:**
- Consumes: nothing (pure logic package, no Mattermost/MinIO dependency)
- Produces: `upload.FileRequest{Filename, Size, ContentType}`, `upload.ValidateFile(FileRequest) error`, `upload.ValidateBatch([]FileRequest) error`, `upload.MaxFileSize`, `upload.MaxBatchSize` — consumed by Task 5's HTTP handlers.

- [ ] **Step 1: Write the failing tests**

```go
package upload

import "testing"

func TestValidateFileAcceptsAllowedImage(t *testing.T) {
	err := ValidateFile(FileRequest{Filename: "photo.png", Size: 1024, ContentType: "image/png"})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func TestValidateFileRejectsDisallowedExtension(t *testing.T) {
	err := ValidateFile(FileRequest{Filename: "script.exe", Size: 1024, ContentType: "application/octet-stream"})
	if err == nil {
		t.Fatal("expected an error for a disallowed extension")
	}
}

func TestValidateFileRejectsOversizedFile(t *testing.T) {
	err := ValidateFile(FileRequest{Filename: "big.png", Size: MaxFileSize + 1, ContentType: "image/png"})
	if err == nil {
		t.Fatal("expected an error for a file over the size limit")
	}
}

func TestValidateFileRejectsMismatchedContentType(t *testing.T) {
	err := ValidateFile(FileRequest{Filename: "photo.png", Size: 1024, ContentType: "application/pdf"})
	if err == nil {
		t.Fatal("expected an error when content type does not match extension")
	}
}

func TestValidateBatchAcceptsTenFiles(t *testing.T) {
	files := make([]FileRequest, 10)
	for i := range files {
		files[i] = FileRequest{Filename: "a.png", Size: 1, ContentType: "image/png"}
	}
	if err := ValidateBatch(files); err != nil {
		t.Fatalf("expected no error for 10 files, got %v", err)
	}
}

func TestValidateBatchRejectsElevenFiles(t *testing.T) {
	files := make([]FileRequest, 11)
	for i := range files {
		files[i] = FileRequest{Filename: "a.png", Size: 1, ContentType: "image/png"}
	}
	if err := ValidateBatch(files); err == nil {
		t.Fatal("expected an error for 11 files")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./server/upload/... -run TestValidate -v`
Expected: FAIL — `undefined: FileRequest` / `undefined: ValidateFile` (package doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```go
package upload

import (
	"fmt"
	"path/filepath"
	"strings"
)

const (
	MaxFileSize  = 10 * 1024 * 1024 // 10MB
	MaxBatchSize = 10
)

// allowedExtensions maps a lowercase file extension (including the dot) to
// the set of Content-Type values accepted for it.
var allowedExtensions = map[string][]string{
	".jpg":  {"image/jpeg"},
	".jpeg": {"image/jpeg"},
	".png":  {"image/png"},
	".gif":  {"image/gif"},
	".webp": {"image/webp"},
	".svg":  {"image/svg+xml"},
	".pdf":  {"application/pdf"},
	".docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
	".xlsx": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
	".pptx": {"application/vnd.openxmlformats-officedocument.presentationml.presentation"},
	".txt":  {"text/plain"},
	".zip":  {"application/zip", "application/x-zip-compressed"},
}

// FileRequest describes one file the client wants to upload, as declared
// by the browser before any bytes are sent.
type FileRequest struct {
	Filename    string `json:"filename"`
	Size        int64  `json:"size"`
	ContentType string `json:"contentType"`
}

// ValidateFile checks a single file's extension, declared content type, and
// size against the plugin's fixed allowlist and limits. It returns the
// first violation found, or nil if the file is acceptable.
func ValidateFile(f FileRequest) error {
	if f.Filename == "" {
		return fmt.Errorf("filename is required")
	}
	if f.Size <= 0 {
		return fmt.Errorf("file is empty")
	}
	if f.Size > MaxFileSize {
		return fmt.Errorf("file exceeds the %dMB size limit", MaxFileSize/(1024*1024))
	}

	ext := strings.ToLower(filepath.Ext(f.Filename))
	allowedTypes, ok := allowedExtensions[ext]
	if !ok {
		return fmt.Errorf("file type %q is not allowed", ext)
	}

	contentType := strings.ToLower(strings.TrimSpace(f.ContentType))
	for _, allowed := range allowedTypes {
		if contentType == allowed {
			return nil
		}
	}
	return fmt.Errorf("declared content type %q does not match extension %q", f.ContentType, ext)
}

// ValidateBatch checks the batch size cap. Individual file validation is
// the caller's responsibility via ValidateFile, since a batch can be
// partially valid (some files accepted, some rejected).
func ValidateBatch(files []FileRequest) error {
	if len(files) == 0 {
		return fmt.Errorf("no files provided")
	}
	if len(files) > MaxBatchSize {
		return fmt.Errorf("a maximum of %d files can be uploaded at once", MaxBatchSize)
	}
	return nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./server/upload/... -run TestValidate -v`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/upload/validate.go server/upload/validate_test.go
git commit -m "Add server-side file validation (extension, content type, size, batch cap)"
```

---

### Task 3: MinIO presigned upload client

**Files:**
- Create: `server/upload/minio.go`
- Test: `server/upload/minio_test.go`
- Modify: `plugin.json` (add MinIO settings), `server/configuration.go` (add MinIO fields)

**Interfaces:**
- Consumes: `github.com/minio/minio-go/v7`, `github.com/google/uuid` (new dependencies added this task)
- Produces: `upload.NewClient(endpoint, accessKey, secretKey, bucket string, useSSL bool, publicBase string) (*upload.Client, error)`, `upload.PresignResult{ObjectKey, UploadURL, PublicURL}`, `(*upload.Client).PresignPut(ctx, filename string) (*upload.PresignResult, error)`, `(*upload.Client).EnsurePublicReadBucket(ctx) error` — consumed by Task 5.

- [ ] **Step 1: Add new dependencies**

```bash
go get github.com/minio/minio-go/v7
go get github.com/google/uuid
```

- [ ] **Step 2: Write the failing tests**

Presigning is a local cryptographic operation — it needs no live network connection to MinIO, so this can be a fast, real unit test rather than an integration test.

```go
package upload

import (
	"context"
	"strings"
	"testing"
)

func TestPresignPutPreservesExtensionAndHidesFilename(t *testing.T) {
	c, err := NewClient("storage.example.com", "test-access-key", "test-secret-key", "uploads", true, "https://storage.example.com")
	if err != nil {
		t.Fatalf("NewClient failed: %v", err)
	}

	result, err := c.PresignPut(context.Background(), "vacation photo.PNG")
	if err != nil {
		t.Fatalf("PresignPut failed: %v", err)
	}

	if !strings.HasSuffix(result.ObjectKey, ".PNG") {
		t.Errorf("expected object key to preserve extension, got %q", result.ObjectKey)
	}
	if strings.Contains(result.ObjectKey, "vacation photo") {
		t.Errorf("object key must not leak the original filename, got %q", result.ObjectKey)
	}
}

func TestPresignPutSignsForThePublicEndpoint(t *testing.T) {
	c, err := NewClient("storage.example.com", "test-access-key", "test-secret-key", "uploads", true, "https://storage.example.com")
	if err != nil {
		t.Fatalf("NewClient failed: %v", err)
	}

	result, err := c.PresignPut(context.Background(), "a.png")
	if err != nil {
		t.Fatalf("PresignPut failed: %v", err)
	}

	if !strings.Contains(result.UploadURL, "storage.example.com") {
		t.Errorf("expected presigned URL to be signed for the public endpoint, got %q", result.UploadURL)
	}
	if !strings.Contains(result.UploadURL, "X-Amz-Signature") {
		t.Errorf("expected a SigV4 signature in the presigned URL, got %q", result.UploadURL)
	}

	wantPublicURL := "https://storage.example.com/uploads/" + result.ObjectKey
	if result.PublicURL != wantPublicURL {
		t.Errorf("PublicURL = %q, want %q", result.PublicURL, wantPublicURL)
	}
}

func TestPresignPutGeneratesUniqueObjectKeys(t *testing.T) {
	c, err := NewClient("storage.example.com", "test-access-key", "test-secret-key", "uploads", true, "https://storage.example.com")
	if err != nil {
		t.Fatalf("NewClient failed: %v", err)
	}

	first, _ := c.PresignPut(context.Background(), "a.png")
	second, _ := c.PresignPut(context.Background(), "a.png")

	if first.ObjectKey == second.ObjectKey {
		t.Error("expected each call to mint a distinct object key")
	}
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `go test ./server/upload/... -run TestPresignPut -v`
Expected: FAIL — `undefined: NewClient` (file doesn't exist yet).

- [ ] **Step 4: Write the implementation**

```go
package upload

import (
	"context"
	"fmt"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

const presignExpiry = 5 * time.Minute

// Client wraps a minio-go client configured against the PUBLIC, APISIX-fronted
// endpoint. It must never be configured with MinIO's internal address: the
// presigned URL's signature is bound to whatever Host header the browser
// actually sends, which is the public endpoint, not any internal one.
type Client struct {
	mc         *minio.Client
	bucket     string
	publicBase string
}

// NewClient builds a Client for presigning uploads against the given public
// endpoint (host[:port], no scheme) and bucket.
func NewClient(endpoint, accessKey, secretKey, bucket string, useSSL bool, publicBase string) (*Client, error) {
	mc, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create minio client: %w", err)
	}
	return &Client{mc: mc, bucket: bucket, publicBase: publicBase}, nil
}

// PresignResult is what the plugin backend returns to the browser for one
// accepted file.
type PresignResult struct {
	ObjectKey string `json:"objectKey"`
	UploadURL string `json:"uploadUrl"`
	PublicURL string `json:"publicUrl"`
}

// PresignPut mints a random object key (preserving the original extension)
// and a short-lived presigned PUT URL for it.
func (c *Client) PresignPut(ctx context.Context, originalFilename string) (*PresignResult, error) {
	ext := filepath.Ext(originalFilename)
	objectKey := uuid.NewString() + ext

	u, err := c.mc.PresignedPutObject(ctx, c.bucket, objectKey, presignExpiry)
	if err != nil {
		return nil, fmt.Errorf("failed to presign upload for %q: %w", originalFilename, err)
	}

	return &PresignResult{
		ObjectKey: objectKey,
		UploadURL: u.String(),
		PublicURL: fmt.Sprintf("%s/%s/%s", c.publicBase, c.bucket, objectKey),
	}, nil
}

// EnsurePublicReadBucket sets a bucket policy allowing anonymous GET (read)
// access only - no public list, no public write. Safe to call repeatedly.
func (c *Client) EnsurePublicReadBucket(ctx context.Context) error {
	policy := fmt.Sprintf(`{
		"Version": "2012-10-17",
		"Statement": [
			{
				"Effect": "Allow",
				"Principal": {"AWS": ["*"]},
				"Action": ["s3:GetObject"],
				"Resource": ["arn:aws:s3:::%s/*"]
			}
		]
	}`, c.bucket)

	return c.mc.SetBucketPolicy(ctx, c.bucket, policy)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `go test ./server/upload/... -run TestPresignPut -v`
Expected: PASS (all 3 tests)

- [ ] **Step 6: Add MinIO settings to `plugin.json`**

Replace the `settings_schema.settings` array with:

```json
"settings_schema": {
    "header": "",
    "footer": "",
    "settings": [
        {
            "key": "MinIOEndpoint",
            "display_name": "MinIO Endpoint",
            "type": "text",
            "help_text": "The public, browser-reachable host:port for MinIO through APISIX, e.g. localhost:9080. Do not use MinIO's internal address.",
            "default": ""
        },
        {
            "key": "MinIOUseSSL",
            "display_name": "Use HTTPS",
            "type": "bool",
            "help_text": "Whether the public MinIO endpoint is served over HTTPS.",
            "default": false
        },
        {
            "key": "MinIOAccessKey",
            "display_name": "MinIO Access Key",
            "type": "text",
            "help_text": "Access key used to sign presigned upload URLs.",
            "default": ""
        },
        {
            "key": "MinIOSecretKey",
            "display_name": "MinIO Secret Key",
            "type": "text",
            "help_text": "Secret key used to sign presigned upload URLs.",
            "default": "",
            "secret": true
        },
        {
            "key": "MinIOBucket",
            "display_name": "MinIO Bucket",
            "type": "text",
            "help_text": "Bucket that receives uploaded files. Must already exist with public-read access (the plugin sets the read policy on activation but does not create the bucket).",
            "default": "uploads"
        }
    ]
}
```

- [ ] **Step 7: Add matching fields to `server/configuration.go`**

Change the `configuration` struct (leave `Clone`/`getConfiguration`/`setConfiguration`/`OnConfigurationChange` untouched):

```go
type configuration struct {
	MinIOEndpoint  string
	MinIOAccessKey string
	MinIOSecretKey string
	MinIOBucket    string
	MinIOUseSSL    bool
}
```

- [ ] **Step 8: Commit**

```bash
go mod tidy
git add server/upload/minio.go server/upload/minio_test.go plugin.json server/configuration.go go.mod go.sum
git commit -m "Add MinIO presigned-PUT client and configuration settings"
```

---

### Task 4: Upload metadata store (KV)

**Files:**
- Create: `server/upload/store.go`
- Test: `server/upload/store_test.go`

**Interfaces:**
- Consumes: `github.com/mattermost/mattermost/server/public/plugin` (the `plugin.API` interface, already a template dependency), `github.com/mattermost/mattermost/server/public/plugin/plugintest` (mock, already a template dependency used by the removed `command_test.go` — confirm it's still in `go.sum` after Task 1's `go mod tidy`, otherwise `go get github.com/mattermost/mattermost/server/public/plugin/plugintest`)
- Produces: `upload.Metadata{ObjectKey, Filename, Size, UploaderID, UploadedAt}`, `upload.NewStore(api plugin.API) *upload.Store`, `(*upload.Store).Record(m Metadata) error` — consumed by Task 5.

- [ ] **Step 1: Write the failing test**

```go
package upload

import (
	"testing"
	"time"

	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestStoreRecordSavesMetadataUnderObjectKey(t *testing.T) {
	api := &plugintest.API{}
	api.On("KVSet", "upload:abc123.png", mock.AnythingOfType("[]uint8")).Return(nil)

	store := NewStore(api)
	err := store.Record(Metadata{
		ObjectKey:  "abc123.png",
		Filename:   "vacation.png",
		Size:       1024,
		UploaderID: "user1",
		UploadedAt: time.Now(),
	})

	require.NoError(t, err)
	api.AssertExpectations(t)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./server/upload/... -run TestStoreRecord -v`
Expected: FAIL — `undefined: NewStore` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```go
package upload

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/mattermost/mattermost/server/public/plugin"
)

// Metadata is what gets recorded once the browser confirms a direct PUT to
// MinIO succeeded. The plugin backend never sees the file bytes, so this is
// the only record it has of the upload.
type Metadata struct {
	ObjectKey  string    `json:"objectKey"`
	Filename   string    `json:"filename"`
	Size       int64     `json:"size"`
	UploaderID string    `json:"uploaderId"`
	UploadedAt time.Time `json:"uploadedAt"`
}

// Store persists upload metadata via the plugin's KV store.
type Store struct {
	api plugin.API
}

func NewStore(api plugin.API) *Store {
	return &Store{api: api}
}

func kvKey(objectKey string) string {
	return "upload:" + objectKey
}

// Record saves metadata for a completed upload, overwriting any existing
// entry for the same object key.
func (s *Store) Record(m Metadata) error {
	data, err := json.Marshal(m)
	if err != nil {
		return fmt.Errorf("failed to marshal upload metadata: %w", err)
	}
	if appErr := s.api.KVSet(kvKey(m.ObjectKey), data); appErr != nil {
		return fmt.Errorf("failed to store upload metadata: %w", appErr)
	}
	return nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./server/upload/... -run TestStoreRecord -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/upload/store.go server/upload/store_test.go
git commit -m "Add KV-store-backed upload metadata recording"
```

---

### Task 5: Wire the HTTP API and plugin activation

**Files:**
- Modify: `server/plugin.go`, `server/api.go`
- Test: `server/api_test.go`

**Interfaces:**
- Consumes: `upload.FileRequest`, `upload.ValidateFile`, `upload.ValidateBatch` (Task 2); `upload.Client.PresignPut`, `upload.PresignResult` (Task 3); `upload.Store.Record`, `upload.Metadata` (Task 4)
- Produces: `POST /plugins/com.acumenstrategy.picture-dump/api/v1/uploads/presign` and `POST /plugins/com.acumenstrategy.picture-dump/api/v1/uploads/complete` — consumed by Task 8's `upload_client.ts`.

- [ ] **Step 1: Replace `server/plugin.go`**

```go
package main

import (
	"context"
	"sync"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/plugin"

	"github.com/acumenstrategy/picture-dump-plugin/server/upload"
)

// presigner and recorder are narrow interfaces over *upload.Client and
// *upload.Store so tests can substitute fakes without touching MinIO or the
// KV store.
type presigner interface {
	PresignPut(ctx context.Context, originalFilename string) (*upload.PresignResult, error)
}

type recorder interface {
	Record(m upload.Metadata) error
}

type Plugin struct {
	plugin.MattermostPlugin

	configurationLock sync.RWMutex
	configuration     *configuration

	router      *mux.Router
	minioClient presigner
	store       recorder
}

func (p *Plugin) OnActivate() error {
	conf := p.getConfiguration()

	minioClient, err := upload.NewClient(
		conf.MinIOEndpoint,
		conf.MinIOAccessKey,
		conf.MinIOSecretKey,
		conf.MinIOBucket,
		conf.MinIOUseSSL,
		publicBaseURL(conf),
	)
	if err != nil {
		return err
	}

	if err := minioClient.EnsurePublicReadBucket(context.Background()); err != nil {
		p.API.LogWarn("failed to set public-read bucket policy", "error", err.Error())
	}

	p.minioClient = minioClient
	p.store = upload.NewStore(p.API)
	p.router = p.initRouter()

	return nil
}

func publicBaseURL(conf *configuration) string {
	scheme := "http"
	if conf.MinIOUseSSL {
		scheme = "https"
	}
	return scheme + "://" + conf.MinIOEndpoint
}
```

- [ ] **Step 2: Replace `server/api.go`**

```go
package main

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/plugin"

	"github.com/acumenstrategy/picture-dump-plugin/server/upload"
)

func (p *Plugin) initRouter() *mux.Router {
	router := mux.NewRouter()
	router.Use(p.mattermostAuthorizationRequired)

	apiRouter := router.PathPrefix("/api/v1").Subrouter()
	apiRouter.HandleFunc("/uploads/presign", p.handlePresign).Methods(http.MethodPost)
	apiRouter.HandleFunc("/uploads/complete", p.handleComplete).Methods(http.MethodPost)

	return router
}

func (p *Plugin) ServeHTTP(c *plugin.Context, w http.ResponseWriter, r *http.Request) {
	p.router.ServeHTTP(w, r)
}

func (p *Plugin) mattermostAuthorizationRequired(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Mattermost-User-ID") == "" {
			http.Error(w, "Not authorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type presignRequestItem struct {
	ID          string `json:"id"`
	Filename    string `json:"filename"`
	Size        int64  `json:"size"`
	ContentType string `json:"contentType"`
}

type presignResultOrError struct {
	ID        string `json:"id"`
	UploadURL string `json:"uploadUrl,omitempty"`
	ObjectKey string `json:"objectKey,omitempty"`
	PublicURL string `json:"publicUrl,omitempty"`
	Error     string `json:"error,omitempty"`
}

func (p *Plugin) handlePresign(w http.ResponseWriter, r *http.Request) {
	var items []presignRequestItem
	if err := json.NewDecoder(r.Body).Decode(&items); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	files := make([]upload.FileRequest, len(items))
	for i, item := range items {
		files[i] = upload.FileRequest{Filename: item.Filename, Size: item.Size, ContentType: item.ContentType}
	}
	if err := upload.ValidateBatch(files); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	results := make([]presignResultOrError, len(items))
	for i, item := range items {
		if err := upload.ValidateFile(files[i]); err != nil {
			results[i] = presignResultOrError{ID: item.ID, Error: err.Error()}
			continue
		}

		presigned, err := p.minioClient.PresignPut(r.Context(), item.Filename)
		if err != nil {
			p.API.LogError("failed to presign upload", "error", err.Error())
			results[i] = presignResultOrError{ID: item.ID, Error: "failed to prepare upload"}
			continue
		}

		results[i] = presignResultOrError{
			ID:        item.ID,
			UploadURL: presigned.UploadURL,
			ObjectKey: presigned.ObjectKey,
			PublicURL: presigned.PublicURL,
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}

type completeRequest struct {
	ObjectKey string `json:"objectKey"`
	Filename  string `json:"filename"`
	Size      int64  `json:"size"`
}

func (p *Plugin) handleComplete(w http.ResponseWriter, r *http.Request) {
	var req completeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.ObjectKey == "" {
		http.Error(w, "objectKey is required", http.StatusBadRequest)
		return
	}

	err := p.store.Record(upload.Metadata{
		ObjectKey:  req.ObjectKey,
		Filename:   req.Filename,
		Size:       req.Size,
		UploaderID: r.Header.Get("Mattermost-User-ID"),
		UploadedAt: time.Now(),
	})
	if err != nil {
		p.API.LogError("failed to record upload metadata", "error", err.Error())
		http.Error(w, "failed to record upload", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
```

- [ ] **Step 3: Write the failing tests**

```go
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/acumenstrategy/picture-dump-plugin/server/upload"
)

type fakePresigner struct{}

func (f *fakePresigner) PresignPut(ctx context.Context, filename string) (*upload.PresignResult, error) {
	return &upload.PresignResult{
		ObjectKey: "fake-key.png",
		UploadURL: "https://storage.example.com/presigned",
		PublicURL: "https://storage.example.com/bucket/fake-key.png",
	}, nil
}

type fakeRecorder struct {
	recorded []upload.Metadata
}

func (f *fakeRecorder) Record(m upload.Metadata) error {
	f.recorded = append(f.recorded, m)
	return nil
}

func TestHandlePresignRejectsOversizedFile(t *testing.T) {
	p := &Plugin{minioClient: &fakePresigner{}}
	p.router = p.initRouter()

	body, _ := json.Marshal([]presignRequestItem{
		{ID: "1", Filename: "huge.png", Size: 20 * 1024 * 1024, ContentType: "image/png"},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/uploads/presign", bytes.NewReader(body))
	req.Header.Set("Mattermost-User-ID", "user1")
	rec := httptest.NewRecorder()

	p.ServeHTTP(nil, rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var results []presignResultOrError
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &results))
	require.Len(t, results, 1)
	assert.NotEmpty(t, results[0].Error)
	assert.Empty(t, results[0].UploadURL)
}

func TestHandlePresignAcceptsValidFile(t *testing.T) {
	p := &Plugin{minioClient: &fakePresigner{}}
	p.router = p.initRouter()

	body, _ := json.Marshal([]presignRequestItem{
		{ID: "1", Filename: "photo.png", Size: 1024, ContentType: "image/png"},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/uploads/presign", bytes.NewReader(body))
	req.Header.Set("Mattermost-User-ID", "user1")
	rec := httptest.NewRecorder()

	p.ServeHTTP(nil, rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var results []presignResultOrError
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &results))
	require.Len(t, results, 1)
	assert.Empty(t, results[0].Error)
	assert.Equal(t, "fake-key.png", results[0].ObjectKey)
}

func TestHandlePresignRejectsUnauthenticated(t *testing.T) {
	p := &Plugin{minioClient: &fakePresigner{}}
	p.router = p.initRouter()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/uploads/presign", bytes.NewReader([]byte("[]")))
	rec := httptest.NewRecorder()

	p.ServeHTTP(nil, rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestHandleCompleteRecordsMetadata(t *testing.T) {
	rec := &fakeRecorder{}
	p := &Plugin{store: rec}
	p.router = p.initRouter()

	body, _ := json.Marshal(completeRequest{ObjectKey: "abc.png", Filename: "photo.png", Size: 1024})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/uploads/complete", bytes.NewReader(body))
	req.Header.Set("Mattermost-User-ID", "user1")
	w := httptest.NewRecorder()

	p.ServeHTTP(nil, w, req)

	require.Equal(t, http.StatusNoContent, w.Code)
	require.Len(t, rec.recorded, 1)
	assert.Equal(t, "user1", rec.recorded[0].UploaderID)
	assert.Equal(t, "abc.png", rec.recorded[0].ObjectKey)
}
```

- [ ] **Step 4: Run tests to verify pass/fail as expected**

Run: `go test ./server/... -v`
Expected: all tests across `server/` and `server/upload/` PASS. (There's no separate red step here since Steps 1-2 already wrote both the implementation and the tests together — run once to confirm everything is wired correctly end-to-end.)

- [ ] **Step 5: Commit**

```bash
git add server/plugin.go server/api.go server/api_test.go
git commit -m "Wire presign/complete HTTP endpoints and MinIO client activation"
```

---

### Task 6: RHS panel registration (skeleton)

**Files:**
- Modify: `webapp/src/index.tsx`
- Create: `webapp/src/components/upload_icon.tsx`, `webapp/src/components/upload_panel/index.tsx`
- Test: `webapp/src/components/upload_panel/index.test.tsx`

**Interfaces:**
- Consumes: `registry.registerRightHandSidebarComponent(component, title)` and `registry.registerChannelHeaderButtonAction(icon, action, dropdownText, tooltipText)` (Mattermost webapp plugin SDK, confirmed current signatures)
- Produces: `UploadPanel` React component (mounted in RHS), rendered empty-state shell — Task 7 adds the dropzone logic to it.

- [ ] **Step 1: Add React Testing Library as a dev dependency**

The starter template ships `@testing-library/jest-dom` (custom matchers) but not the renderer itself.

```bash
cd webapp
npm install --save-dev @testing-library/react@14 @testing-library/user-event@14
cd ..
```

- [ ] **Step 2: Write the failing test**

```tsx
import React from 'react';
import {render, screen} from '@testing-library/react';

import UploadPanel from './index';

describe('UploadPanel', () => {
    it('renders the dropzone prompt', () => {
        render(<UploadPanel/>);
        expect(screen.getByText(/drag and drop files here/i)).toBeInTheDocument();
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd webapp && npm run test -- upload_panel/index.test.tsx`
Expected: FAIL — cannot find module `./index` (component doesn't exist yet).

- [ ] **Step 4: Write `webapp/src/components/upload_panel/index.tsx`**

```tsx
import React from 'react';

export default function UploadPanel() {
    return (
        <div className='picture-dump-panel'>
            <div className='picture-dump-dropzone'>
                {'Drag and drop files here (up to 10, 10MB each)'}
            </div>
        </div>
    );
}
```

- [ ] **Step 5: Write `webapp/src/components/upload_icon.tsx`**

```tsx
import React from 'react';

export default function UploadIcon() {
    return (
        <svg
            width='16'
            height='16'
            viewBox='0 0 16 16'
            fill='currentColor'
            xmlns='http://www.w3.org/2000/svg'
        >
            <path d='M8 1a.5.5 0 0 1 .5.5v8.793l2.146-2.147a.5.5 0 0 1 .708.708l-3 3a.5.5 0 0 1-.708 0l-3-3a.5.5 0 1 1 .708-.708L7.5 10.293V1.5A.5.5 0 0 1 8 1z'/>
            <path d='M2.5 13a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5z'/>
        </svg>
    );
}
```

- [ ] **Step 6: Register both in `webapp/src/index.tsx`**

```tsx
import manifest from 'manifest';
import type {Store} from 'redux';
import type {GlobalState} from '@mattermost/types/store';
import type {PluginRegistry} from 'types/mattermost-webapp';

import UploadPanel from './components/upload_panel';
import UploadIcon from './components/upload_icon';

export default class Plugin {
    public async initialize(registry: PluginRegistry, store: Store<GlobalState>) {
        const {toggleRHSPlugin} = registry.registerRightHandSidebarComponent(
            UploadPanel,
            'Picture Dump',
        );

        registry.registerChannelHeaderButtonAction(
            UploadIcon,
            () => store.dispatch(toggleRHSPlugin),
            'Picture Dump',
            'Upload files to Picture Dump',
        );
    }
}

declare global {
    interface Window {
        registerPlugin(pluginId: string, plugin: Plugin): void;
    }
}

window.registerPlugin(manifest.id, new Plugin());
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd webapp && npm run test -- upload_panel/index.test.tsx`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add webapp/src/index.tsx webapp/src/components/upload_icon.tsx webapp/src/components/upload_panel/index.tsx webapp/src/components/upload_panel/index.test.tsx webapp/package.json webapp/package-lock.json
git commit -m "Register RHS panel and channel header button"
```

---

### Task 7: Client-side validation and drag-drop zone

**Files:**
- Create: `webapp/src/components/upload_panel/validate.ts`, `webapp/src/components/upload_panel/validate.test.ts`, `webapp/src/components/upload_panel/file_dropzone.tsx`, `webapp/src/components/upload_panel/file_dropzone.test.tsx`, `webapp/src/components/upload_panel/types.ts`
- Modify: `webapp/src/components/upload_panel/index.tsx`

**Interfaces:**
- Consumes: nothing new
- Produces: `validateFile(file: File): string | null`, `validateBatch(files: File[]): string | null`, `UploadItem` type, `<FileDropzone onDrop={(files: File[]) => void}/>` — consumed by Task 8.

- [ ] **Step 1: Write the failing validation tests**

```ts
import {validateFile, validateBatch, MAX_FILE_SIZE} from './validate';

function makeFile(name: string, size: number): File {
    return new File([new Uint8Array(size)], name);
}

describe('validateFile', () => {
    it('accepts an allowed image under the size limit', () => {
        expect(validateFile(makeFile('photo.png', 1024))).toBeNull();
    });

    it('rejects a disallowed extension', () => {
        expect(validateFile(makeFile('script.exe', 1024))).toContain('not an allowed file type');
    });

    it('rejects a file over the size limit', () => {
        expect(validateFile(makeFile('big.png', MAX_FILE_SIZE + 1))).toContain('10MB size limit');
    });
});

describe('validateBatch', () => {
    it('accepts a batch of 10 files', () => {
        const files = Array.from({length: 10}, (_, i) => makeFile(`f${i}.png`, 100));
        expect(validateBatch(files)).toBeNull();
    });

    it('rejects a batch of 11 files', () => {
        const files = Array.from({length: 11}, (_, i) => makeFile(`f${i}.png`, 100));
        expect(validateBatch(files)).toContain('up to 10 files');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webapp && npm run test -- upload_panel/validate.test.ts`
Expected: FAIL — cannot find module `./validate`.

- [ ] **Step 3: Write `validate.ts`**

```ts
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_BATCH_SIZE = 10;

const ALLOWED_EXTENSIONS = [
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg',
    '.pdf', '.docx', '.xlsx', '.pptx', '.txt', '.zip',
];

export function getExtension(filename: string): string {
    const idx = filename.lastIndexOf('.');
    return idx === -1 ? '' : filename.slice(idx).toLowerCase();
}

export function validateFile(file: File): string | null {
    if (file.size > MAX_FILE_SIZE) {
        return `${file.name} exceeds the 10MB size limit`;
    }
    if (!ALLOWED_EXTENSIONS.includes(getExtension(file.name))) {
        return `${file.name} is not an allowed file type`;
    }
    return null;
}

export function validateBatch(files: File[]): string | null {
    if (files.length > MAX_BATCH_SIZE) {
        return `You can only upload up to ${MAX_BATCH_SIZE} files at once`;
    }
    return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webapp && npm run test -- upload_panel/validate.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Write `types.ts`**

```ts
export type UploadStatus = 'pending' | 'uploading' | 'done' | 'error';

export interface UploadItem {
    id: string;
    file: File;
    status: UploadStatus;
    progress: number; // 0-100
    publicUrl?: string;
    objectKey?: string;
    error?: string;
}
```

- [ ] **Step 6: Write the failing dropzone test**

```tsx
import React from 'react';
import {render} from '@testing-library/react';

import FileDropzone from './file_dropzone';

describe('FileDropzone', () => {
    it('calls onDrop with the dropped files', () => {
        const onDrop = jest.fn();
        const {container} = render(<FileDropzone onDrop={onDrop}/>);
        const dropzone = container.firstChild as HTMLElement;

        const file = new File(['data'], 'photo.png', {type: 'image/png'});
        const dataTransfer = {
            files: [file],
            items: [{kind: 'file', getAsFile: () => file}],
            types: ['Files'],
        };

        const dropEvent = new Event('drop', {bubbles: true, cancelable: true});
        Object.defineProperty(dropEvent, 'dataTransfer', {value: dataTransfer});
        dropzone.dispatchEvent(dropEvent);

        expect(onDrop).toHaveBeenCalledWith([file]);
    });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd webapp && npm run test -- upload_panel/file_dropzone.test.tsx`
Expected: FAIL — cannot find module `./file_dropzone`.

- [ ] **Step 8: Write `file_dropzone.tsx`**

```tsx
import React, {useCallback, useState} from 'react';

interface Props {
    onDrop: (files: File[]) => void;
}

export default function FileDropzone({onDrop}: Props) {
    const [isDragging, setIsDragging] = useState(false);

    const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDragging(false);
        const files = Array.from(event.dataTransfer.files);
        if (files.length > 0) {
            onDrop(files);
        }
    }, [onDrop]);

    return (
        <div
            className={'picture-dump-dropzone' + (isDragging ? ' picture-dump-dropzone--active' : '')}
            onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
        >
            {'Drag and drop files here (up to 10, 10MB each)'}
        </div>
    );
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd webapp && npm run test -- upload_panel/file_dropzone.test.tsx`
Expected: PASS

- [ ] **Step 10: Wire `FileDropzone` into `upload_panel/index.tsx`, tracking rejected files inline**

```tsx
import React, {useCallback, useState} from 'react';

import FileDropzone from './file_dropzone';
import {validateFile, validateBatch} from './validate';
import type {UploadItem} from './types';

function makeId(): string {
    return Math.random().toString(36).slice(2);
}

export default function UploadPanel() {
    const [items, setItems] = useState<UploadItem[]>([]);
    const [batchError, setBatchError] = useState<string | null>(null);

    const onDrop = useCallback((files: File[]) => {
        setBatchError(null);

        const batchIssue = validateBatch(files);
        if (batchIssue) {
            setBatchError(batchIssue);
            return;
        }

        const newItems: UploadItem[] = files.map((file) => {
            const validationError = validateFile(file);
            return {
                id: makeId(),
                file,
                status: validationError ? 'error' : 'pending',
                progress: 0,
                error: validationError || undefined,
            };
        });

        setItems((prev) => [...prev, ...newItems]);
    }, []);

    return (
        <div className='picture-dump-panel'>
            <FileDropzone onDrop={onDrop}/>
            {batchError && <div className='picture-dump-panel__batch-error'>{batchError}</div>}
            <div className='picture-dump-panel__list'>
                {items.map((item) => (
                    <div key={item.id} className='picture-dump-file-row'>
                        <span>{item.file.name}</span>
                        {item.status === 'error' && <span className='picture-dump-file-row__error'>{item.error}</span>}
                    </div>
                ))}
            </div>
        </div>
    );
}
```

- [ ] **Step 11: Update the render test and run the full suite**

Update `index.test.tsx`'s existing test to still pass unchanged (the placeholder text lives inside `FileDropzone` now, still rendered). Run: `cd webapp && npm run test`
Expected: PASS across all webapp test files.

- [ ] **Step 12: Commit**

```bash
git add webapp/src/components/upload_panel/
git commit -m "Add client-side validation and drag-drop zone with rejected-file feedback"
```

---

### Task 8: Upload orchestration (presign, XHR PUT, complete, retry)

**Files:**
- Create: `webapp/src/components/upload_panel/upload_client.ts`, `webapp/src/components/upload_panel/use_uploads.ts`, `webapp/src/components/upload_panel/use_uploads.test.ts`, `webapp/src/components/upload_panel/file_row.tsx`
- Modify: `webapp/src/components/upload_panel/index.tsx`

**Interfaces:**
- Consumes: `POST /plugins/com.acumenstrategy.picture-dump/api/v1/uploads/presign` and `.../uploads/complete` (Task 5), `validateFile`/`validateBatch` (Task 7), `UploadItem` (Task 7)
- Produces: `useUploads()` hook returning `{items, batchError, onDrop, retry}` — this is the panel's complete behavior; no further tasks consume it directly (it's the final integration point).

- [ ] **Step 1: Write `upload_client.ts`**

```ts
import type {UploadItem} from './types';

interface PresignRequestItem {
    id: string;
    filename: string;
    size: number;
    contentType: string;
}

interface PresignResultItem {
    id: string;
    uploadUrl?: string;
    objectKey?: string;
    publicUrl?: string;
    error?: string;
}

const API_BASE = '/plugins/com.acumenstrategy.picture-dump/api/v1';

export async function requestPresignedUrls(items: UploadItem[]): Promise<PresignResultItem[]> {
    const body: PresignRequestItem[] = items.map((item) => ({
        id: item.id,
        filename: item.file.name,
        size: item.file.size,
        contentType: item.file.type,
    }));

    const response = await fetch(`${API_BASE}/uploads/presign`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw new Error('Failed to request upload URLs');
    }

    return response.json();
}

export function uploadFile(file: File, uploadUrl: string, onProgress: (percent: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl);
        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                onProgress(Math.round((event.loaded / event.total) * 100));
            }
        };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
            } else {
                reject(new Error(`Upload failed with status ${xhr.status}`));
            }
        };
        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.send(file);
    });
}

export async function confirmUpload(objectKey: string, filename: string, size: number): Promise<void> {
    const response = await fetch(`${API_BASE}/uploads/complete`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({objectKey, filename, size}),
    });

    if (!response.ok) {
        throw new Error('Failed to confirm upload');
    }
}
```

- [ ] **Step 2: Write the failing hook test**

```ts
import {renderHook, act, waitFor} from '@testing-library/react';

import {useUploads} from './use_uploads';

function makeFile(name: string, size = 1024, type = 'image/png'): File {
    return new File([new Uint8Array(size)], name, {type});
}

class FakeXHR {
    upload = {onprogress: null as ((e: ProgressEvent) => void) | null};
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    status = 200;
    open = jest.fn();
    send = jest.fn(() => {
        this.upload.onprogress?.({lengthComputable: true, loaded: 100, total: 100} as ProgressEvent);
        this.onload?.();
    });
}

describe('useUploads', () => {
    beforeEach(() => {
        (global as any).XMLHttpRequest = FakeXHR;
        global.fetch = jest.fn().
            mockResolvedValueOnce({
                ok: true,
                json: async () => [{
                    id: 'irrelevant',
                    uploadUrl: 'https://storage.example.com/presigned',
                    objectKey: 'abc.png',
                    publicUrl: 'https://storage.example.com/bucket/abc.png',
                }],
            } as Response).
            mockResolvedValueOnce({ok: true, json: async () => ({})} as Response);
    });

    it('uploads a valid dropped file and records its public url', async () => {
        const {result} = renderHook(() => useUploads());

        act(() => {
            result.current.onDrop([makeFile('photo.png')]);
        });

        await waitFor(() => expect(result.current.items[0]?.status).toBe('done'));
        expect(result.current.items[0].publicUrl).toBe('https://storage.example.com/bucket/abc.png');
    });

    it('marks a disallowed file type as an error without calling fetch', () => {
        const {result} = renderHook(() => useUploads());

        act(() => {
            result.current.onDrop([makeFile('virus.exe')]);
        });

        expect(result.current.items[0].status).toBe('error');
        expect(global.fetch).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd webapp && npm run test -- upload_panel/use_uploads.test.ts`
Expected: FAIL — cannot find module `./use_uploads`.

- [ ] **Step 4: Write `use_uploads.ts`**

```ts
import {useCallback, useState} from 'react';

import type {UploadItem, UploadStatus} from './types';
import {validateFile, validateBatch} from './validate';
import {requestPresignedUrls, uploadFile, confirmUpload} from './upload_client';

function makeId(): string {
    return Math.random().toString(36).slice(2);
}

function updateItem(items: UploadItem[], id: string, changes: Partial<UploadItem>): UploadItem[] {
    return items.map((item) => (item.id === id ? {...item, ...changes} : item));
}

export function useUploads() {
    const [items, setItems] = useState<UploadItem[]>([]);
    const [batchError, setBatchError] = useState<string | null>(null);

    const startUpload = useCallback(async (item: UploadItem) => {
        setItems((prev) => updateItem(prev, item.id, {status: 'uploading' as UploadStatus, progress: 0, error: undefined}));

        try {
            const [result] = await requestPresignedUrls([item]);
            if (result.error || !result.uploadUrl || !result.objectKey || !result.publicUrl) {
                setItems((prev) => updateItem(prev, item.id, {status: 'error', error: result.error || 'Failed to prepare upload'}));
                return;
            }

            await uploadFile(item.file, result.uploadUrl, (progress) => {
                setItems((prev) => updateItem(prev, item.id, {progress}));
            });

            await confirmUpload(result.objectKey, item.file.name, item.file.size);

            setItems((prev) => updateItem(prev, item.id, {
                status: 'done',
                progress: 100,
                publicUrl: result.publicUrl,
                objectKey: result.objectKey,
            }));
        } catch (err) {
            setItems((prev) => updateItem(prev, item.id, {status: 'error', error: (err as Error).message}));
        }
    }, []);

    const onDrop = useCallback((files: File[]) => {
        setBatchError(null);

        const batchIssue = validateBatch(files);
        if (batchIssue) {
            setBatchError(batchIssue);
            return;
        }

        const newItems: UploadItem[] = files.map((file) => {
            const validationError = validateFile(file);
            return {
                id: makeId(),
                file,
                status: validationError ? 'error' : 'pending',
                progress: 0,
                error: validationError || undefined,
            };
        });

        setItems((prev) => [...prev, ...newItems]);

        newItems.
            filter((item) => item.status === 'pending').
            forEach((item) => { startUpload(item); });
    }, [startUpload]);

    const retry = useCallback((id: string) => {
        setItems((prev) => {
            const item = prev.find((i) => i.id === id);
            if (item) {
                startUpload({...item, status: 'pending', error: undefined});
            }
            return prev;
        });
    }, [startUpload]);

    return {items, batchError, onDrop, retry};
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd webapp && npm run test -- upload_panel/use_uploads.test.ts`
Expected: PASS (both tests)

- [ ] **Step 6: Write `file_row.tsx`**

```tsx
import React, {useState} from 'react';

import type {UploadItem} from './types';

interface Props {
    item: UploadItem;
    onRetry: (id: string) => void;
}

export default function FileRow({item, onRetry}: Props) {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        if (item.publicUrl) {
            navigator.clipboard.writeText(item.publicUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <div className='picture-dump-file-row'>
            <div className='picture-dump-file-row__name'>{item.file.name}</div>
            {item.status === 'uploading' && (
                <div className='picture-dump-file-row__progress'>
                    <div
                        className='picture-dump-file-row__progress-bar'
                        style={{width: `${item.progress}%`}}
                    />
                </div>
            )}
            {item.status === 'done' && item.publicUrl && (
                <div className='picture-dump-file-row__done'>
                    <a href={item.publicUrl} target='_blank' rel='noopener noreferrer'>{item.publicUrl}</a>
                    <button onClick={handleCopy}>{copied ? 'Copied!' : 'Copy link'}</button>
                </div>
            )}
            {item.status === 'error' && (
                <div className='picture-dump-file-row__error'>
                    <span>{item.error}</span>
                    <button onClick={() => onRetry(item.id)}>{'Retry'}</button>
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 7: Replace `index.tsx` to use the hook and `FileRow`**

```tsx
import React from 'react';

import FileDropzone from './file_dropzone';
import FileRow from './file_row';
import {useUploads} from './use_uploads';

export default function UploadPanel() {
    const {items, batchError, onDrop, retry} = useUploads();

    return (
        <div className='picture-dump-panel'>
            <FileDropzone onDrop={onDrop}/>
            {batchError && <div className='picture-dump-panel__batch-error'>{batchError}</div>}
            <div className='picture-dump-panel__list'>
                {items.map((item) => (
                    <FileRow key={item.id} item={item} onRetry={retry}/>
                ))}
            </div>
        </div>
    );
}
```

- [ ] **Step 8: Add theme-aware styling using Mattermost's CSS custom properties**

Create `webapp/src/components/upload_panel/upload_panel.scss`:

```scss
.picture-dump-dropzone {
    border: 2px dashed var(--center-channel-color-32, rgba(63, 67, 80, 0.32));
    border-radius: 4px;
    padding: 24px;
    text-align: center;
    color: var(--center-channel-color-64, rgba(63, 67, 80, 0.64));
    margin-bottom: 12px;

    &--active {
        border-color: var(--button-bg, #1c58d9);
        background: var(--button-bg-08, rgba(28, 88, 217, 0.08));
    }
}

.picture-dump-file-row {
    padding: 8px 0;
    border-bottom: 1px solid var(--center-channel-color-08, rgba(63, 67, 80, 0.08));

    &__name {
        font-weight: 600;
        color: var(--center-channel-color);
    }

    &__progress {
        height: 4px;
        background: var(--center-channel-color-08, rgba(63, 67, 80, 0.08));
        border-radius: 2px;
        margin-top: 4px;
    }

    &__progress-bar {
        height: 100%;
        background: var(--button-bg, #1c58d9);
        border-radius: 2px;
        transition: width 0.2s ease;
    }

    &__error {
        color: var(--error-text, #d24b4e);
    }
}
```

Import it at the top of `index.tsx`: `import './upload_panel.scss';`

Note: the `var(--x, fallback)` fallback values keep the panel usable even if a specific Mattermost CSS variable name has changed between versions — during manual QA, visually compare against light/dark theme and adjust variable names here if the native look doesn't match.

- [ ] **Step 9: Run the full webapp test suite**

Run: `cd webapp && npm run test`
Expected: PASS across all test files.

- [ ] **Step 10: Commit**

```bash
git add webapp/src/components/upload_panel/
git commit -m "Wire presign/upload/complete orchestration with progress, links, and retry"
```

---

### Task 9: Local docker-compose stack for manual QA

**Files:**
- Create: `docker/docker-compose.yml`, `docker/apisix_conf/config-standalone.yaml`, `docker/apisix_conf/apisix-standalone.yaml`, `docker/README.md`

**Interfaces:**
- Consumes: nothing (infrastructure only)
- Produces: a running Mattermost + Postgres + MinIO + APISIX stack, reachable at `http://localhost:8065` (Mattermost) and `http://localhost:9080` (APISIX-fronted MinIO) — this is the acceptance environment for Task 10 and the user's manual QA.

- [ ] **Step 1: Write `docker/apisix_conf/config-standalone.yaml`**

```yaml
deployment:
  role: data_plane
  role_data_plane:
    config_provider: yaml
apisix:
  enable_admin: false
nginx_config:
  http:
    client_max_body_size: 20m
```

(`client_max_body_size: 20m` gives headroom above the 10MB per-file cap.)

- [ ] **Step 2: Write `docker/apisix_conf/apisix-standalone.yaml`**

The `#END` marker is mandatory — APISIX will not load the file without it. The route uses a catch-all `/*` rather than matching a specific bucket name path (e.g. `/uploads/*`), since this APISIX instance's only job in this stack is fronting MinIO — a catch-all avoids silently breaking if the `MinIOBucket` setting is ever changed from its `uploads` default.

```yaml
routes:
  - uri: /*
    upstream:
      nodes:
        "minio:9000": 1
      type: roundrobin
    plugins:
      cors:
        allow_origins: "http://localhost:8065"
        allow_methods: "GET,PUT,POST,OPTIONS"
        allow_headers: "*"
        expose_headers: "ETag"
        max_age: 5
#END
```

(`pass_host` is intentionally omitted — APISIX's default, `pass`, forwards the browser's original Host header unchanged, which is required for the presigned URL's signature to validate. Do not add a `proxy-rewrite` plugin to this route.)

- [ ] **Step 3: Write `docker/docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: mmuser
      POSTGRES_PASSWORD: mmuser_password
      POSTGRES_DB: mattermost
    volumes:
      - postgres_data:/var/lib/postgresql/data

  mattermost:
    image: mattermost/mattermost-team-edition:latest
    depends_on:
      - postgres
    ports:
      - "8065:8065"
    environment:
      MM_SQLSETTINGS_DRIVERNAME: postgres
      MM_SQLSETTINGS_DATASOURCE: "postgres://mmuser:mmuser_password@postgres:5432/mattermost?sslmode=disable"
      MM_SERVICESETTINGS_SITEURL: "http://localhost:8065"
      MM_PLUGINSETTINGS_ENABLEUPLOADS: "true"
    volumes:
      - mattermost_data:/mattermost/data
      - mattermost_config:/mattermost/config

  minio:
    image: quay.io/minio/minio:RELEASE.2025-09-06T17-38-46Z
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    volumes:
      - minio_data:/data
    command: server /data --console-address ":9001"

  minio-init:
    image: minio/mc
    depends_on:
      - minio
    entrypoint: >
      /bin/sh -c "
      until mc alias set local http://minio:9000 minioadmin minioadmin; do sleep 1; done;
      mc mb --ignore-existing local/uploads;
      "

  apisix:
    image: apache/apisix:3.17.0-debian
    depends_on:
      - minio
    ports:
      - "9080:9080"
    volumes:
      - ./apisix_conf/apisix-standalone.yaml:/usr/local/apisix/conf/apisix.yaml:ro
      - ./apisix_conf/config-standalone.yaml:/usr/local/apisix/conf/config.yaml:ro

volumes:
  postgres_data:
  mattermost_data:
  mattermost_config:
  minio_data:
```

- [ ] **Step 4: Write `docker/README.md`**

```markdown
# Local QA stack

Brings up Mattermost, Postgres, MinIO, and APISIX (fronting MinIO) for manual
end-to-end testing of the picture-dump plugin.

## Start

    docker compose -f docker/docker-compose.yml up -d

Mattermost: http://localhost:8065 (complete first-run setup to create an
admin account and a team).
APISIX-fronted MinIO: http://localhost:9080

## Sanity-check the presigned upload path before touching the UI

This isolates signature/CORS problems from browser/plugin issues.

1. Build the plugin (`make dist` from the repo root) and note the MinIO
   settings you configure in System Console (Task 10) — endpoint should be
   `localhost:9080`, SSL off.
2. From the plugin's own logs or a small Go snippet, obtain one presigned
   PUT URL (or temporarily log one from `handlePresign` during this check).
3. Confirm the raw PUT succeeds through the public APISIX hostname:

       curl -X PUT "<presigned-url>" --data-binary @/path/to/test-file.png -v

   Expected: `200 OK` / `HTTP/1.1 200`, not `SignatureDoesNotMatch`.

## Stop

    docker compose -f docker/docker-compose.yml down

Add `-v` to also remove volumes (wipes all data, including the MinIO bucket
and Mattermost database) if you want a clean slate.
```

- [ ] **Step 5: Bring the stack up and verify all services report healthy**

```bash
docker compose -f docker/docker-compose.yml up -d
docker compose -f docker/docker-compose.yml ps
```

Expected: `postgres`, `mattermost`, `minio`, `apisix` all running; `minio-init` exits 0 (it's a one-shot init job).

- [ ] **Step 6: Commit**

```bash
git add docker/
git commit -m "Add local docker-compose stack (Mattermost, Postgres, MinIO, APISIX) for manual QA"
```

---

### Task 10: Deploy the plugin into the stack and hand off for manual QA

**Files:**
- No new files — this task builds and deploys the artifacts from Tasks 1-9 into the Task 9 stack.

**Interfaces:**
- Consumes: everything from Tasks 1-9
- Produces: an activated, configured plugin inside the running Mattermost instance, ready for the user's manual click-through QA.

- [ ] **Step 1: Build the plugin bundle**

```bash
make dist
```

Expected: `dist/com.acumenstrategy.picture-dump-<version>.tar.gz` is created with no build errors.

- [ ] **Step 2: Upload and enable the plugin via System Console**

1. Log into `http://localhost:8065` as the admin account created during Mattermost's first-run setup.
2. Go to System Console → Plugins → Plugin Management.
3. Upload `dist/com.acumenstrategy.picture-dump-<version>.tar.gz`.
4. Go to System Console → Plugins → Picture Dump, and set:
   - MinIO Endpoint: `localhost:9080`
   - Use HTTPS: off
   - MinIO Access Key: `minioadmin`
   - MinIO Secret Key: `minioadmin`
   - MinIO Bucket: `uploads`
5. Enable the plugin.

- [ ] **Step 2: Verify activation succeeded**

```bash
docker compose -f docker/docker-compose.yml logs mattermost | grep -i "picture-dump"
```

Expected: no error-level log lines referencing the plugin (e.g. no `"failed to create minio client"`); if `EnsurePublicReadBucket` warns, confirm the `uploads` bucket exists (from Task 9's `minio-init` service) and MinIO is reachable at `minio:9000` from inside the Mattermost container's network — note this is the plugin's *internal* Docker-network call to set the bucket policy, which is separate from the *public* APISIX endpoint used for presigning.

- [ ] **Step 3: Hand off to the user for manual QA**

Confirm with the user that they can now:

1. Open any channel, click the "Picture Dump" channel header button — the RHS panel should open and match Mattermost's current theme (test both light and dark theme from Settings → Display).
2. Drag and drop 1 file, then a batch of multiple files (up to 10) at once, and confirm each file's progress bar and public link appear independently as that file completes.
3. Try a disallowed file type and an oversized file, confirming instant client-side rejection with no network delay.
4. Open a returned public link directly in a new browser tab (unauthenticated) and confirm the file loads.
5. Try uploading 11 files at once and confirm the whole batch is rejected with a clear message.

Report back anything that doesn't match, referencing which step above it was found under.

