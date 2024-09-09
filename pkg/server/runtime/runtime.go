package runtime

import (
	"context"
	"net/rpc"

	"github.com/sst/ion/pkg/project"
	"github.com/sst/ion/pkg/runtime"
)

type Runtime struct {
	project *project.Project
}

func (r *Runtime) Build(input *runtime.BuildInput, output *runtime.BuildOutput) error {
	return nil
}

func (r *Runtime) AddTarget(input *runtime.BuildInput, output *bool) error {
	r.project.Runtime.AddTarget(input)
	*output = true
	return nil
}

func Register(ctx context.Context, p *project.Project, r *rpc.Server) error {
	r.RegisterName("Runtime", &Runtime{
		project: p,
	})
	return nil
}
