package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// A Raya document on disk is a small JSON file: the editor's contents as Quill ops, plus a format
// name and version so a newer app can tell old files apart and an older one can refuse newer files.
// Autosave is the document's own setting, kept in the file so it moves and copies with it (and left
// out when off, which older versions of the app read the same way).
//
//	{"format": "raya", "version": 1, "autosave": true, "ops": [{"insert": "Hello\n"}]}
const (
	fileExt       = ".raya"
	fileFormat    = "raya"
	formatVersion = 1
)

type fileContents struct {
	Format   string          `json:"format"`
	Version  int             `json:"version"`
	Autosave bool            `json:"autosave,omitempty"`
	Ops      json.RawMessage `json:"ops"`
}

// Document is an open file as the frontend sees it
type Document struct {
	Path     string          `json:"path"`
	Name     string          `json:"name"`
	Autosave bool            `json:"autosave"`
	Ops      json.RawMessage `json:"ops"`
}

// docName is the name shown for a file: its base name without the extension
func docName(path string) string {
	base := filepath.Base(path)
	return strings.TrimSuffix(base, filepath.Ext(base))
}

// withExt adds .raya to a path chosen in a save dialog when the extension was left out
func withExt(path, ext string) string {
	if strings.EqualFold(filepath.Ext(path), ext) {
		return path
	}
	return path + ext
}

// checkOps makes sure ops is a JSON array, as Quill's contents always are
func checkOps(ops json.RawMessage) error {
	var list []json.RawMessage
	if err := json.Unmarshal(ops, &list); err != nil {
		return errors.New("the document's contents are not a list of edits")
	}
	return nil
}

func readDocument(path string) (*Document, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var contents fileContents
	if err := json.Unmarshal(data, &contents); err != nil || contents.Format != fileFormat {
		return nil, fmt.Errorf("%s is not a Raya document", filepath.Base(path))
	}
	if contents.Version > formatVersion {
		return nil, fmt.Errorf("%s was made by a newer version of Raya; update Raya to open it", filepath.Base(path))
	}
	if err := checkOps(contents.Ops); err != nil {
		return nil, fmt.Errorf("%s is damaged: %w", filepath.Base(path), err)
	}
	return &Document{Path: path, Name: docName(path), Autosave: contents.Autosave, Ops: contents.Ops}, nil
}

// writeDocument saves through a temporary file in the same folder, renamed over the old file once it
// is fully written, so a crash or a full disk never leaves half a document behind
func writeDocument(path string, ops json.RawMessage, autosave bool) error {
	if err := checkOps(ops); err != nil {
		return err
	}
	data, err := json.Marshal(fileContents{Format: fileFormat, Version: formatVersion, Autosave: autosave, Ops: ops})
	if err != nil {
		return err
	}
	return writeFileAtomic(path, data)
}

func writeFileAtomic(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".*.tmp")
	if err != nil {
		return err
	}
	// removes the temporary file if anything below fails (after the rename it no longer exists)
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		// Some folders can't rename files into place even within themselves (redirected or synced
		// folders report "a different disk drive"): then the file is written directly instead
		return os.WriteFile(path, data, 0o644)
	}
	return nil
}
