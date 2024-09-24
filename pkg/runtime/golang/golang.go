package golang

import (
	"context"
	"log/slog"
	"os/exec"
	"path/filepath"

	"github.com/sst/ion/pkg/project/path"
	"github.com/sst/ion/pkg/runtime"
)

type Runtime struct {
}

func New() *Runtime {
	return &Runtime{}
}

func (r *Runtime) Match(runtime string) bool {
	return runtime == "golang"
}

func (r *Runtime) Build(ctx context.Context, input *runtime.BuildInput) (*runtime.BuildOutput, error) {
	slog.Info("golang build", "cfg", path.ResolveRootDir(input.CfgPath))
	args := []string{
		"build",
		"-o",
		filepath.Join(input.Out(), "bootstrap"),
	}
	args = append(args, filepath.Join(path.ResolveRootDir(input.CfgPath), input.Handler))
	slog.Info("golang build", "path", filepath.Join(path.ResolveRootDir(input.CfgPath), input.Handler))
	cmd := exec.Command("go", args...)
	if !input.Dev {
		cmd.Env = append(cmd.Env, "GOOS=linux", "GOARCH=amd64")
		if input.Architecture == "arm64" {
			cmd.Env = append(cmd.Env, "GOARCH=arm64")
		}
	}
	output, err := cmd.CombinedOutput()
	slog.Info("golang build output", "output", string(output))
	if err != nil {
		return &runtime.BuildOutput{
			Errors: []string{string(output)},
		}, nil
	}
	return &runtime.BuildOutput{
		Errors:  []string{},
		Out:     input.Out(),
		Handler: "bootstrap",
	}, nil
}

func (r *Runtime) Run(ctx context.Context, input *runtime.RunInput) (runtime.Worker, error) {
	cmd := exec.CommandContext(ctx, filepath.Join(input.Build.Out, "bootstrap"))
	cmd.Env = input.Env
	cmd.Env = append(
		cmd.Env,
		"AWS_LAMBDA_RUNTIME_API="+input.Server,
	)
	cmd.Dir = input.Build.Out
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	cmd.Start()
	return &runtime.ProcessWorker{
		Out: stdout,
		Err: stderr,
		Cmd: cmd,
	}, nil
}

func (r *Runtime) ShouldRebuild(functionID string, file string) bool {
	return true
}
