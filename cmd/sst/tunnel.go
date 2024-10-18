package main

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"os/user"
	"strings"

	"github.com/sst/ion/cmd/sst/cli"
	"github.com/sst/ion/cmd/sst/mosaic/ui"
	"github.com/sst/ion/internal/util"
	"github.com/sst/ion/pkg/project"
	"github.com/sst/ion/pkg/tunnel"
	"golang.org/x/sync/errgroup"
)

var CmdTunnel = &cli.Command{
	Name: "tunnel",
	Description: cli.Description{
		Short: "Start a tunnel",
		Long: strings.Join([]string{
			"Start a tunnel.",
			"",
			"```bash frame=\"none\"",
			"sst tunnel",
			"```",
			"",
			"If your app has a VPC with `bastion` enabled, you can use this to connect to it.",
			"This will forward traffic from the following ranges over SSH:",
			"- `10.0.4.0/22`",
			"- `10.0.12.0/22`",
			"- `10.0.0.0/22`",
			"- `10.0.8.0/22`",
			"",
			"The tunnel allows your local machine to access resources that are in the VPC.",
			"",
			":::note",
			"The tunnel is only available for apps that have a VPC with `bastion` enabled.",
			":::",
			"",
			"If you are running `sst dev`, this tunnel will be started automatically under the",
			"_Tunnel_ tab in the sidebar.",
			"",
			":::tip",
			"This is automatically started when you run `sst dev`.",
			":::",
			"",
			"You can start this manually if you want to connect to a different stage.",
			"",
			"```bash frame=\"none\"",
			"sst tunnel --stage production",
			"```",
			"",
			"This needs a network interface on your local machine. You can create this",
			"with the `sst tunnel install` command.",
		}, "\n"),
	},
	Run: func(c *cli.Cli) error {
		if tunnel.NeedsInstall() {
			return util.NewReadableError(nil, "The sst tunnel needs to be installed or upgraded. Run `sudo sst tunnel install`")
		}
		proj, err := c.InitProject()
		if err != nil {
			return err
		}
		state, err := proj.GetCompleted(c.Context)
		if err != nil {
			return err
		}
		if len(state.Tunnels) == 0 {
			return util.NewReadableError(nil, "No tunnels found for stage "+proj.App().Stage)
		}
		var tun project.Tunnel
		for _, item := range state.Tunnels {
			tun = item
		}
		subnets := strings.Join(tun.Subnets, ",")
		// run as root
		tunnelCmd := exec.CommandContext(
			c.Context,
			"sudo", "-n", "-E",
			tunnel.BINARY_PATH, "tunnel", "start",
			"--subnets", subnets,
			"--host", tun.IP,
			"--user", tun.Username,
			"--print-logs",
		)
		tunnelCmd.Env = append(
			os.Environ(),
			"SST_SKIP_LOCAL=true",
			"SST_SKIP_DEPENDENCY_CHECK=true",
			"SSH_PRIVATE_KEY="+tun.PrivateKey,
		)
		tunnelCmd.Stdout = os.Stdout
		util.SetProcessGroupID(tunnelCmd)
		util.SetProcessCancel(tunnelCmd)
		slog.Info("starting tunnel", "cmd", tunnelCmd.Args)
		fmt.Println(ui.TEXT_HIGHLIGHT_BOLD.Render("Tunnel"))
		fmt.Println()
		fmt.Print(ui.TEXT_HIGHLIGHT_BOLD.Render("➜"))
		fmt.Println(ui.TEXT_NORMAL.Render("  Forwarding ranges"))
		for _, subnet := range tun.Subnets {
			fmt.Println(ui.TEXT_DIM.Render("   " + subnet))
		}
		fmt.Println()
		fmt.Println(ui.TEXT_DIM.Render("Waiting for connections..."))
		fmt.Println()
		stderr, _ := tunnelCmd.StderrPipe()
		tunnelCmd.Start()
		output, _ := io.ReadAll(stderr)
		if strings.Contains(string(output), "password is required") {
			return util.NewReadableError(nil, "Make sure you have installed the tunnel with `sudo sst tunnel install`")
		}
		return nil
	},
	Children: []*cli.Command{
		{
			Name: "install",
			Description: cli.Description{
				Short: "Install the tunnel",
				Long: strings.Join([]string{
					"Install the tunnel.",
					"",
					"To be able to create a tunnel, SST needs to create a network interface on your local",
					"machine. This needs _sudo_ access.",
					"",
					"```bash \"sudo\"",
					"sudo sst tunnel install",
					"```",
					"",
					"You only need to run this once on your machine.",
				}, "\n"),
			},
			Run: func(c *cli.Cli) error {
				currentUser, err := user.Current()
				if err != nil {
					return err
				}
				if currentUser.Uid != "0" {
					return util.NewReadableError(nil, "You need to run this command as root")
				}
				err = tunnel.Install()
				if err != nil {
					return err
				}
				ui.Success("Tunnel installed successfully.")
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
			Hidden: true,
			Flags: []cli.Flag{
				{
					Name: "subnets",
					Type: "string",
					Description: cli.Description{
						Short: "The subnet to use for the tunnel",
						Long:  "The subnet to use for the tunnel",
					},
				},
				{
					Name: "host",
					Type: "string",
					Description: cli.Description{
						Short: "The host to use for the tunnel",
						Long:  "The host to use for the tunnel",
					},
				},
				{
					Name: "port",
					Type: "string",
					Description: cli.Description{
						Short: "The port to use for the tunnel",
						Long:  "The port to use for the tunnel",
					},
				},
				{
					Name: "user",
					Type: "string",
					Description: cli.Description{
						Short: "The user to use for the tunnel",
						Long:  "The user to use for the tunnel",
					},
				},
			},
			Run: func(c *cli.Cli) error {
				subnets := strings.Split(c.String("subnets"), ",")
				host := c.String("host")
				port := c.String("port")
				user := c.String("user")
				if port == "" {
					port = "22"
				}
				slog.Info("starting tunnel", "subnet", subnets, "host", host, "port", port)
				var wg errgroup.Group
				wg.Go(func() error {
					defer c.Cancel()
					return tunnel.StartProxy(
						c.Context,
						user,
						host+":"+port,
						[]byte(os.Getenv("SSH_PRIVATE_KEY")),
					)
				})
				err := tunnel.Start(subnets...)
				if err != nil {
					return err
				}
				slog.Info("tunnel started")
				<-c.Context.Done()
				tunnel.Stop()
				err = wg.Wait()
				if err != nil {
					slog.Error("failed to start tunnel", "error", err)
				}
				return nil
			},
		},
	},
}
