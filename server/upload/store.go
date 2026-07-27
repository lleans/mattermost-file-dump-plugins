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
