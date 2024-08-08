package resource

import (
	"os"
	"os/exec"
	"sync"
)

// Global semaphore to limit concurrent executions
var (
	maxConcurrentExecutions = 4
	executionSemaphore      = make(chan struct{}, maxConcurrentExecutions)
	once                    sync.Once
)

type Run struct {}

type RunInputs struct {
	Command string 						`json:"command"`
	Cwd     string 					  `json:"cwd"`
	Env     map[string]string `json:"env"`
	Version	string						`json:"version"`
}

type RunOutputs struct {
}

func (r *Run) Create(input *RunInputs, output *CreateResult[RunOutputs]) error {
	err := executeCommand(input)
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
	err := executeCommand(&input.News)
	if err != nil {
		return err
	}

	*output = UpdateResult[RunOutputs]{
		Outs: RunOutputs{},
	}
	return nil
}


func executeCommand(input *RunInputs) error {
	// Initialize the semaphore if it hasn't been already
	once.Do(func() {
		for i := 0; i < maxConcurrentExecutions; i++ {
			executionSemaphore <- struct{}{}
		}
	})
	
	// Acquire a semaphore slot
	<-executionSemaphore
	defer func() {
		// Release the semaphore slot when done
		executionSemaphore <- struct{}{}
	}()

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