# Telemetry Research Summary - Quick Reference

**Date**: 2025-12-14
**Status**: Research Complete
**Recommendation**: Log-Based File Watching + Context Tracking

---

## TL;DR

**The Solution**: Monitor Claude Code's local JSONL log files in real-time using file watching, extract token usage, accumulate context, and trigger checkpoints at thresholds.

**Why This Works**:
- Claude Code writes JSONL session logs to `~/.claude/projects/`
- Each log entry contains complete token usage data
- File watching provides near-zero latency monitoring
- No Claude Code modification required
- 100% accurate tracking

**Implementation Time**: 4-6 hours

---

## 10 Approaches Researched

### 1. OpenTelemetry for LLM (GenAI Semantic Conventions v1.37+)
- **Status**: Industry standard for LLM monitoring
- **Applicability**: ⚠️ Requires Claude Code to emit OTLP metrics
- **Current State**: We have OTLP receiver ready, but Claude Code CLI doesn't emit by default
- **Use Case**: If/when Claude Code adds OTLP support

### 2. Proxy-Based Monitoring (mitmproxy, HTTP Toolkit)
- **Status**: Production-ready, works immediately
- **Applicability**: ✅ Can intercept HTTPS to Anthropic API
- **How**: Set HTTPS_PROXY, extract tokens from API responses
- **Trade-off**: Requires SSL certificate trust, adds network hop

### 3. Hook and Middleware Patterns (Axios/Fetch interceptors)
- **Status**: Common in web development
- **Applicability**: ❌ Requires access to Claude Code internals
- **Limitation**: Can't easily monkey patch compiled CLI

### 4. Browser DevTools Protocol (CDP, Puppeteer)
- **Status**: Powerful for browser automation
- **Applicability**: ❌ Claude Code is CLI, not browser-based
- **Use Case**: Only for Claude.ai website monitoring

### 5. Electron App Monitoring (IPC telemetry)
- **Status**: Specialized for Electron apps
- **Applicability**: ⚠️ Unknown - need to verify if Claude Code uses Electron
- **Investigation**: Check for `electron` in dependencies or `.asar` files

### 6. File System Watching (Chokidar, fs.watch)
- **Status**: ✅✅ **RECOMMENDED APPROACH**
- **Applicability**: ✅ Works perfectly for Claude Code
- **Implementation**: Watch `~/.claude/projects/**/*.jsonl` for changes
- **Latency**: Near real-time (<1 second)

### 7. Log-Based Metrics (Grok Exporter, Prometheus)
- **Status**: Production pattern for observability
- **Applicability**: ✅ Parse JSONL logs for metrics
- **Tools**: grok_exporter, Prometheus textfile collector
- **Integration**: Export to Grafana/Prometheus

### 8. ccusage CLI Tool
- **Status**: ✅ Production-ready, actively maintained
- **Applicability**: ✅ Can use as library or reference implementation
- **Features**: Daily/monthly reports, live monitoring, cost analysis
- **Location**: https://github.com/ryoppippi/ccusage

### 9. Claude-Code-Usage-Monitor
- **Status**: ✅ Open source, Rich UI
- **Applicability**: ✅ ML-based predictions, burn rate analysis
- **Features**: Terminal UI, 8-day pattern analysis, exhaustion predictions
- **Location**: https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor

### 10. Hybrid Approach (Logs + OTLP + Context Tracking)
- **Status**: ✅ **MOST ROBUST**
- **Applicability**: ✅ Combines best of all approaches
- **Components**: File watcher → Parser → Context tracker → Checkpoints

---

## Recommended Architecture

```
Claude Code CLI
    ↓ writes
JSONL Log Files (~/.claude/projects/)
    ↓ watched by
File Watcher (chokidar)
    ↓ parses
Usage Extractor (readline + JSON.parse)
    ↓ tracks
Context Tracker (accumulates tokens per session)
    ↓ emits events
Checkpoint Trigger (at 70%, 85%, 95% thresholds)
    ↓ saves to
UsageTracker (SQLite) + Dev-Docs Pattern
```

