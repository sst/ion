package resource

import (
	"context"
	"os"
	"os/exec"

	"golang.org/x/sync/semaphore"
)

// Semaphore to limit concurrent executions
type Run struct {
	executionSemaphore *semaphore.Weighted
}

type RunInputs struct {
	Command string 						`json:"command"`
	Cwd     string 					  `json:"cwd"`
	Env     map[string]string `json:"env"`
	Version	string						`json:"version"`
}

type RunOutputs struct {
}

func NewRun() *Run {
	// Make a channel with a buffer size of 4 and fill it
	return &Run{
		executionSemaphore: semaphore.NewWeighted(4),
	}
}

func (r *Run) Create(input *RunInputs, output *CreateResult[RunOutputs]) error {
	err := r.executeCommand(input)
	if err != nil {
		return err
	}

	*output = CreateResult[RunOutputs]{
		ID: "run",
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
	r.executionSemaphore.Acquire(context.Background(), 1)
	defer r.executionSemaphore.Release(1)

	cmd := exec.Command("sh", "-c", input.Command)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Dir = input.Cwd
	
	// Set environment variables
	if len(input.Env) > 0 {
		cmd.Env = os.Environ() // Start with current environment
		for key, value := range input.Env {
			cmd.Env = append(cmd.Env, key+"="+value)
		}
	}
	
	// Execute the command
	return cmd.Run()
}