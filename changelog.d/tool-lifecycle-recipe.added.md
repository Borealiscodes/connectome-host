- Recipes and `mcpl-servers.json` can grant an MCPL server MCPL tool-lifecycle
  observation (RFC-007) with a `toolLifecycle` block on its entry
  (`observe`, `inputs`, optional `tools` / `classes` / `conversations`
  narrowing, `maxInputBytes`). The block is validated at load: an
  "off-looking" value such as `observe: false` is an error, not a grant.
  `toolLifecycle` is also a recipe-overridable field for servers taken from
  `mcpl-servers.json`, which previously dropped it.
- Recipes can set `toolClassOverrides` (tool-name pattern → RFC-008 classes)
  to class third-party MCP tools. The host now passes the classes of its
  own module tools (`HOST_TOOL_CLASSES`) to the framework. Both need an
  agent-framework release that includes tool lifecycle (#199); older
  frameworks ignore them.
