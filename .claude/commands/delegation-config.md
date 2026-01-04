---
description: View and modify delegation settings at runtime
---

# Delegation Configuration Command

View current delegation configuration or modify settings. Changes persist to `.claude/delegation-config.json`.

## Syntax

```
/delegation-config                     # Show current config
/delegation-config --mode=<mode>       # Change mode
/delegation-config --threshold=<n>     # Change complexity threshold
/delegation-config --reset             # Reset to defaults
```

## Options

| Flag | Values | Default | Description |
|------|--------|---------|-------------|
| `--mode` | disabled, suggest, auto | suggest | Delegation behavior |
| `--threshold` | 20-80 | 35 | Min complexity score |
| `--subtasks` | 1-10 | 3 | Min subtasks to trigger |
| `--cache` | true/false | true | Enable caching |
| `--cache-ttl` | ms | 60000 | Cache TTL |
| `--hints` | true/false | true | Show hints |
| `--debug` | true/false | false | Debug mode |
| `--reset` | - | - | Reset to defaults |

## Mode Descriptions

| Mode | Behavior |
|------|----------|
| `disabled` | No delegation analysis |
| `suggest` | Analyze and suggest (require approval) |
| `auto` | Auto-delegate high-confidence tasks |

## Examples

```bash
# View current settings
/delegation-config

# Enable auto-delegation
/delegation-config --mode=auto

# Increase threshold (fewer delegations)
/delegation-config --threshold=60

# Multiple changes
/delegation-config --mode=auto --threshold=50 --cache=false

# Reset to defaults
/delegation-config --reset
```

## Default Output

```markdown
## Current Delegation Configuration

| Setting | Value | Description |
|---------|-------|-------------|
| enabled | true | Master enable/disable |
| showHints | true | Show hints in output |
| minComplexityThreshold | 35 | Min complexity (20-80) |
| minSubtaskCount | 3 | Min subtasks |
| quickAnalysisOnly | false | Quick heuristics only |
| useTaskDecomposer | true | Use decomposition |
| cacheEnabled | true | Cache decisions |
| cacheMaxAge | 60000 | Cache TTL (ms) |
| debugMode | false | Debug output |

### Quick Reference
- Fewer delegations: `--threshold=60`
- More delegations: `--threshold=25`
- Auto mode: `--mode=auto`
- Disable: `--mode=disabled`
```

## Change Output

```markdown
## Configuration Updated

| Setting | Previous | New |
|---------|----------|-----|
| minComplexityThreshold | 35 | 60 |

Saved to .claude/delegation-config.json
Cache cleared.
```

## Implementation

```javascript
const {
  loadConfig,
  saveConfig,
  clearCache,
  DEFAULT_CONFIG
} = require('.claude/core/delegation-bridge.js');

// Load current
const config = loadConfig();

// Apply changes
const newConfig = { ...config, ...changes };

// Save
saveConfig(newConfig);

// Clear cache if threshold changed
if (thresholdChanged) clearCache();
```

## Default Configuration

```json
{
  "enabled": true,
  "showHints": true,
  "minComplexityThreshold": 35,
  "minSubtaskCount": 3,
  "quickAnalysisOnly": false,
  "useTaskDecomposer": true,
  "cacheEnabled": true,
  "cacheMaxAge": 60000,
  "debugMode": false
}
```

## Error Handling

### Invalid Mode
```
Error: Invalid mode 'manual'.
Valid: disabled, suggest, auto
```

### Invalid Threshold
```
Error: Threshold must be 20-80. Got: 95
```

## Related Commands

- `/delegate` - Force delegation
- `/direct` - Force direct execution
- `/delegation-status` - View status
