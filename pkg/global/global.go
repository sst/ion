package global

import (
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
)

var configDir = (func() string {
	home, err := os.UserConfigDir()
	if err != nil {
		panic(err)
	}
	return filepath.Join(home, "sst")
}())

func ConfigDir() string {
	return configDir
}

var packageManager = ""

func SetPackageManager(pm string) {
	packageManager = pm
}

func PackageManager() string {
	if packageManager == "" {
		packageManager = getPackageManager()
	}
	return packageManager
}

func getPackageManager() string {
	packageManagers := []string{
		"pnpm",
		"yarn",
		"npm",
	}

	for _, pm := range packageManagers {
		if _, err := exec.LookPath(pm); err == nil {
			return pm
		}
	}

	return "npm"
}

func NeedsPlugins() bool {
	files, err := os.ReadDir(filepath.Join(configDir, "plugins"))
	if err != nil {
		return true
	}
	slog.Info("plugins", "files", files)

	if len(files) == 0 {
		return true
	}

	return false
}

func InstallPlugins() error {
	slog.Info("installing plugins")
	cmd := exec.Command("pulumi", "plugin", "install", "resource", "aws")
	cmd.Env = append(os.Environ(), "PULUMI_HOME="+configDir)
	return cmd.Run()
}
