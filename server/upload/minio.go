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

// newMinioClient builds a raw *minio.Client shared by both the public
// (presigning) and admin/internal constructors.
func newMinioClient(endpoint, accessKey, secretKey string, useSSL bool) (*minio.Client, error) {
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
	return mc, nil
}

// NewClient builds a Client for presigning uploads against the given public
// endpoint (host[:port], no scheme) and bucket.
func NewClient(endpoint, accessKey, secretKey, bucket string, useSSL bool, publicBase string) (*Client, error) {
	mc, err := newMinioClient(endpoint, accessKey, secretKey, useSSL)
	if err != nil {
		return nil, err
	}
	return &Client{mc: mc, bucket: bucket, publicBase: publicBase}, nil
}

// NewAdminClient builds a raw *minio.Client for live, directly-authenticated
// admin S3 API calls (e.g. EnsurePublicReadBucket's SetBucketPolicy) against
// the given endpoint. Unlike NewClient, this endpoint does NOT need to be
// browser-reachable or match any presigned-URL Host header - it only needs
// to be reachable from wherever the plugin backend process runs. Callers may
// pass an internal/private endpoint here (e.g. minio:9000 on a Docker
// network) even when NewClient is separately configured with a distinct
// public endpoint for presigning.
func NewAdminClient(endpoint, accessKey, secretKey string, useSSL bool) (*minio.Client, error) {
	return newMinioClient(endpoint, accessKey, secretKey, useSSL)
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
//
// This is a standalone function (not a *Client method) because it is a live,
// directly-authenticated admin S3 API call, not a presigned URL: it needs
// actual network reachability from wherever the plugin backend process runs,
// not signature-compatibility with a browser. Callers should pass a
// *minio.Client built via NewAdminClient, which may be configured against an
// internal endpoint distinct from the public one used for presigning.
func EnsurePublicReadBucket(ctx context.Context, mc *minio.Client, bucket string) error {
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
	}`, bucket)

	return mc.SetBucketPolicy(ctx, bucket, policy)
}