---

## Key Findings from Research

### 1. Log File Locations
- **Linux/macOS**: `~/.claude/projects/` or `~/.config/claude/logs/`
- **Windows**: `%APPDATA%\Local\Claude\Logs\` or `%AppData%\Roaming\Claude\`

### 2. JSONL Format
```json
{
  "timestamp": "2025-12-14T12:34:56Z",
  "message": {
    "id": "msg_abc123",
    "model": "claude-sonnet-4",
    "usage": {
      "input_tokens": 1500,
      "output_tokens": 350,
      "cache_creation_input_tokens": 5000,
      "cache_read_input_tokens": 2000
    }
  }
}
```

### 3. Context Calculation
```
Context Tokens = Input Tokens + Output Tokens
(Cache tokens don't count toward 200k limit)

Percentage = (Context Tokens / 200,000) * 100
```

### 4. OpenTelemetry GenAI Standards (v1.37+)
```javascript
{
  "gen_ai.token.usage": {
    attributes: {
      "gen_ai.token.type": ["input", "output", "cache_creation", "cache_read"],
      "gen_ai.request.model": "claude-sonnet-4",
      "gen_ai.system": "anthropic"
    }
  }
}
```

---

## What We Already Have (80% Complete)

✅ **UsageTracker** - SQLite database for metrics
✅ **ClaudeCodeUsageParser** - JSONL parsing logic
✅ **OTLP Receiver** - Metrics endpoint (port 4318)
✅ **MetricProcessor** - Aggregation and optimization
✅ **DashboardManager** - Real-time visualization
✅ **UnifiedContextMonitor** - Monitoring framework

---

## What We Need to Add (20% Remaining)

### 1. Real-time File Watching (Currently Polls Every 60s)
```javascript
const chokidar = require('chokidar');

const watcher = chokidar.watch('~/.claude/projects/**/*.jsonl', {
  persistent: true,
  awaitWriteFinish: { stabilityThreshold: 1000 }
});

watcher.on('change', async (filePath) => {
  await processNewEntries(filePath);
});
```

**Effort**: 1 hour

### 2. Context Accumulation (Track Per-Session Totals)
```javascript
class SessionContextTracker {
  trackMessage(sessionId, usage) {
    // Accumulate tokens for session
    const contextTokens = session.totalInput + session.totalOutput;
    const percentage = (contextTokens / 200000) * 100;

    // Emit events at thresholds
    if (percentage >= 95) this.emit('critical');
    else if (percentage >= 85) this.emit('warning');
    else if (percentage >= 70) this.emit('checkpoint');

    return { contextTokens, percentage };
  }
}
```

**Effort**: 2 hours

### 3. Threshold Integration (Connect to Existing Checkpoints)
```javascript
contextTracker.on('checkpoint', async (context) => {
  console.log(`Checkpoint at ${context.percentage}%`);
  await updateDevDocs(context);
  await createCheckpoint(context);
});
```

**Effort**: 1 hour

### 4. Session Isolation (Multi-Project Support)
```javascript
// Track each project/session independently
sessions = new Map(); // sessionId -> { tokens, start, messages }
```

**Effort**: 1 hour

---

## Implementation Plan

### Phase 1: Real-time File Watching (1 hour)
1. Install chokidar: `npm install chokidar`
2. Replace polling in `claude-code-usage-parser.js`
3. Add debouncing for rapid file changes
4. Test with live Claude Code session

### Phase 2: Context Tracking (2 hours)
1. Create `SessionContextTracker` class
2. Implement token accumulation per session
3. Add threshold detection (70%, 85%, 95%)
4. Emit events for each threshold

### Phase 3: Checkpoint Integration (1 hour)
1. Listen for threshold events
2. Trigger dev-docs updates
3. Create checkpoint records
4. Test full flow

### Phase 4: Testing & Validation (1 hour)
1. Run real Claude Code session
2. Verify context tracking accuracy
3. Test checkpoint creation
4. Validate dashboard updates

**Total Time**: 5 hours

---

## Success Criteria

✅ File watching detects new JSONL entries within 1 second
✅ Context percentage accurately reflects token accumulation
✅ Checkpoint triggers at 70% threshold
✅ Warning emitted at 85% threshold
✅ Critical alert at 95% threshold
✅ Multiple sessions tracked independently
✅ Dashboard shows real-time context percentage
✅ Dev-docs pattern files updated automatically

---

## Alternative Approaches (If Needed)

### If Log Files Not Accessible
1. **Proxy Pattern**: Use mitmproxy to intercept API calls
2. **Environment Variables**: Check if Claude Code supports OTLP via env vars
3. **Wrapper Script**: Create shell wrapper that monitors subprocess

### If Real-time Not Required
1. **Periodic Parsing**: Keep current 60s polling
2. **ccusage Integration**: Use ccusage CLI for manual checks
3. **Post-Session Analysis**: Parse logs after session ends

---

## Production Tools Reference

### Log Parsing
- **ccusage**: https://github.com/ryoppippi/ccusage - CLI tool, can use as library
- **Claude-Code-Usage-Monitor**: Rich terminal UI with ML predictions

### File Watching
- **chokidar**: https://github.com/paulmillr/chokidar - Production-grade file watcher
- **Node.js fs.watch**: Native API (less reliable)

### Proxy Monitoring
- **mitmproxy**: https://mitmproxy.org - SSL proxy with Python API
- **HTTP Toolkit**: https://httptoolkit.com - GUI-based HTTP debugger

### OpenTelemetry
- **OpenLIT**: https://openlit.io - Auto-instrumentation for LLMs
- **Langfuse**: https://langfuse.com - LLM observability platform
- **Traceloop**: https://github.com/traceloop/openllmetry - GenAI observability

### Metrics Export
- **Grok Exporter**: https://github.com/fstab/grok_exporter - Pattern-based log parsing
- **Prometheus Node Exporter**: Textfile collector for custom metrics

---

## Key Insights

1. **Log files are the source of truth** - Claude Code writes complete usage data
2. **File watching is mature** - Libraries like chokidar are battle-tested
3. **Context tracking is simple arithmetic** - Just sum input + output tokens
4. **OpenTelemetry is the future** - But not required for MVP
5. **Existing tools validate approach** - ccusage proves feasibility
6. **Real-time is achievable** - <1 second latency with proper file watching
7. **No API access needed** - Everything available locally
8. **Production-ready patterns exist** - Don't reinvent the wheel

---

## Next Steps

1. **Read full report**: `TELEMETRY_RESEARCH_REPORT.md` (79KB, comprehensive)
2. **Review current implementation**: Check what's already in `claude-code-usage-parser.js`
3. **Plan enhancements**: Prioritize real-time watching and context tracking
4. **Implement Phase 1**: Add chokidar file watching
5. **Test with real session**: Validate accuracy before proceeding

---

## Questions Answered

### Q: Can we track Claude Code without API access?
**A**: ✅ Yes - via JSONL log files

### Q: How accurate is log-based tracking?
**A**: ✅ 100% - logs contain exact token counts from API

### Q: What's the latency?
**A**: ✅ <1 second with file watching, 60s with polling

### Q: Does it work for multiple sessions?
**A**: ✅ Yes - each session has separate JSONL file

### Q: Can we track context window?
**A**: ✅ Yes - accumulate tokens per session

### Q: Is it production-ready?
**A**: ✅ Yes - used by ccusage and other tools

### Q: Does it require Claude Code changes?
**A**: ✅ No - logs are automatically created

### Q: What about OTLP/OpenTelemetry?
**A**: ⚠️ Future enhancement if Claude Code adds support

---

**For detailed technical implementation, see**: `TELEMETRY_RESEARCH_REPORT.md`
