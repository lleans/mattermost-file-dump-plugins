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

	adminEndpoint := conf.MinIOInternalEndpoint
	if adminEndpoint == "" {
		adminEndpoint = conf.MinIOEndpoint
	}

	adminClient, err := upload.NewAdminClient(adminEndpoint, conf.MinIOAccessKey, conf.MinIOSecretKey, conf.MinIOUseSSL)
	if err != nil {
		p.API.LogWarn("failed to create minio admin client", "error", err.Error())
	} else if err := upload.EnsurePublicReadBucket(context.Background(), adminClient, conf.MinIOBucket); err != nil {
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
