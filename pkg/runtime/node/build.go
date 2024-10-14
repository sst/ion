package node

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"

	esbuild "github.com/evanw/esbuild/pkg/api"
	"github.com/sst/ion/internal/fs"
	"github.com/sst/ion/pkg/js"
	"github.com/sst/ion/pkg/project/path"
	"github.com/sst/ion/pkg/runtime"
)

var forceExternal = []string{
	"sharp", "pg-native",
}

func (r *Runtime) Build(ctx context.Context, input *runtime.BuildInput) (*runtime.BuildOutput, error) {
	r.concurrency.Acquire(ctx, 1)
	defer r.concurrency.Release(1)
	var properties NodeProperties
	json.Unmarshal(input.Properties, &properties)

	file, ok := r.getFile(input)
	if !ok {
		return nil, fmt.Errorf("Handler not found: %v", input.Handler)
	}

	isESM := true
	extension := ".mjs"

	if properties.Format == "cjs" {
		isESM = false
		extension = ".cjs"
	}

	rel, err := filepath.Rel(path.ResolveRootDir(input.CfgPath), file)
	if err != nil {
		return nil, err
	}

	fileName := strings.TrimSuffix(filepath.Base(rel), filepath.Ext(rel))
	// Lambda handler can only contain 1 dot separating the file name and function name
	fileName = strings.ReplaceAll(fileName, ".", "-")
	folder := filepath.Dir(rel)
	path := filepath.Join(folder, fileName)
	handler := path + filepath.Ext(input.Handler)
	target := filepath.Join(input.Out(), path+extension)
	slog.Info("loader info", "loader", properties.Loader)

	loader := map[string]esbuild.Loader{}
	for key, value := range properties.Loader {
		mapped, ok := loaderMap[value]
		if !ok {
			continue
		}
		loader[key] = mapped
	}

	plugins := []esbuild.Plugin{}
	if properties.Plugins != "" {
		plugins = append(plugins, plugin(properties.Plugins))
	}
	external := append(forceExternal, properties.Install...)
	external = append(external, properties.ESBuild.External...)
	if err != nil {
		return nil, err
	}
	options := esbuild.BuildOptions{
		EntryPoints: []string{file},
		Platform:    esbuild.PlatformNode,
		External:    external,
		Loader:      loader,
		KeepNames:   true,
		Bundle:      true,
		Splitting:   properties.Splitting,
		Metafile:    true,
		Outfile:     target,
		Plugins:     plugins,
		Sourcemap:   esbuild.SourceMapLinked,
		Write:       true,
		Format:      esbuild.FormatESModule,
		Target:      esbuild.ESNext,
		MainFields:  []string{"module", "main"},
		Banner: map[string]string{
			"js": strings.Join([]string{
				`import { createRequire as topLevelCreateRequire } from 'module';`,
				`const require = topLevelCreateRequire(import.meta.url);`,
				`import { fileURLToPath as topLevelFileUrlToPath, URL as topLevelURL } from "url"`,
				`const __filename = topLevelFileUrlToPath(import.meta.url)`,
				`const __dirname = topLevelFileUrlToPath(new topLevelURL(".", import.meta.url))`,
				properties.Banner,
			}, "\n"),
		},
	}

	if !isESM {
		options.Format = esbuild.FormatCommonJS
		options.Target = esbuild.ESNext
		options.MainFields = []string{"main"}
	}

	if properties.ESBuild.Target != 0 {
		options.Target = properties.ESBuild.Target
	}

	if properties.Splitting {
		options.Outdir = filepath.Dir(target)
		options.OutExtension = map[string]string{
			".js": ".mjs",
		}
		options.Outfile = ""
	}

	if !input.Dev {
		if properties.Minify {
			options.MinifyWhitespace = properties.Minify
			options.MinifySyntax = properties.Minify
			options.MinifyIdentifiers = properties.Minify
		}
		if !properties.SourceMap {
			options.Sourcemap = esbuild.SourceMapNone
		}
	}

	if properties.ESBuild.Target != 0 {
		options.Target = properties.ESBuild.Target
	}

	buildContext, ok := r.contexts.Load(input.FunctionID)
	if !ok {
		buildContext, _ = esbuild.Context(options)
		r.contexts.Store(input.FunctionID, buildContext)
	}

	result := buildContext.(esbuild.BuildContext).Rebuild()
	r.results.Store(input.FunctionID, result)
	errors := []string{}
	for _, error := range result.Errors {
		text := error.Text
		if error.Location != nil {
			text = text + " " + error.Location.File + ":" + fmt.Sprint(error.Location.Line) + ":" + fmt.Sprint(error.Location.Column)
		}
		errors = append(errors, text)
	}
	for _, error := range result.Errors {
		slog.Error("esbuild error", "error", error)
	}
	for _, warning := range result.Warnings {
		slog.Error("esbuild error", "error", warning)
	}

	if input.Dev {
		nodeModules, err := fs.FindUp(file, "node_modules")
		if err == nil {
			os.Symlink(nodeModules, filepath.Join(input.Out(), "node_modules"))
		}
	}

	if !input.Dev {
		var metafile js.Metafile
		json.Unmarshal([]byte(result.Metafile), &metafile)

		installPackages := properties.Install
		for _, pkg := range forceExternal {
			if slices.Contains(properties.ESBuild.External, pkg) {
				continue
			}
			for _, input := range metafile.Inputs {
				for _, imp := range input.Imports {
					if imp.Kind == "external" && imp.Path == pkg {
						installPackages = append(installPackages, pkg)
					}
				}
			}
		}

		if len(installPackages) > 0 {
			src, err := fs.FindUp(filepath.Dir(target), "package.json")
			if err != nil {
				return nil, err
			}
			file, err := os.Open(src)
			if err != nil {
				return nil, err
			}
			defer file.Close()
			var parsed js.PackageJson
			err = json.NewDecoder(file).Decode(&parsed)
			if err != nil {
				return nil, err
			}
			dependencies := map[string]string{}
			for _, pkg := range installPackages {
				dependencies[pkg] = "*"
				if parsed.Dependencies[pkg] != "" {
					dependencies[pkg] = parsed.Dependencies[pkg]
				}
			}
			outPkg := filepath.Join(input.Out(), "package.json")
			outFile, err := os.Create(outPkg)
			if err != nil {
				return nil, err
			}
			json.NewEncoder(outFile).Encode(map[string]interface{}{
				"dependencies": dependencies,
			})
			outFile.Close()

			cmd := []string{
				"install",
				"--force",
				"--platform=linux",
				"--os=linux",
				"--arch=x64",
				"--cpu=x64",
			}
			if properties.Architecture == "arm64" {
				cmd[4] = "--arch=arm64"
				cmd[5] = "--cpu=arm64"
			}
			if slices.Contains(installPackages, "sharp") {
				cmd = append(cmd, "--libc=glibc")
			}
			proc := exec.Command("npm", cmd...)
			proc.Dir = input.Out()
			err = proc.Run()
			if err != nil {
				return nil, err
			}
		}
	}

	return &runtime.BuildOutput{
		Handler: handler,
		Errors:  errors,
	}, nil
}
