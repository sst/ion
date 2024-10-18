package tunnel

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"github.com/xjasonlyu/tun2socks/v2/engine"

	"github.com/sst/ion/internal/util"
)

var BINARY_PATH = "/opt/sst/sst" + "1"

func NeedsInstall() bool {
	if _, err := os.Stat(BINARY_PATH); err == nil {
		return false
	}
	return true
}

func Install() error {
	sourcePath, err := os.Executable()
	if err != nil {
		return err
	}
	os.RemoveAll(filepath.Dir(BINARY_PATH))
	os.MkdirAll(filepath.Dir(BINARY_PATH), 0755)
	sourceFile, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer sourceFile.Close()
	destFile, err := os.Create(BINARY_PATH)
	if err != nil {
		return err
	}
	defer destFile.Close()
	_, err = io.Copy(destFile, sourceFile)
	if err != nil {
		return err
	}
	err = os.Chmod(BINARY_PATH, 0755)
	user := os.Getenv("SUDO_USER")
	sudoersPath := "/etc/sudoers.d/sst-" + user
	slog.Info("creating sudoers file", "path", sudoersPath)
	command := BINARY_PATH + " tunnel start *"
	sudoersEntry := fmt.Sprintf("%s ALL=(ALL) NOPASSWD:SETENV: %s\n", user, command)
	slog.Info("sudoers entry", "entry", sudoersEntry)
	err = os.WriteFile(sudoersPath, []byte(sudoersEntry), 0440)
	if err != nil {
		return err
	}
	var cmd *exec.Cmd
	if runtime.GOOS == "darwin" {
		cmd = exec.Command("visudo", "-cf", sudoersPath)
	} else {
		cmd = exec.Command("visudo", "-c", "-f", sudoersPath)
	}
	slog.Info("running visudo", "cmd", cmd.Args)
	err = cmd.Run()
	if err != nil {
		slog.Error("failed to run visudo", "error", err)
		os.Remove(sudoersPath)
		return util.NewReadableError(err, "Error validating sudoers file")
	}
	return nil
}

func runCommands(cmds [][]string) error {
	for _, item := range cmds {
		slog.Info("running command", "command", item)
		cmd := exec.Command(item[0], item[1:]...)
		err := cmd.Run()
		if err != nil {
			slog.Error("failed to execute command", "command", item, "error", err)
			return fmt.Errorf("failed to execute command '%v': %v", item, err)
		}
	}
	return nil
}

func tun2socks(name string) {
	key := new(engine.Key)
	key.Device = name
	key.Proxy = "socks5://127.0.0.1:1080"
	engine.Insert(key)
	engine.Start()
}

func Stop() {
	engine.Stop()
	destroy()
}
