- README documents `enabledFeatureSets` (omitted = every declared set; `[]` in
  a recipe or `mcpl-servers.json` = none, while the agent's overlay file reads
  `[]` as unset; a set without valid `uses` stays disabled) and model-facing
  MCPL tool names (`mcpl--<serverId>--<tool>`). The `toolClassOverrides`
  examples now use that form; `cua--*` and `blender--*` matched nothing.
