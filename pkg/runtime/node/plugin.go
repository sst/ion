package node

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/evanw/esbuild/pkg/api"
)

type NodeLoadResult struct {
	Contents   string   `json:"contents"`
	Loader     string   `json:"loader"`
	PluginData any      `json:"pluginData"`
	PluginName string   `json:"pluginName"`
	Errors     []string `json:"errors"`
	Warnings   []string `json:"warnings"`
}

func plugin(path string) api.Plugin {
	cwd, _ := os.Getwd()
	path = filepath.Join(cwd, path)
	return api.Plugin{
		Name: "nodejs-plugin",
		Setup: func(build api.PluginBuild) {
			slog.Info("nodejs plugin", "path", path)
			cmd := exec.Command("node", ".sst/platform/functions/nodejs-runtime/plugin.mjs", path)
			stdin, err := cmd.StdinPipe()
			if err != nil {
				return
			}
			stdout, err := cmd.StdoutPipe()
			if err != nil {
				return
			}
			if err := cmd.Start(); err != nil {
				return
			}
			build.OnResolve(api.OnResolveOptions{Filter: ".*"}, func(args api.OnResolveArgs) (api.OnResolveResult, error) {
				request := map[string]interface{}{
					"type":      "resolve",
					"path":      args.Path,
					"importer":  args.Importer,
					"namespace": args.Namespace,
				}
				if err := json.NewEncoder(stdin).Encode(request); err != nil {
					return api.OnResolveResult{}, fmt.Errorf("error sending resolve request: %w", err)
				}
				var result api.OnResolveResult
				if err := json.NewDecoder(stdout).Decode(&result); err != nil {
					return api.OnResolveResult{}, fmt.Errorf("error reading resolve response: %w", err)
				}
				return result, nil
			})
			build.OnLoad(api.OnLoadOptions{Filter: ".*"}, func(args api.OnLoadArgs) (api.OnLoadResult, error) {
				request := map[string]interface{}{
					"type":      "load",
					"path":      args.Path,
					"namespace": args.Namespace,
				}
				if err := json.NewEncoder(stdin).Encode(request); err != nil {
					return api.OnLoadResult{}, fmt.Errorf("error sending load request: %w", err)
				}
				var nodeResult NodeLoadResult
				if err := json.NewDecoder(stdout).Decode(&nodeResult); err != nil {
					return api.OnLoadResult{}, fmt.Errorf("error reading load response: %w", err)
				}
				result := api.OnLoadResult{
					Contents:   &nodeResult.Contents,
					PluginData: nodeResult.PluginData,
					PluginName: nodeResult.PluginName,
				}
				if loader, ok := loaderMap[nodeResult.Loader]; ok {
					result.Loader = loader
				} else {
					result.Loader = api.LoaderDefault
				}
				for _, errStr := range nodeResult.Errors {
					result.Errors = append(result.Errors, api.Message{Text: errStr})
				}
				for _, warnStr := range nodeResult.Warnings {
					result.Warnings = append(result.Warnings, api.Message{Text: warnStr})
				}
				return result, nil
			})
			build.OnDispose(func() {
				stdin.Close()
				stdout.Close()
				cmd.Process.Kill()
			})
		},
	}

}
