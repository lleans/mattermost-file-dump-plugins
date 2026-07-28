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

	"github.com/lleans/file-dump-plugin/server/upload"
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
