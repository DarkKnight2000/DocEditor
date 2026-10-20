package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is what the frontend calls (wailsjs/go/main/App.js). Everything stays on this computer:
// documents are files the person picks, and nothing is sent anywhere.
type App struct {
	ctx    context.Context
	recent *recentList

	mu sync.Mutex
	// a file given on the command line (e.g. a double-clicked .raya file), opened at startup
	startupFile string
	// unsaved changes on screen: closing the window then asks the frontend first
	dirty    bool
	quitting bool
}

var rayaFilter = []runtime.FileFilter{{DisplayName: "Raya documents (*.raya)", Pattern: "*" + fileExt}}

func NewApp(args []string) *App {
	app := &App{recent: newRecentList()}
	for _, arg := range args {
		if strings.EqualFold(filepath.Ext(arg), fileExt) {
			if abs, err := filepath.Abs(arg); err == nil {
				app.startupFile = abs
			}
			break
		}
	}
	return app
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// beforeClose keeps the window open while there are unsaved changes and asks the frontend, which
// offers to save them and then calls Quit
func (a *App) beforeClose(ctx context.Context) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.dirty && !a.quitting {
		runtime.EventsEmit(ctx, "close-requested")
		return true
	}
	return false
}

// StartupFile is the file to open when the app starts, or "" for the start screen. Only the first call
// gets it, so a reload of the page doesn't open it again over other work.
func (a *App) StartupFile() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	path := a.startupFile
	a.startupFile = ""
	return path
}

// SetDirty tells the app whether there are unsaved changes
func (a *App) SetDirty(dirty bool) {
	a.mu.Lock()
	a.dirty = dirty
	a.mu.Unlock()
}

// Quit closes the app without asking again
func (a *App) Quit() {
	a.mu.Lock()
	a.quitting = true
	a.mu.Unlock()
	runtime.Quit(a.ctx)
}

// OpenDialog asks for a document to open; nil when the person cancels
func (a *App) OpenDialog() (*Document, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Open document",
		Filters: rayaFilter,
	})
	if err != nil || path == "" {
		return nil, err
	}
	return a.Open(path)
}

// Open reads a document, e.g. one from the recent list
func (a *App) Open(path string) (*Document, error) {
	doc, err := readDocument(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			a.recent.remove(path)
			return nil, errors.New("the file was moved or deleted")
		}
		return nil, err
	}
	a.recent.add(path)
	return doc, nil
}

// Save writes the contents and the document's autosave setting to an existing document
func (a *App) Save(path string, ops json.RawMessage, autosave bool) error {
	if err := writeDocument(path, ops, autosave); err != nil {
		return err
	}
	a.recent.add(path)
	return nil
}

// SaveAs asks where to save and writes the document there. It returns the saved document without its
// contents (the frontend already has them), or nil when the person cancels.
func (a *App) SaveAs(name string, ops json.RawMessage, autosave bool) (*Document, error) {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Save document",
		DefaultFilename: safeFileName(name, "Untitled") + fileExt,
		Filters:         rayaFilter,
	})
	if err != nil || path == "" {
		return nil, err
	}
	path = withExt(path, fileExt)
	if err := a.Save(path, ops, autosave); err != nil {
		return nil, err
	}
	return &Document{Path: path, Name: docName(path), Autosave: autosave}, nil
}

// ExportDocx asks where to save a Word file made by the frontend (export_docx.js), sent as base64.
// It returns the path saved to, or "" when the person cancels.
func (a *App) ExportDocx(name string, docxBase64 string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(docxBase64)
	if err != nil {
		return "", errors.New("the Word file could not be created")
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Export as Word document",
		DefaultFilename: safeFileName(name, "Untitled") + ".docx",
		Filters:         []runtime.FileFilter{{DisplayName: "Word documents (*.docx)", Pattern: "*.docx"}},
	})
	if err != nil || path == "" {
		return "", err
	}
	path = withExt(path, ".docx")
	return path, writeFileAtomic(path, data)
}

// The start screen opens in a small window; documents fill the screen (maximised, keeping the title
// bar and taskbar, as other editors open documents)
const (
	homeWidth  = 760
	homeHeight = 600
)

// ShowDocumentWindow maximises the window for a document
func (a *App) ShowDocumentWindow() {
	runtime.WindowMaximise(a.ctx)
}

// ShowHomeWindow returns the window to the start screen's size, in the middle of the screen
func (a *App) ShowHomeWindow() {
	runtime.WindowUnmaximise(a.ctx)
	runtime.WindowSetSize(a.ctx, homeWidth, homeHeight)
	runtime.WindowCenter(a.ctx)
}

// RecentFiles lists recently used documents that still exist, newest first
func (a *App) RecentFiles() []RecentFile {
	return a.recent.existing()
}

// ForgetRecent takes a document off the recent list (the file itself is kept)
func (a *App) ForgetRecent(path string) {
	a.recent.remove(path)
}

// ShowInFolder opens the file manager with a document selected
func (a *App) ShowInFolder(path string) error {
	var cmd *exec.Cmd
	switch goruntime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", "/select,", filepath.Clean(path))
	case "darwin":
		cmd = exec.Command("open", "-R", path)
	default:
		cmd = exec.Command("xdg-open", filepath.Dir(path))
	}
	// Explorer exits with 1 even when it worked, so only a failure to start it counts
	return cmd.Start()
}

// safeFileName turns a document name into a file name: no characters Windows refuses, no trailing
// dots or spaces, and a fallback when nothing is left
func safeFileName(name, fallback string) string {
	name = strings.Map(func(r rune) rune {
		if r < 32 || strings.ContainsRune(`<>:"/\|?*`, r) {
			return '-'
		}
		return r
	}, name)
	name = strings.TrimRight(strings.TrimSpace(name), ". ")
	if name == "" {
		return fallback
	}
	return name
}
