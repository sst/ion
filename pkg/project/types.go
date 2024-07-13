package project

import (
	"sort"
	"strings"
)

type literal struct {
	value string
}

func inferTypes(input map[string]interface{}, indentArgs ...string) string {
	indent := ""
	if len(indentArgs) > 0 {
		indent = indentArgs[0]
	}
	var builder strings.Builder
	builder.WriteString("{")
	builder.WriteString("\n")
	keys := make([]string, 0, len(input))
	for key := range input {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		value := input[key]
		builder.WriteString(indent + "  " + key + ": ")
		if key == "type" && len(indentArgs) == 1 {
			builder.WriteString("\"")
			builder.WriteString(value.(string))
			builder.WriteString("\"")
		} else {
			switch v := value.(type) {
			case literal:
				builder.WriteString(v.value)
			case string:
				builder.WriteString("string")
			case int:
				builder.WriteString("number")
			case float64:
				builder.WriteString("number")
			case float32:
				builder.WriteString("number")
			case bool:
				builder.WriteString("boolean")
			case map[string]interface{}:
				builder.WriteString(inferTypes(value.(map[string]interface{}), indent+"  "))
			}
		}
		builder.WriteString("\n")
	}
	builder.WriteString(indent + "}")
	return builder.String()
}
