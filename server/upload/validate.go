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
