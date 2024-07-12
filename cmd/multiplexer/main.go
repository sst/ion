package main

import (
	"log"
	"os"

	"github.com/sst/ion/cmd/sst/mosaic/multiplexer"
)

func main() {
	file, _ := os.Create("log.txt")
	log.SetOutput(file)
	multi, _ := multiplexer.New()
	multi.AddPane("shell", []string{"zsh"}, "shell", "", true)
	multi.AddPane("shell2", []string{"zsh"}, "shell", "", true)
	multi.Start()
}
