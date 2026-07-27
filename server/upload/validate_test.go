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
