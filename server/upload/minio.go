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
		Creds: credentials.NewStaticV4(accessKey, secretKey, ""),
		// Region is fixed rather than auto-discovered: without it, minio-go
		// resolves the bucket's region via a live GetBucketLocation network
		// call before it can sign anything, which would make presigning
		// depend on network access to the (possibly not-yet-reachable)
		// MinIO endpoint. Presigning is otherwise a pure local cryptographic
		// operation and must stay that way.
		Region: "us-east-1",
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
