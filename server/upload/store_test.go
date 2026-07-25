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
