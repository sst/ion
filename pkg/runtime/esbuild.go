package runtime

import (
	esbuild "github.com/evanw/esbuild/pkg/api"
)

func mergeEsbuildOverrides(o *esbuild.BuildOptions, overrides *esbuild.BuildOptions) {
	if overrides.Target != 0 {
		o.Target = overrides.Target
	}
	if len(overrides.Supported) > 0 {
		for key, value := range overrides.Supported {
			o.Supported[key] = value
		}
	}
}
