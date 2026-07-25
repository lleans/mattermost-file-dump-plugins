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
