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
