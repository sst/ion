package provider

import (
	"fmt"

	"github.com/sst/ion/internal/util"
)

type GenericProvider struct {
	key  string
	args map[string]interface{}
	env  map[string]string
}

func (p *GenericProvider) Init(key string, args map[string]interface{}) (err error) {
	p.key = key
	p.args = args
	p.env = map[string]string{}
	return nil
}

func (p *GenericProvider) Key() string {
	return p.key
}

func (p *GenericProvider) Env() (map[string]string, error) {
	return nil, nil
}

func (p *GenericProvider) AsHome(app, stage string) (Home, error) {
	return nil, util.NewReadableError(nil, fmt.Sprintf("\"%s\" is not a valid \"home\"", p.key))
}
