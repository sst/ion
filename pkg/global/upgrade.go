package global

import (
	"archive/tar"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

func Upgrade(existingVersion string, nextVersion string) (string, error) {
	var filename string
	switch runtime.GOOS {
	case "darwin":
		filename = "mac-"
	case "windows":
		filename = "windows-"
	default:
		filename = "linux-"
	}

	switch runtime.GOARCH {
	case "amd64":
		filename += "x86_64.tar.gz"
	case "arm64":
		filename += "arm64.tar.gz"
	case "386":
		filename += "i386.tar.gz"
	default:
		return "", fmt.Errorf("unsupported architecture")
	}
	if nextVersion == "" {
		resp, err := http.Get("https://api.github.com/repos/sst/ion/releases/latest")
		if err != nil {
			return "", err
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return "", err
		}

		var releaseInfo struct {
			TagName string `json:"tag_name"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&releaseInfo); err != nil {
			return "", err
		}
		nextVersion = releaseInfo.TagName
	}
	if !strings.HasPrefix(nextVersion, "v") {
		nextVersion = "v" + nextVersion
	}
	if !strings.HasPrefix(existingVersion, "v") {
		existingVersion = "v" + existingVersion
	}
	if nextVersion == existingVersion {
		return nextVersion, nil
	}
	url := "https://github.com/sst/ion/releases/download/" + nextVersion + "/sst-" + filename
	slog.Info("downloading", "url", url)
	resp, err := http.Get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("unexpected HTTP status when downloading release: %s", resp.Status)
	}

	tmpReleaseDir, err := os.MkdirTemp("", "sst")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(tmpReleaseDir)

	// Assuming we have a variable `resp` which is the response from a *http.Request
	body, err := gzip.NewReader(resp.Body)
	if err != nil {
		return "", err
	}
	defer body.Close()

	if err := untar(body, tmpReleaseDir); err != nil {
		return "", err
	}

	binHome := os.Getenv("XDG_BIN_HOME")
	if binHome == "" {
		// Default to ~/.local/bin if $XDG_BIN_HOME not set
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		binHome = filepath.Join(homeDir, ".local", "bin")
	}
	if err := os.MkdirAll(binHome, os.ModePerm); err != nil {
		return "", err
	}
	sstBinPath := filepath.Join(binHome, "sst")

	if err := os.Rename(filepath.Join(tmpReleaseDir, "sst"), sstBinPath); err != nil {
		return "", err
	}

	if err := os.Chmod(sstBinPath, 0755); err != nil {
		return "", err
	}

	return nextVersion, nil
}

func untar(reader io.Reader, target string) error {
	tarReader := tar.NewReader(reader)
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break // End of tarball
		}
		if err != nil {
			return err
		}
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(filepath.Join(target, header.Name), 0755); err != nil {
				return err
			}
		case tar.TypeReg:
			outPath := filepath.Join(target, filepath.Base(header.Name))
			outFile, err := os.Create(outPath)
			if err != nil {
				return err
			}
			if _, err := io.Copy(outFile, tarReader); err != nil {
				outFile.Close()
				return err
			}
			outFile.Close()

			err = os.Chmod(outPath, 0755)
			if err != nil {
				return err
			}

		}
	}
	return nil
}
