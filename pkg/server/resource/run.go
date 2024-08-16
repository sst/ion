package resource

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"

	"github.com/sst/ion/cmd/sst/mosaic/ui/common"
	"github.com/sst/ion/pkg/bus"
	"golang.org/x/sync/semaphore"
)

// Semaphore to limit concurrent executions
type Run struct {
	lock *semaphore.Weighted
}

type RunInputs struct {
	Command string            `json:"command"`
	Cwd     string            `json:"cwd"`
	Env     map[string]string `json:"env"`
	Version string            `json:"version"`
}

type RunOutputs struct {
}

func NewRun() *Run {
	return &Run{
		lock: semaphore.NewWeighted(4),
	}
}

func (r *Run) Create(input *RunInputs, output *CreateResult[RunOutputs]) error {
	err := r.executeCommand(input)
	if err != nil {
		return err
	}

	*output = CreateResult[RunOutputs]{
		ID:   "run",
		Outs: RunOutputs{},
	}
	return nil
}

func (r *Run) Update(input *UpdateInput[RunInputs, RunOutputs], output *UpdateResult[RunOutputs]) error {
	err := r.executeCommand(&input.News)
	if err != nil {
		return err
	}

	*output = UpdateResult[RunOutputs]{
		Outs: RunOutputs{},
	}
	return nil
}

func (r *Run) executeCommand(input *RunInputs) error {
	r.lock.Acquire(context.Background(), 1)
	defer r.lock.Release(1)
	cmd := exec.Command("sh", "-c", input.Command)
	cmd.Dir = input.Cwd
	cmd.Env = os.Environ()
	if len(input.Env) > 0 {
		for key, value := range input.Env {
			cmd.Env = append(cmd.Env, key+"="+value)
		}
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	reader := io.MultiReader(stdout, stderr)
	err = cmd.Start()
	if err != nil {
		return err
	}
	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		bus.Publish(&common.StdoutEvent{Line: scanner.Text()})
	}
	cmd.Wait()
	if cmd.ProcessState.ExitCode() > 0 {
		return fmt.Errorf("command exited with code %d", cmd.ProcessState.ExitCode())
	}
	return nil
}

