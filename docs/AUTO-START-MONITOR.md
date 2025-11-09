# Auto-Start Usage Monitor with Claude Code

## Overview

This guide shows you how to automatically launch the usage monitor when you start working with Claude Code.

## Methods to Auto-Start

### Method 1: Background Window (Recommended)

Start the monitor in a separate terminal window that stays open in the background:

```bash
npm run monitor:bg
```

This will:
- ✅ Open a new terminal window
- ✅ Start the monitor in that window
- ✅ Keep running in the background
- ✅ Let you continue working in Claude Code

**To stop**: Just close the monitor terminal window

### Method 2: VS Code Task (Auto-start on folder open)

The project includes a VS Code task that can run automatically.

**To enable auto-start:**

Edit `.vscode/tasks.json` and the task already has:
```json
"runOptions": {
  "runOn": "folderOpen"
}
```

**Note**: VS Code will ask permission the first time. Click "Allow" to enable auto-start.

**To start manually via VS Code:**
1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
2. Type "Run Task"
3. Select "Start Usage Monitor (Manual)"

### Method 3: Session Hook (Automatic)

Edit `.claude/hooks/session-start.sh` and uncomment the auto-start line:

```bash
#!/bin/bash

# Session Start Hook
# Auto-runs when Claude Code session starts

# Uncomment this line to auto-start monitor
npm run monitor:bg

echo "✅ Usage monitor started automatically!"
```

Then make it executable:
```bash
chmod +x .claude/hooks/session-start.sh
```

### Method 4: Slash Command

Use the Claude Code slash command:

```
/start-monitor
```

This will launch the monitor in a new window.

### Method 5: NPM Script in Terminal

Add to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.):

```bash
# Auto-start usage monitor when entering project directory
if [ -f "package.json" ] && grep -q "multi-agent-framework" package.json; then
  npm run monitor:bg 2>/dev/null
fi
```

## Configuration Options

### Set Budget Alerts

Create a `.env` file in your project root:

```bash
# .env
DAILY_BUDGET_USD=10
MONTHLY_BUDGET_USD=500
```

Or set in your shell profile:
```bash
export DAILY_BUDGET_USD=10
export MONTHLY_BUDGET_USD=500
```

### Custom Refresh Rate

Edit `scripts/start-monitor-background.js` to change the default refresh:

```javascript
// Change from default 2000ms to 5000ms (5 seconds)
const refreshInterval = 5000;
```

## Recommended Workflow

**For Active Development:**

```bash
# Terminal 1: Claude Code
code .

# Terminal 2: Auto-started monitor
# (opens automatically via one of the methods above)

# Terminal 3: Run demos/tests
npm run demo
npm test
```

**For Long-Running Processes:**

```bash
# Start monitor in background
npm run monitor:bg

# Run your long process
node your-script.js

# Monitor shows live updates in separate window
```

## Platform-Specific Notes

### Windows

The background monitor uses:
```cmd
start "Usage Monitor" cmd /c "node scripts/usage-monitor.js"
```

This opens a new Command Prompt window with the title "Usage Monitor".

### macOS

Uses AppleScript to open a new Terminal window:
```bash
osascript -e 'tell application "Terminal" ...'
```

Requires Terminal.app (built-in).

### Linux

Tries these terminal emulators in order:
1. `gnome-terminal` (GNOME/Ubuntu)
2. `konsole` (KDE)
3. `xterm` (fallback)

Install one if needed:
```bash
# Ubuntu/Debian
sudo apt install gnome-terminal

# Fedora
sudo dnf install gnome-terminal
```

## Troubleshooting

### Monitor doesn't start automatically

**Check 1**: Verify the script is executable
```bash
chmod +x .claude/hooks/session-start.sh
```

**Check 2**: Check if VS Code task permissions are enabled
- VS Code → Settings → Search "task auto detect"
- Enable "Auto Detect Tasks"

**Check 3**: Start manually to test
```bash
npm run monitor:bg
```

### "No database found" error

Run at least one orchestration first:
```bash
npm run demo
```

### Multiple monitor windows open

This happens if you have multiple auto-start methods enabled.

**Solution**: Choose one method and disable the others.

### Monitor window closes immediately (Windows)

The script path might have spaces. Try:
```bash
# Use full quoted path
start "Usage Monitor" cmd /c "node \"C:\Users\...\usage-monitor.js\""
```

## Quick Start Checklist

✅ **Step 1**: Test manual start
```bash
npm run monitor
```

✅ **Step 2**: Test background start
```bash
npm run monitor:bg
```

✅ **Step 3**: Choose auto-start method
- [ ] VS Code task (folder open)
- [ ] Session hook (`.claude/hooks/session-start.sh`)
- [ ] Slash command (`/start-monitor`)
- [ ] Shell profile auto-start

✅ **Step 4**: Configure budgets (optional)
```bash
export DAILY_BUDGET_USD=10
export MONTHLY_BUDGET_USD=500
```

✅ **Step 5**: Run an orchestration
```bash
npm run demo
```

✅ **Step 6**: Verify monitor updates

## Advanced: Custom Auto-Start Script

Create your own startup script:

```bash
#!/bin/bash
# my-startup.sh

# Set budgets
export DAILY_BUDGET_USD=25
export MONTHLY_BUDGET_USD=750

# Start monitor in background
npm run monitor:bg

# Show reminder
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Usage Monitor running in background"
echo "📊 Daily budget: \$${DAILY_BUDGET_USD}"
echo "📊 Monthly budget: \$${MONTHLY_BUDGET_USD}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
```

Make executable and run:
```bash
chmod +x my-startup.sh
./my-startup.sh
```

## See Also

- [Live Usage Monitoring Guide](./LIVE-USAGE-MONITORING.md)
- [Usage Analytics Architecture](./USAGE-ANALYTICS-ARCHITECTURE.md)
- [VS Code Tasks Documentation](https://code.visualstudio.com/docs/editor/tasks)
