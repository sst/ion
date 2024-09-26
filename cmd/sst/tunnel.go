package main

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"os/user"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/armon/go-socks5"
	"github.com/songgao/water"
	"github.com/sst/ion/cmd/sst/cli"
	"github.com/sst/ion/cmd/sst/mosaic/ui"
	"github.com/sst/ion/internal/util"
	"github.com/vishvananda/netlink"
	"golang.org/x/crypto/ssh"
)

type WaterTun struct {
	*water.Interface
}

func (w *WaterTun) Name() (string, error) {
	return w.Interface.Name(), nil
}

func (w *WaterTun) File() *os.File {
	return nil
}

const (
	MTU = 1500
)

type connection struct {
	conn       net.Conn
	lastActive time.Time
}

var (
	connectionsMutex sync.Mutex
	connections      = make(map[string]*connection)
)

var CmdTunnel = &cli.Command{
	Name: "tunnel",
	Description: cli.Description{
		Short: "",
		Long:  strings.Join([]string{}, "\n"),
	},
	Children: []*cli.Command{
		{
			Name: "install",
			Description: cli.Description{
				Short: "Install the tunnel",
				Long: strings.Join([]string{
					"Install the tunnel.",
					"",
					"This will install the tunnel on your system.",
					"",
					"This is required for the tunnel to work.",
				}, "\n"),
			},
			Run: func(c *cli.Cli) error {
				// Get the current user
				currentUser, err := user.Current()
				if err != nil {
					return err
				}
				binary, err := os.Executable()
				if err != nil {
					return err
				}
				sudoersPath := "/etc/sudoers.d/sst"
				command := binary + " tunnel start"
				sudoersEntry := fmt.Sprintf("%s ALL=(ALL) NOPASSWD: %s\n", currentUser.Username, command)

				// Write the entry to the file
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
				cmd.Stdout = os.Stdout
				cmd.Stderr = os.Stderr
				err = cmd.Run()
				if err != nil {
					os.Remove(sudoersPath)
					return util.NewReadableError(err, "Error validating sudoers file")
				}

				ui.Success("Sudoers entry added successfully.")
				return nil
			},
		},
		{
			Name: "start",
			Description: cli.Description{
				Short: "Start the tunnel",
				Long: strings.Join([]string{
					"Start the tunnel.",
					"",
					"This will start the tunnel.",
					"",
					"This is required for the tunnel to work.",
				}, "\n"),
			},
			Run: func(c *cli.Cli) error {
				slog.Info("creating interface")
				iface, err := water.New(water.Config{
					DeviceType: water.TUN,
					PlatformSpecificParams: water.PlatformSpecificParams{
						Name:    "sst",
						Persist: true,
					},
				})
				if err != nil {
					return err
				}
				iface.Close()
				link, err := netlink.LinkByName(iface.Name())
				if err != nil {
					return err
				}
				slog.Info("bringing up interface")
				err = netlink.LinkSetUp(link)
				if err != nil {
					return err
				}
				slog.Info("assigning address")
				addr, err := netlink.ParseAddr("10.1.1.1/24")
				if err != nil {
					return err
				}
				err = netlink.AddrAdd(link, addr)
				if err != nil {
					return err
				}
				route := &netlink.Route{
					LinkIndex: link.Attrs().Index,
					Scope:     netlink.SCOPE_UNIVERSE,
					Dst: &net.IPNet{
						IP:   net.IPv4(10, 0, 0, 0),
						Mask: net.IPv4Mask(255, 0, 0, 0),
					},
					Gw: net.IPv4(0, 0, 0, 0),
				}
				netlink.RouteAdd(route)
				defer netlink.RouteDel(route)
				iface.Close()
				slog.Info("getting ssh key")
				key, err := os.ReadFile("/home/thdxr/.ssh/id_rsa")
				if err != nil {
					return err
				}
				signer, err := ssh.ParsePrivateKey(key)
				if err != nil {
					return err
				}
				// ssh -vvv -D 1080 -N ec2-user@54.89.220.51
				config := &ssh.ClientConfig{
					User: "ec2-user",
					Auth: []ssh.AuthMethod{
						ssh.PublicKeys(signer),
					},
					HostKeyCallback: ssh.InsecureIgnoreHostKey(),
				}
				sshClient, err := ssh.Dial("tcp", "54.89.220.51:22", config)
				if err != nil {
					return err
				}
				defer sshClient.Close()

				server, err := socks5.New(&socks5.Config{
					Dial: func(ctx context.Context, network, addr string) (net.Conn, error) {
						fmt.Println("Dialing", network, addr)
						// 50/50 random
						if true {
							return sshClient.Dial(network, addr)
						}
						return net.Dial(network, addr)
					},
				})
				if err != nil {
					return err
				}
				go server.ListenAndServe("tcp", fmt.Sprintf("%s:%d", "127.0.0.1", 1080))
				slog.Info("tunnel started")
				<-c.Context.Done()
				return nil
			},
		},
	},
}
