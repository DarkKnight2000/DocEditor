package main

import (
	"embed"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

// the built frontend (desktop/frontend/dist), served from inside the app with no network
//
//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp(os.Args[1:])

	err := wails.Run(&options.App{
		Title:     "Raya",
		Width:     1200,
		Height:    840,
		MinWidth:  640,
		MinHeight: 480,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 255, G: 255, B: 255, A: 1},
		// the webview's own menu gives cut, copy, paste and spelling suggestions in the editor
		EnableDefaultContextMenu: true,
		OnStartup:                app.startup,
		OnBeforeClose:            app.beforeClose,
		Bind: []interface{}{
			app,
		},
	})
	if err != nil {
		println("Error:", err.Error())
	}
}
