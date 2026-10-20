# Raya desktop

Raya as a desktop app for documents on your own computer. It works fully offline: there are no
accounts, no server and no syncing. Each document is a `.raya` file you open and save, and you can
export any document to Word.

It is built with [Wails](https://wails.io) v2. A Go backend handles files and native dialogs, and a
Svelte frontend runs in the system webview (WebView2 on Windows).

## How it relates to the web app

This folder is separate from the web app. It has its own Go module, `package.json`, Vite, Svelte and
Tailwind configs, and its own dependencies. The only thing it shares is the editor source in
`frontend/src/lib`, imported as `$lib`:

- `quill_setup.js`: Raya's Quill editor, with its formats, shortcuts, paste rules and heading spacing
- `text_styles.js`, `table.js`, `page_break.js`, `outline.js`, `format_rules.js`: editor features
- `export_docx.js`: Word export
- `styles/quill-editor.css`: the editor's look

None of the web app's server, sync or sign-in code is used. The shared files get their packages
(Quill, docx and so on) from this folder's `node_modules`, so the web app doesn't need to be installed.

## Files

A `.raya` file is JSON holding the document as Quill ops:

```json
{ "format": "raya", "version": 1, "autosave": true, "ops": [{ "insert": "Hello\n" }] }
```

`autosave` is the document's own setting, switched with the Autosave toggle in the header. It's kept
in the file, so it moves and copies with the document, and it's left out when off. With autosave on,
the document saves a second after you stop typing, and at least every 10 seconds while you keep
typing. Leaving the document or closing the window saves the last changes without asking. If an
autosave fails, the header says so and the next edit tries again.

Saving writes a temporary file next to the document and then renames it over the old one, so a crash
doesn't leave a half-written file. In folders that can't rename files into place (some redirected or
synced folders), it writes the file directly instead. The recent-files list is stored in `%AppData%\Raya\recent.json`
(`~/Library/Application Support/Raya` on macOS, `~/.config/Raya` on Linux).

## Developing

You need Go 1.25+, Node 20+ and the Wails CLI:

```sh
go install github.com/wailsapp/wails/v2/cmd/wails@v2.17.0
```

Run these from this folder:

```sh
wails dev        # app window with hot reload; also on http://localhost:34115 in a browser
wails build      # build/bin/Raya.exe
go test ./...    # file format, saving and recent-files tests
cd frontend && npm run check
```

`wails build -nsis` also builds a Windows installer, if [NSIS](https://wails.io/docs/guides/windows-installer/)
is installed. The app icon is generated from `build/appicon.png`.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| Ctrl+N | New document |
| Ctrl+O | Open |
| Ctrl+S | Save |
| Ctrl+Shift+S | Save as |
| Ctrl+Enter | Page break |
| Ctrl+click | Open a link in the browser |
