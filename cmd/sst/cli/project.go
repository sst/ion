package cli

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/briandowns/spinner"
	"github.com/joho/godotenv"
	"github.com/sst/ion/internal/util"
	"github.com/sst/ion/pkg/project"
)

var logFile = (func() *os.File {
	logFile, err := os.CreateTemp("", "sst-*.log")
	if err != nil {
		panic(err)
	}
	return logFile
})()

func (c *Cli) InitProject() (*project.Project, error) {
	slog.Info("initializing project", "version", c.version)

	cfgPath, err := project.Discover()
	if err != nil {
		return nil, util.NewReadableError(err, "Could not find sst.config.ts")
	}

	stage, err := c.Stage(cfgPath)
	if err != nil {
		return nil, util.NewReadableError(err, "Could not find stage")
	}

	p, err := project.New(&project.ProjectConfig{
		Version: c.version,
		Stage:   stage,
		Config:  cfgPath,
	})
	if err != nil {
		return nil, err
	}
	godotenv.Load(filepath.Join(p.PathRoot(), ".env"))

	_, err = logFile.Seek(0, 0)
	if err != nil {
		return nil, err
	}
	nextLogFile, err := os.Create(filepath.Join(p.PathWorkingDir(), "sst.log"))
	if err != nil {
		return nil, util.NewReadableError(err, "Could not create log file")
	}
	_, err = io.Copy(nextLogFile, logFile)
	if err != nil {
		return nil, util.NewReadableError(err, "Could not copy log file")
	}
	logFile = nextLogFile
	c.configureLog()

	spin := spinner.New(spinner.CharSets[14], 100*time.Millisecond)
	defer spin.Stop()
	if !p.CheckPlatform(c.version) {
		spin.Suffix = "  Upgrading project..."
		spin.Start()
		err := p.CopyPlatform(c.version)
		if err != nil {
			return nil, util.NewReadableError(err, "Could not copy platform code to project directory")
		}
	}

	if p.NeedsInstall() {
		spin.Suffix = "  Installing providers..."
		spin.Start()
		err = p.Install()
		if err != nil {
			return nil, util.NewReadableError(err, "Could not install dependencies")
		}
	}

	if err := p.LoadHome(); err != nil {
		return nil, util.NewReadableError(err, err.Error())
	}

	app := p.App()
	slog.Info("loaded config", "app", app.Name, "stage", app.Stage)

	c.configureLog()
	return p, nil
}

func (c *Cli) configureLog() {
	writers := []io.Writer{logFile}
	if c.Bool("verbose") {
		writers = append(writers, os.Stderr)
	}
	writer := io.MultiWriter(writers...)
	slog.SetDefault(
		slog.New(slog.NewTextHandler(writer, &slog.HandlerOptions{
			Level: slog.LevelInfo,
		})),
	)
}
