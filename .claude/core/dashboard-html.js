/**
 * Enhanced Dashboard HTML with Interactive Controls
 * Separated for readability
 */

function getDashboardHTML() {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Claude Continuous Loop Monitor</title>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #e0e0e0;
      padding: 20px;
    }
    .container { max-width: 1600px; margin: 0 auto; }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 30px;
      border-radius: 12px;
      margin-bottom: 20px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.3);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header h1 { font-size: 32px; margin-bottom: 10px; }
    .header .session-id { opacity: 0.8; font-size: 14px; }
    .header .controls { display: flex; gap: 10px; }
    .btn {
      padding: 8px 16px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      transition: all 0.2s;
    }
    .btn:hover { transform: translateY(-1px); box-shadow: 0 4px 8px rgba(0,0,0,0.3); }
    .btn-primary { background: #3b82f6; color: white; }
    .btn-danger { background: #ef4444; color: white; }
    .btn-success { background: #10b981; color: white; }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
      gap: 20px;
    }
    .card {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    .card h2 {
      font-size: 18px;
      margin-bottom: 16px;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .progress-bar {
      background: #2a2a2a;
      height: 24px;
      border-radius: 12px;
      overflow: hidden;
      margin: 10px 0;
      position: relative;
    }
    .progress-fill {
      height: 100%;
      transition: width 0.3s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: bold;
    }
    .progress-fill.ok { background: linear-gradient(90deg, #10b981, #059669); }
    .progress-fill.warning { background: linear-gradient(90deg, #f59e0b, #d97706); }
    .progress-fill.critical { background: linear-gradient(90deg, #ef4444, #dc2626); }
    .progress-fill.emergency { background: linear-gradient(90deg, #991b1b, #7f1d1d); }
    .metric {
      display: flex;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid #2a2a2a;
    }
    .metric:last-child { border-bottom: none; }
    .metric-label { color: #9ca3af; }
    .metric-value { font-weight: 600; }
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .status-badge.ok { background: #10b981; color: white; }
    .status-badge.warning { background: #f59e0b; color: white; }
    .status-badge.critical { background: #ef4444; color: white; }
    .status-badge.emergency { background: #991b1b; color: white; }

    /* Task List */
    .task-list { list-style: none; max-height: 400px; overflow-y: auto; }
    .task-item {
      padding: 12px;
      margin: 8px 0;
      background: #2a2a2a;
      border-radius: 8px;
      border-left: 4px solid #666;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .task-item.completed { border-left-color: #10b981; opacity: 0.7; }
    .task-item.in_progress {
      border-left-color: #3b82f6;
      animation: pulse 2s ease-in-out infinite;
    }
    .task-item.pending { border-left-color: #6b7280; }
    .task-icon { font-size: 20px; min-width: 24px; }
    .task-content { flex: 1; }
    .task-progress {
      min-width: 60px;
      text-align: right;
      font-size: 12px;
      color: #9ca3af;
    }

    /* Artifacts */
    .artifact-list { list-style: none; max-height: 400px; overflow-y: auto; }
    .artifact-item {
      padding: 12px;
      margin: 8px 0;
      background: #2a2a2a;
      border-radius: 8px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .artifact-icon { font-size: 24px; min-width: 32px; }
    .artifact-details { flex: 1; }
    .artifact-name { font-weight: 600; margin-bottom: 4px; }
    .artifact-meta { font-size: 12px; color: #9ca3af; }
    .artifact-actions { display: flex; gap: 8px; }
    .btn-small {
      padding: 4px 12px;
      font-size: 12px;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    .btn-small:hover { background: #2563eb; }

    /* Config Toggles */
    .config-section { margin: 16px 0; }
    .config-toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px;
      background: #2a2a2a;
      border-radius: 8px;
      margin: 8px 0;
    }
    .config-label {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .config-name { font-weight: 600; }
    .config-desc { font-size: 12px; color: #9ca3af; }
    .toggle-switch {
      position: relative;
      width: 50px;
      height: 24px;
      background: #4b5563;
      border-radius: 12px;
      cursor: pointer;
      transition: background 0.3s;
    }
    .toggle-switch.active { background: #10b981; }
    .toggle-switch::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 20px;
      height: 20px;
      background: white;
      border-radius: 50%;
      transition: transform 0.3s;
    }
    .toggle-switch.active::after { transform: translateX(26px); }

    /* Events */
    .event-list { list-style: none; max-height: 300px; overflow-y: auto; }
    .event-item {
      padding: 8px 12px;
      margin: 4px 0;
      background: #2a2a2a;
      border-radius: 6px;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .event-time { color: #6b7280; font-size: 11px; min-width: 60px; }
    .event-icon { font-size: 16px; }

    /* Review Queue */
    .review-item {
      padding: 16px;
      margin: 12px 0;
      background: #2a2a2a;
      border: 2px solid #f59e0b;
      border-radius: 8px;
      animation: pulse-border 2s ease-in-out infinite;
    }
    @keyframes pulse-border {
      0%, 100% { border-color: #f59e0b; }
      50% { border-color: #d97706; }
    }
    .review-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .review-confidence {
      background: #f59e0b;
      color: white;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
    }
    .review-task {
      font-weight: 600;
      font-size: 16px;
      margin-bottom: 8px;
    }
    .review-reason {
      color: #9ca3af;
      font-size: 14px;
      margin-bottom: 12px;
    }
    .review-actions {
      display: flex;
      gap: 12px;
      margin-top: 12px;
    }
    .btn-approve {
      background: #10b981;
      color: white;
      padding: 8px 16px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
    }
    .btn-approve:hover { background: #059669; }
    .btn-reject {
      background: #ef4444;
      color: white;
      padding: 8px 16px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
    }
    .btn-reject:hover { background: #dc2626; }
    .feedback-input {
      width: 100%;
      padding: 8px;
      margin-top: 8px;
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 4px;
      color: #e0e0e0;
      font-size: 14px;
    }

    /* Modal */
    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.8);
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }
    .modal.show { display: flex; }
    .modal-content {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 12px;
      padding: 24px;
      max-width: 90%;
      max-height: 90%;
      overflow: auto;
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    .modal-close {
      background: #ef4444;
      color: white;
      border: none;
      border-radius: 4px;
      padding: 4px 12px;
      cursor: pointer;
    }
    pre {
      background: #0a0a0a;
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
      font-size: 13px;
    }

    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1>🤖 Claude Continuous Loop Monitor</h1>
        <div class="session-id">Session: <span id="sessionId">Loading...</span></div>
      </div>
      <div class="controls">
        <button class="btn btn-success" onclick="checkpoint()">💾 Checkpoint</button>
        <button class="btn btn-danger" onclick="wrapUp()">🛑 Wrap Up</button>
      </div>
    </div>

    <div class="grid">
      <!-- Context Window -->
      <div class="card">
        <h2>📊 Context Window</h2>
        <div id="contextStatus"></div>
      </div>

      <!-- API Limits -->
      <div class="card">
        <h2>🌐 API Limits</h2>
        <div id="apiLimits"></div>
      </div>

      <!-- Token Usage -->
      <div class="card">
        <h2>💰 Token Usage</h2>
        <div id="tokenUsage"></div>
      </div>

      <!-- Current Execution -->
      <div class="card">
        <h2>⚙️ Current Execution</h2>
        <div id="currentExecution"></div>
      </div>

      <!-- Execution Plan (Full Width) -->
      <div class="card" style="grid-column: span 2;">
        <h2>📋 Execution Plan</h2>
        <ul id="executionPlan" class="task-list"></ul>
      </div>

      <!-- Artifacts (Full Width) -->
      <div class="card" style="grid-column: span 2;">
        <h2>📦 Session Artifacts</h2>
        <ul id="artifactsList" class="artifact-list"></ul>
      </div>

      <!-- Human Review Queue (Full Width) -->
      <div class="card" style="grid-column: span 2;" id="reviewSection">
        <h2>👤 Human Review Required</h2>
        <div id="reviewQueue"></div>
      </div>

      <!-- Configuration (Full Width) -->
      <div class="card" style="grid-column: span 2;">
        <h2>⚙️ Configuration</h2>
        <div id="configToggles"></div>
      </div>

      <!-- Recent Events (Full Width) -->
      <div class="card" style="grid-column: span 2;">
        <h2>🔔 Recent Events</h2>
        <ul id="recentEvents" class="event-list"></ul>
      </div>
    </div>
  </div>

  <!-- File Viewer Modal -->
  <div id="fileModal" class="modal">
    <div class="modal-content" style="width: 90%; height: 90%;">
      <div class="modal-header">
        <h2 id="modalFileName">File Viewer</h2>
        <button class="modal-close" onclick="closeModal()">✕ Close</button>
      </div>
      <pre id="fileContent">Loading...</pre>
    </div>
  </div>

  <script>
    const eventSource = new EventSource('/events');

    eventSource.onmessage = (event) => {
      const state = JSON.parse(event.data);
      updateDashboard(state);
    };

    function updateDashboard(state) {
      // Update session ID
      document.getElementById('sessionId').textContent = state.session.id;

      // Update context window
      updateContextWindow(state.context);

      // Update API limits
      updateAPILimits(state.apiLimits);

      // Update token usage
      updateTokenUsage(state.usage);

      // Update current execution
      updateCurrentExecution(state.execution);

      // Update execution plan
      updateExecutionPlan(state.plan);

      // Update artifacts
      updateArtifacts(state.artifacts);

      // Update human review queue
      updateReviewQueue(state.humanReview);

      // Update configuration
      updateConfig(state.config);

      // Update events
      updateEvents(state.events);
    }

    function updateContextWindow(ctx) {
      document.getElementById('contextStatus').innerHTML = \`
        <div class="metric">
          <span class="metric-label">Status</span>
          <span class="status-badge \${ctx.status}">\${ctx.status.toUpperCase()}</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill \${ctx.status}" style="width: \${ctx.percentage}%">
            \${Math.round(ctx.percentage)}%
          </div>
        </div>
        <div class="metric">
          <span class="metric-label">Usage</span>
          <span class="metric-value">\${ctx.current.toLocaleString()} / \${ctx.limit.toLocaleString()} tokens</span>
        </div>
        <div class="metric">
          <span class="metric-label">Next Checkpoint</span>
          <span class="metric-value">\${Math.round(ctx.nextCheckpoint).toLocaleString()} tokens</span>
        </div>
      \`;
    }

    function updateAPILimits(limits) {
      if (limits && limits.enabled) {
        const windows = limits.windows;
        document.getElementById('apiLimits').innerHTML = \`
          <div class="metric">
            <span class="metric-label">Plan</span>
            <span class="metric-value">\${limits.plan.toUpperCase()}</span>
          </div>
          <div style="margin: 10px 0;">
            <div style="margin-bottom: 5px; color: #9ca3af; font-size: 12px;">Requests/min</div>
            <div class="progress-bar" style="height: 16px;">
              <div class="progress-fill \${windows.minute.callsUtilization > 0.9 ? 'critical' : windows.minute.callsUtilization > 0.8 ? 'warning' : 'ok'}"
                   style="width: \${windows.minute.callsUtilization * 100}%"></div>
            </div>
            <div style="margin-top: 2px; font-size: 12px;">\${windows.minute.calls} / \${windows.minute.callsLimit}</div>
          </div>
          <div style="margin: 10px 0;">
            <div style="margin-bottom: 5px; color: #9ca3af; font-size: 12px;">Requests/day</div>
            <div class="progress-bar" style="height: 16px;">
              <div class="progress-fill \${windows.day.callsUtilization > 0.9 ? 'critical' : windows.day.callsUtilization > 0.8 ? 'warning' : 'ok'}"
                   style="width: \${windows.day.callsUtilization * 100}%"></div>
            </div>
            <div style="margin-top: 2px; font-size: 12px;">\${windows.day.calls} / \${windows.day.callsLimit}</div>
          </div>
        \`;
      } else {
        document.getElementById('apiLimits').innerHTML = '<div class="metric"><span class="metric-label">Disabled</span></div>';
      }
    }

    function updateTokenUsage(usage) {
      if (usage) {
        document.getElementById('tokenUsage').innerHTML = \`
          <div class="metric">
            <span class="metric-label">Input Tokens</span>
            <span class="metric-value">\${usage.inputTokens?.toLocaleString() || 0}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Output Tokens</span>
            <span class="metric-value">\${usage.outputTokens?.toLocaleString() || 0}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Total Cost</span>
            <span class="metric-value">$\${(usage.totalCost || 0).toFixed(2)}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Cache Savings</span>
            <span class="metric-value">$\${(usage.cacheSavings || 0).toFixed(2)}</span>
          </div>
        \`;
      }
    }

    function updateCurrentExecution(exec) {
      if (exec.task) {
        const duration = Math.floor(exec.duration / 1000);
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        document.getElementById('currentExecution').innerHTML = \`
          <div class="metric">
            <span class="metric-label">Phase</span>
            <span class="metric-value">\${exec.phase || 'N/A'}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Agent</span>
            <span class="metric-value">\${exec.agent || 'N/A'}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Task</span>
            <span class="metric-value">\${typeof exec.task === 'string' ? exec.task.substring(0, 50) : 'Active'}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Duration</span>
            <span class="metric-value">\${minutes}m \${seconds}s</span>
          </div>
        \`;
      } else {
        document.getElementById('currentExecution').innerHTML = '<div class="metric"><span class="metric-label">Idle</span></div>';
      }
    }

    function updateExecutionPlan(plan) {
      const planHTML = plan.tasks.map(task => \`
        <li class="task-item \${task.status}">
          <span class="task-icon">\${task.status === 'completed' ? '✅' : task.status === 'in_progress' ? '🔄' : '⏳'}</span>
          <div class="task-content">\${task.content}</div>
          <div class="task-progress">\${task.progress || 0}%</div>
        </li>
      \`).join('');
      document.getElementById('executionPlan').innerHTML = planHTML || '<li class="task-item">No plan loaded</li>';
    }

    function updateArtifacts(artifacts) {
      if (!artifacts || artifacts.length === 0) {
        document.getElementById('artifactsList').innerHTML = '<li class="artifact-item">No artifacts created yet</li>';
        return;
      }

      const artifactsHTML = artifacts.map(artifact => {
        const icon = getFileIcon(artifact.type);
        const date = new Date(artifact.created).toLocaleString();
        return \`
          <li class="artifact-item">
            <span class="artifact-icon">\${icon}</span>
            <div class="artifact-details">
              <div class="artifact-name">\${artifact.name}</div>
              <div class="artifact-meta">\${artifact.type} • \${date} • \${artifact.phase || 'unknown phase'}</div>
            </div>
            <div class="artifact-actions">
              <button class="btn-small" onclick="viewFile('\${artifact.path}')">👁️ View</button>
              <button class="btn-small" onclick="openFile('\${artifact.path}')">🚀 Launch</button>
            </div>
          </li>
        \`;
      }).join('');

      document.getElementById('artifactsList').innerHTML = artifactsHTML;
    }

    function updateReviewQueue(humanReview) {
      const reviewSection = document.getElementById('reviewSection');

      if (!humanReview || humanReview.pending.length === 0) {
        reviewSection.style.display = 'none';
        return;
      }

      reviewSection.style.display = 'block';

      const reviewsHTML = humanReview.pending.map(review => \`
        <div class="review-item">
          <div class="review-header">
            <span class="review-confidence">\${Math.round(review.confidence * 100)}% confidence</span>
            <span style="color: #9ca3af; font-size: 12px;">
              \${new Date(review.timestamp).toLocaleString()}
            </span>
          </div>
          <div class="review-task">\${review.task || 'Task requires review'}</div>
          <div class="review-reason">⚠️ \${review.reason}</div>
          <div class="review-details" style="font-size: 13px; color: #9ca3af;">
            <strong>Pattern:</strong> \${review.pattern || 'unknown'}<br>
            <strong>Phase:</strong> \${review.context?.phase || 'unknown'}
          </div>
          <div class="review-actions">
            <button class="btn-approve" onclick="approveReview('\${review.id}')">
              ✅ Approve & Continue
            </button>
            <button class="btn-reject" onclick="rejectReview('\${review.id}')">
              ❌ Stop & Revise
            </button>
          </div>
          <input type="text"
                 class="feedback-input"
                 id="feedback-\${review.id}"
                 placeholder="Optional: Provide feedback to help Claude learn (e.g., 'This is a critical security change')">
        </div>
      \`).join('');

      document.getElementById('reviewQueue').innerHTML = reviewsHTML;
    }

    function updateConfig(config) {
      const toggles = [
        {
          path: 'apiLimitTracking.enabled',
          name: 'API Limit Tracking',
          desc: 'Monitor and enforce Claude API rate limits',
          value: config.apiLimitTracking?.enabled !== false
        },
        {
          path: 'contextMonitoring.enabled',
          name: 'Context Window Monitoring',
          desc: 'Track context window usage and trigger checkpoints',
          value: config.contextMonitoring?.enabled !== false
        },
        {
          path: 'costBudgets.enabled',
          name: 'Cost Budget Tracking',
          desc: 'Monitor token costs against daily/monthly budgets',
          value: config.costBudgets?.enabled !== false
        },
        {
          path: 'checkpointOptimizer.enabled',
          name: 'Intelligent Checkpoint Learning',
          desc: 'Adapt checkpoint timing based on historical data',
          value: config.checkpointOptimizer?.enabled !== false
        },
        {
          path: 'checkpointOptimizer.detectCompaction',
          name: 'Compaction Detection',
          desc: 'Detect and auto-adjust when Claude forces context reduction',
          value: config.checkpointOptimizer?.detectCompaction !== false
        },
        {
          path: 'humanInLoop.enabled',
          name: 'Human-In-Loop Guardrails',
          desc: 'Pause for human review on risky or complex decisions',
          value: config.humanInLoop?.enabled !== false
        }
      ];

      const togglesHTML = toggles.map(toggle => \`
        <div class="config-toggle">
          <div class="config-label">
            <span class="config-name">\${toggle.name}</span>
            <span class="config-desc">\${toggle.desc}</span>
          </div>
          <div class="toggle-switch \${toggle.value ? 'active' : ''}"
               onclick="toggleConfig('\${toggle.path}', \${!toggle.value})">
          </div>
        </div>
      \`).join('');

      document.getElementById('configToggles').innerHTML = togglesHTML;
    }

    function updateEvents(events) {
      const eventsHTML = events.slice(0, 10).map(event => {
        const time = new Date(event.timestamp).toLocaleTimeString();
        const icons = {
          start: '▶️',
          success: '✅',
          error: '❌',
          warning: '⚠️',
          info: 'ℹ️',
          checkpoint: '💾'
        };
        return \`
          <li class="event-item">
            <span class="event-time">\${time}</span>
            <span class="event-icon">\${icons[event.type] || 'ℹ️'}</span>
            <span>\${event.message}</span>
          </li>
        \`;
      }).join('');
      document.getElementById('recentEvents').innerHTML = eventsHTML || '<li class="event-item">No events</li>';
    }

    function getFileIcon(type) {
      const icons = {
        'file': '📄',
        'code': '💻',
        'image': '🖼️',
        'document': '📝',
        'data': '📊'
      };
      return icons[type] || '📄';
    }

    async function viewFile(filePath) {
      try {
        const response = await fetch(\`/api/file?filePath=\${encodeURIComponent(filePath)}\`);
        const data = await response.json();

        if (response.ok) {
          document.getElementById('modalFileName').textContent = data.path;
          document.getElementById('fileContent').textContent = data.content;
          document.getElementById('fileModal').classList.add('show');
        } else {
          alert('Error: ' + data.error);
        }
      } catch (error) {
        alert('Failed to load file: ' + error.message);
      }
    }

    function openFile(filePath) {
      // Request to open in system editor
      alert('Launch file: ' + filePath + '\\n\\nNote: File launching requires system integration. Use View to see content.');
    }

    function closeModal() {
      document.getElementById('fileModal').classList.remove('show');
    }

    async function toggleConfig(path, value) {
      try {
        const response = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, value })
        });

        const result = await response.json();

        if (result.success) {
          console.log('Config updated:', path, '=', value);
        } else {
          alert('Failed to update config: ' + result.error);
        }
      } catch (error) {
        alert('Error updating config: ' + error.message);
      }
    }

    function checkpoint() {
      alert('Checkpoint triggered! (Feature requires backend integration)');
    }

    function wrapUp() {
      if (confirm('Initiate graceful wrap-up? This will complete current tasks and save state.')) {
        alert('Wrap-up initiated! (Feature requires backend integration)');
      }
    }

    async function approveReview(reviewId) {
      const feedback = document.getElementById(\`feedback-\${reviewId}\`)?.value || '';

      try {
        const response = await fetch(\`/api/review/\${reviewId}\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            approved: true,
            feedback: feedback,
            wasCorrect: true  // User says detection was correct
          })
        });

        const result = await response.json();

        if (result.success) {
          console.log('Review approved:', reviewId);
          // Dashboard will update automatically via SSE
        } else {
          alert('Failed to approve: ' + result.error);
        }
      } catch (error) {
        alert('Error approving review: ' + error.message);
      }
    }

    async function rejectReview(reviewId) {
      const feedback = document.getElementById(\`feedback-\${reviewId}\`)?.value || '';

      if (!feedback) {
        if (!confirm('Are you sure you want to reject without providing feedback? Feedback helps Claude learn.')) {
          return;
        }
      }

      try {
        const response = await fetch(\`/api/review/\${reviewId}\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            approved: false,
            feedback: feedback,
            wasCorrect: true  // User says detection was correct
          })
        });

        const result = await response.json();

        if (result.success) {
          console.log('Review rejected:', reviewId);
          // Dashboard will update automatically via SSE
        } else {
          alert('Failed to reject: ' + result.error);
        }
      } catch (error) {
        alert('Error rejecting review: ' + error.message);
      }
    }
  </script>
</body>
</html>
  `;
}

module.exports = { getDashboardHTML };
