package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"time"
)

const maxRecent = 12

// RecentFile is a document opened or saved recently, listed on the start screen
type RecentFile struct {
	Path   string `json:"path"`
	Name   string `json:"name"`
	Opened string `json:"opened"` // RFC 3339
}

// recentList is kept in the user's config folder (%AppData%\Raya on Windows), newest first
type recentList struct {
	file string
}

func newRecentList() *recentList {
	dir, err := os.UserConfigDir()
	if err != nil {
		return &recentList{} // nowhere to keep it: the list stays empty
	}
	return &recentList{file: filepath.Join(dir, "Raya", "recent.json")}
}

func (r *recentList) load() []RecentFile {
	if r.file == "" {
		return nil
	}
	data, err := os.ReadFile(r.file)
	if err != nil {
		return nil
	}
	var list []RecentFile
	if json.Unmarshal(data, &list) != nil {
		return nil
	}
	return list
}

func (r *recentList) save(list []RecentFile) {
	if r.file == "" {
		return
	}
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil || os.MkdirAll(filepath.Dir(r.file), 0o755) != nil {
		return
	}
	_ = writeFileAtomic(r.file, data)
}

// existing lists the files that are still where they were (moved or deleted ones are left out)
func (r *recentList) existing() []RecentFile {
	list := []RecentFile{}
	for _, f := range r.load() {
		if info, err := os.Stat(f.Path); err == nil && !info.IsDir() {
			list = append(list, f)
		}
	}
	return list
}

// add puts a file at the top of the list
func (r *recentList) add(path string) {
	list := []RecentFile{{Path: path, Name: docName(path), Opened: time.Now().Format(time.RFC3339)}}
	for _, f := range r.load() {
		if !samePath(f.Path, path) && len(list) < maxRecent {
			list = append(list, f)
		}
	}
	r.save(list)
}

func (r *recentList) remove(path string) {
	list := []RecentFile{}
	for _, f := range r.load() {
		if !samePath(f.Path, path) {
			list = append(list, f)
		}
	}
	r.save(list)
}

var caseInsensitiveFS = goruntime.GOOS == "windows" || goruntime.GOOS == "darwin"

// samePath compares paths the way the file system does: case-insensitively on Windows and macOS
// (their usual file systems), exactly elsewhere
func samePath(a, b string) bool {
	a, b = filepath.Clean(a), filepath.Clean(b)
	if caseInsensitiveFS {
		return strings.EqualFold(a, b)
	}
	return a == b
}
