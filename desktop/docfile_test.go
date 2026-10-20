package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSaveAndOpenKeepsTheContents(t *testing.T) {
	path := filepath.Join(t.TempDir(), "Notes.raya")
	ops := json.RawMessage(`[{"insert":"Hello"},{"insert":"\n","attributes":{"align":"center"}}]`)

	if err := writeDocument(path, ops); err != nil {
		t.Fatal(err)
	}
	doc, err := readDocument(path)
	if err != nil {
		t.Fatal(err)
	}
	if doc.Name != "Notes" || doc.Path != path {
		t.Errorf("got name %q path %q", doc.Name, doc.Path)
	}
	if string(doc.Ops) != string(ops) {
		t.Errorf("contents changed: %s", doc.Ops)
	}
}

func TestSavingReplacesTheFileAndLeavesNoTemporaryFiles(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "a.raya")
	for _, text := range []string{"first", "second"} {
		if err := writeDocument(path, json.RawMessage(`[{"insert":"`+text+`\n"}]`)); err != nil {
			t.Fatal(err)
		}
	}
	doc, err := readDocument(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(doc.Ops), "second") {
		t.Errorf("old contents kept: %s", doc.Ops)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Errorf("expected only the document in the folder, found %d files", len(entries))
	}
}

func TestContentsThatAreNotAListAreNotSaved(t *testing.T) {
	path := filepath.Join(t.TempDir(), "a.raya")
	if err := writeDocument(path, json.RawMessage(`{"insert":"x"}`)); err == nil {
		t.Error("saved contents that aren't a list")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Error("a file was created")
	}
}

func TestOpenRefusesFilesThatAreNotRayaDocuments(t *testing.T) {
	dir := t.TempDir()
	cases := map[string]string{
		"not json":      `hello`,
		"other json":    `{"name":"x"}`,
		"newer version": `{"format":"raya","version":99,"ops":[]}`,
		"damaged ops":   `{"format":"raya","version":1,"ops":"x"}`,
	}
	for name, contents := range cases {
		path := filepath.Join(dir, strings.ReplaceAll(name, " ", "_")+".raya")
		os.WriteFile(path, []byte(contents), 0o644)
		if _, err := readDocument(path); err == nil {
			t.Errorf("%s: opened", name)
		}
	}
}

func TestWithExtAddsTheExtensionOnlyWhenMissing(t *testing.T) {
	cases := map[string]string{
		`C:\docs\Notes`:      `C:\docs\Notes.raya`,
		`C:\docs\Notes.raya`: `C:\docs\Notes.raya`,
		`C:\docs\Notes.RAYA`: `C:\docs\Notes.RAYA`,
		`C:\docs\v1.2`:       `C:\docs\v1.2.raya`,
	}
	for in, want := range cases {
		if got := withExt(in, fileExt); got != want {
			t.Errorf("withExt(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSafeFileName(t *testing.T) {
	cases := map[string]string{
		"Trip plans":      "Trip plans",
		"a/b: c?":         "a-b- c-",
		"  ends with... ": "ends with",
		"   ":             "Untitled",
	}
	for in, want := range cases {
		if got := safeFileName(in, "Untitled"); got != want {
			t.Errorf("safeFileName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestRecentListPutsTheLatestFirstAndDropsMissingFiles(t *testing.T) {
	dir := t.TempDir()
	r := &recentList{file: filepath.Join(dir, "config", "recent.json")}
	a, b := filepath.Join(dir, "a.raya"), filepath.Join(dir, "b.raya")
	for _, p := range []string{a, b} {
		os.WriteFile(p, []byte("{}"), 0o644)
	}

	r.add(a)
	r.add(b)
	r.add(a)
	list := r.existing()
	if len(list) != 2 || list[0].Path != a || list[1].Path != b {
		t.Fatalf("got %+v", list)
	}

	os.Remove(b)
	if list := r.existing(); len(list) != 1 || list[0].Name != "a" {
		t.Errorf("missing file still listed: %+v", list)
	}
}

func TestNewAppOpensARayaFileGivenOnTheCommandLine(t *testing.T) {
	app := NewApp([]string{"--flag", "Notes.raya"})
	if filepath.Base(app.StartupFile()) != "Notes.raya" {
		t.Error("startup file not taken from the arguments")
	}
	if app.StartupFile() != "" {
		t.Error("startup file given twice")
	}
}

func TestOpeningADocumentAddsItToTheRecentList(t *testing.T) {
	config := t.TempDir()
	t.Setenv("APPDATA", config)         // Windows
	t.Setenv("XDG_CONFIG_HOME", config) // Linux
	t.Setenv("HOME", config)            // macOS
	path := filepath.Join(t.TempDir(), "Notes.raya")
	if err := writeDocument(path, json.RawMessage(`[{"insert":"\n"}]`)); err != nil {
		t.Fatal(err)
	}

	app := NewApp(nil)
	if _, err := app.Open(path); err != nil {
		t.Fatal(err)
	}
	if list := app.RecentFiles(); len(list) != 1 || list[0].Path != path {
		t.Errorf("got %+v", list)
	}
}
