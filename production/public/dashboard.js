/**
 * Production Dashboard Client
 */

class Dashboard {
  constructor() {
    this.ws = null;
    this.wsUrl = null;
    this.currentView = 'overview';
    this.currentSession = null;
    this.charts = {};
    this.refreshInterval = null;

    this.init();
  }

  async init() {
    try {
      // Get WebSocket configuration - use direct URL
      this.wsUrl = 'ws://localhost:3001';
      this.apiUrl = 'http://localhost:9464';

      // Connect WebSocket
      this.connectWebSocket();

      // Setup navigation
      this.setupNavigation();

      // Setup event listeners
      this.setupEventListeners();

      // Initial data load
      await this.loadInitialData();

      // Setup charts
      this.setupCharts();

      // Auto-refresh every 30 seconds
      this.refreshInterval = setInterval(() => this.refreshData(), 30000);

      console.log('✓ Dashboard initialized');
    } catch (error) {
      console.error('Dashboard initialization error:', error);
    }
  }

  connectWebSocket() {
    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = () => {
      console.log('✓ WebSocket connected');
      this.updateConnectionStatus(true);
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleWebSocketMessage(message);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.updateConnectionStatus(false);
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.updateConnectionStatus(false);

      // Attempt reconnection after 5 seconds
      setTimeout(() => this.connectWebSocket(), 5000);
    };
  }

  handleWebSocketMessage(message) {
    console.log('WebSocket message:', message.type);

    switch (message.type) {
      case 'initial_state':
        this.handleInitialState(message.data);
        break;
      case 'session_started':
        this.handleSessionStarted(message.data);
        break;
      case 'session_paused':
      case 'session_resumed':
      case 'session_ended':
        this.refreshData();
        break;
      case 'metrics_updated':
        this.handleMetricsUpdate(message.data);
        break;
      case 'alert_created':
        this.handleNewAlert(message.data);
        break;
      case 'checkpoint_triggered':
      case 'checkpoint_created':
        this.handleCheckpoint(message.data);
        break;
    }
  }

  handleInitialState(data) {
    console.log('Initial state:', data);
    this.refreshData();
  }

  handleSessionStarted(session) {
    console.log('New session started:', session);
    this.refreshData();
    this.showNotification('Session started successfully', 'success');
  }

  handleMetricsUpdate(data) {
    console.log('Metrics updated:', data);
    // Update display if viewing this session
    if (this.currentSession && this.currentSession.id === data.sessionId) {
      this.loadSessionDetails(data.sessionId);
    }
    this.loadOverviewStats();
  }

  handleNewAlert(alert) {
    console.log('New alert:', alert);
    this.showNotification(alert.message, alert.severity);
    this.refreshData();
  }

  handleCheckpoint(data) {
    console.log('Checkpoint:', data);
    this.showNotification(`Checkpoint created for session ${data.sessionId}`, 'info');
  }

  updateConnectionStatus(connected) {
    const indicator = document.getElementById('statusIndicator');
    const text = document.getElementById('statusText');

    if (connected) {
      indicator.classList.remove('disconnected');
      text.textContent = 'Connected';
    } else {
      indicator.classList.add('disconnected');
      text.textContent = 'Disconnected';
    }
  }

  setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const view = item.dataset.view;
        this.switchView(view);
      });
    });
  }

  setupEventListeners() {
    // Session status filter
    const statusFilter = document.getElementById('sessionStatusFilter');
    if (statusFilter) {
      statusFilter.addEventListener('change', () => this.loadSessions());
    }

    // Chart period controls
    document.querySelectorAll('.chart-control').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.chart-control').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.updateTrendsChart(e.target.dataset.period);
      });
    });
  }

  switchView(viewName) {
    // Update navigation
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewName);
    });

    // Update views
    document.querySelectorAll('.view').forEach(view => {
      view.classList.toggle('active', view.id === `${viewName}-view`);
    });

    // Update header
    const titles = {
      overview: 'Overview',
      sessions: 'Sessions',
      projects: 'Projects',
      alerts: 'Alerts',
      analytics: 'Analytics'
    };
    document.getElementById('viewTitle').textContent = titles[viewName];

    this.currentView = viewName;

    // Load view-specific data
    switch (viewName) {
      case 'sessions':
        this.loadSessions();
        break;
      case 'projects':
        this.loadProjects();
        break;
      case 'alerts':
        this.loadAlerts();
        break;
      case 'analytics':
        this.loadAnalytics();
        break;
    }
  }

  async loadInitialData() {
    await Promise.all([
      this.loadOverviewStats(),
      this.loadRecentSessions(),
      this.loadContextStatus()
    ]);
  }

  async refreshData() {
    switch (this.currentView) {
      case 'overview':
        await this.loadOverviewStats();
        await this.loadRecentSessions();
        await this.loadContextStatus();
        break;
      case 'sessions':
        await this.loadSessions();
        break;
      case 'projects':
        await this.loadProjects();
        break;
      case 'alerts':
        await this.loadAlerts();
        break;
      case 'analytics':
        await this.loadAnalytics();
        break;
    }
  }

  async loadOverviewStats() {
    try {
      const response = await fetch('http://localhost:9464/api/analytics/overview');
      const data = await response.json();

      document.getElementById('statActiveSessions').textContent = data.stats.active_sessions || 0;
      document.getElementById('statTotalSessions').textContent = data.stats.total_sessions || 0;
      document.getElementById('statTotalTokens').textContent = this.formatNumber(data.stats.total_tokens || 0);
      document.getElementById('statTotalCost').textContent = this.formatCurrency(data.stats.total_cost || 0);
      document.getElementById('statAvgContext').textContent = this.formatPercentage(data.stats.avg_context || 0);
      document.getElementById('statAlerts').textContent = data.recentAlerts?.length || 0;
    } catch (error) {
      console.error('Error loading overview stats:', error);
    }
  }

  async loadRecentSessions() {
    try {
      const response = await fetch('http://localhost:9464/api/sessions?limit=5');
      const data = await response.json();

      const container = document.getElementById('recentSessionsList');

      if (!data.sessions || data.sessions.length === 0) {
        container.innerHTML = this.renderEmptyState('No active sessions', 'Start a new session to begin tracking');
        return;
      }

      container.innerHTML = data.sessions.map(session => this.renderSessionItem(session)).join('');
    } catch (error) {
      console.error('Error loading recent sessions:', error);
    }
  }

  async loadSessions() {
    try {
      const status = document.getElementById('sessionStatusFilter')?.value || '';
      const url = status ? `${this.apiUrl}/api/sessions?status=${status}` : `${this.apiUrl}/api/sessions`;

      const response = await fetch(url);
      const data = await response.json();

      const container = document.getElementById('allSessionsList');

      if (!data.sessions || data.sessions.length === 0) {
        container.innerHTML = this.renderEmptyState('No sessions found', 'Try adjusting your filters');
        return;
      }

      container.innerHTML = data.sessions.map(session => this.renderSessionItem(session)).join('');
    } catch (error) {
      console.error('Error loading sessions:', error);
    }
  }

  async loadProjects() {
    try {
      const response = await fetch(`${this.apiUrl}/api/projects/detailed`);
      const data = await response.json();

      const container = document.getElementById('projectsList');

      if (!data.projects || data.projects.length === 0) {
        container.innerHTML = this.renderEmptyState('No projects found', 'Projects are created automatically when sessions are started');
        return;
      }

      container.innerHTML = data.projects.map(project => this.renderProjectWithSessions(project)).join('');

      // Add expand/collapse functionality
      document.querySelectorAll('.project-header').forEach(header => {
        header.addEventListener('click', () => {
          header.classList.toggle('expanded');
          const sessions = header.nextElementSibling;
          sessions.classList.toggle('show');
        });
      });
    } catch (error) {
      console.error('Error loading projects:', error);
    }
  }

  refreshProjects() {
    this.loadProjects();
  }

  async loadAlerts() {
    try {
      const response = await fetch(`${this.apiUrl}/api/alerts?acknowledged=false`);
      const data = await response.json();

      const container = document.getElementById('alertsList');

      if (!data.alerts || data.alerts.length === 0) {
        container.innerHTML = this.renderEmptyState('No active alerts', 'All systems operating normally');
        return;
      }

      container.innerHTML = data.alerts.map(alert => this.renderAlertItem(alert)).join('');
    } catch (error) {
      console.error('Error loading alerts:', error);
    }
  }

  async loadAnalytics() {
    // Load analytics charts and data
    this.updateAnalyticsCharts();
  }

  async loadContextStatus() {
    try {
      const response = await fetch(`${this.apiUrl}/api/context/status`);
      const data = await response.json();

      const container = document.getElementById('contextControlsList');

      if (!data.contextStatus || data.contextStatus.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">💾</div>
            <div class="empty-state-message">No active sessions</div>
            <div class="empty-state-hint">Start a session to manage context</div>
          </div>
        `;
        return;
      }

      container.innerHTML = `
        <div style="margin-bottom: 15px; padding: 15px; background: var(--bg-tertiary); border-radius: 8px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
            <span style="color: var(--text-secondary);">Auto-compact Threshold:</span>
            <span style="color: var(--warning);">${(data.compactionThreshold * 100).toFixed(0)}%</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: var(--text-secondary);">Checkpoint Threshold:</span>
            <span style="color: var(--info);">${(data.checkpointThreshold * 100).toFixed(0)}%</span>
          </div>
        </div>
        ${data.contextStatus.map(session => this.renderContextControl(session)).join('')}
      `;
    } catch (error) {
      console.error('Error loading context status:', error);
      document.getElementById('contextControlsList').innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⚠️</div>
          <div class="empty-state-message">Failed to load context status</div>
        </div>
      `;
    }
  }

  renderContextControl(session) {
    const contextPercent = (session.contextPercentage * 100).toFixed(1);
    const contextColor = session.contextPercentage >= 0.8 ? 'var(--danger)' :
                        session.contextPercentage >= 0.6 ? 'var(--warning)' :
                        'var(--success)';

    return `
      <div style="margin-bottom: 15px; padding: 15px; background: var(--bg-tertiary); border-radius: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <div>
            <div style="font-weight: 600; margin-bottom: 4px;">${session.sessionId}</div>
            <div style="font-size: 12px; color: var(--text-secondary);">
              ${session.projectId || 'No project'} • ${session.totalTokens.toLocaleString()} tokens
            </div>
          </div>
          <span class="status-badge ${session.status}">${session.status}</span>
        </div>

        <div style="margin-bottom: 10px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="font-size: 12px; color: var(--text-secondary);">Context Usage</span>
            <span style="font-size: 12px; color: ${contextColor}; font-weight: 600;">${contextPercent}%</span>
          </div>
          <div style="height: 8px; background: var(--bg-secondary); border-radius: 4px; overflow: hidden;">
            <div style="height: 100%; background: ${contextColor}; width: ${contextPercent}%; transition: width 0.3s;"></div>
          </div>
        </div>

        ${session.canCompact ? `
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-primary" onclick="dashboard.compactContext('${session.sessionId}')" style="flex: 1; padding: 6px 12px; font-size: 13px;">
              <span>🗜️</span>
              <span>Compact Context</span>
            </button>
            <button class="btn" onclick="dashboard.createCheckpoint('${session.sessionId}')" style="flex: 1; padding: 6px 12px; font-size: 13px;">
              <span>💾</span>
              <span>Checkpoint</span>
            </button>
          </div>
        ` : `
          <div style="text-align: center; color: var(--text-secondary); font-size: 12px;">
            Context too low for compaction (min 30%)
          </div>
        `}
      </div>
    `;
  }

  async compactContext(sessionId) {
    if (!confirm(`Compact context for session ${sessionId}? This will reset the context to 15%.`)) {
      return;
    }

    try {
      const response = await fetch(`${this.apiUrl}/api/context/compact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });

      const data = await response.json();

      if (data.success) {
        alert(`Context compacted from ${(data.originalContext * 100).toFixed(1)}% to ${(data.newContext * 100).toFixed(1)}%`);
        await this.loadContextStatus();
        await this.loadOverviewStats();
      }
    } catch (error) {
      console.error('Error compacting context:', error);
      alert('Failed to compact context');
    }
  }

  async createCheckpoint(sessionId) {
    const notes = prompt('Checkpoint notes (optional):');

    try {
      const response = await fetch(`${this.apiUrl}/api/sessions/${sessionId}/checkpoint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: notes || 'Manual checkpoint',
          stateSnapshot: {
            timestamp: Date.now(),
            source: 'dashboard'
          }
        })
      });

      const data = await response.json();

      if (data.success) {
        alert('Checkpoint created successfully');
      }
    } catch (error) {
      console.error('Error creating checkpoint:', error);
      alert('Failed to create checkpoint');
    }
  }

  renderSessionItem(session) {
    const duration = session.end_time ?
      this.formatDuration(session.end_time - session.start_time) :
      this.formatDuration(Math.floor(Date.now() / 1000) - session.start_time);

    return `
      <div class="session-item" onclick="dashboard.showSessionDetails('${session.id}')">
        <div class="session-info">
          <div class="session-id">${session.id}</div>
          <div class="session-meta">
            <span>Model: ${session.model_name}</span>
            <span>Duration: ${duration}</span>
            ${session.agent_persona ? `<span>Persona: ${session.agent_persona}</span>` : ''}
          </div>
        </div>
        <div class="session-stats">
          <span class="status-badge ${session.status}">${session.status}</span>
        </div>
      </div>
    `;
  }

  renderProjectWithSessions(project) {
    const formatTokens = (num) => {
      if (num > 1000000) return (num / 1000000).toFixed(1) + 'M';
      if (num > 1000) return (num / 1000).toFixed(1) + 'K';
      return num.toString();
    };

    const renderTodo = (todo) => {
      const statusIcons = {
        completed: '✓',
        'in_progress': '→',
        pending: '○'
      };
      return `
        <div class="todo-item">
          <div class="todo-status ${todo.status}">
            ${statusIcons[todo.status] || '○'}
          </div>
          <div class="todo-content">${todo.content || todo.task || 'Untitled task'}</div>
        </div>
      `;
    };

    const renderSession = (session) => {
      const duration = session.end_time ?
        this.formatDuration(session.end_time - session.start_time) :
        this.formatDuration(Math.floor(Date.now() / 1000) - session.start_time);

      const hasTodos = session.todos && session.todos.length > 0;

      return `
        <div class="nested-session">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div class="session-id" style="font-size: 13px;">${session.id}</div>
              <div class="session-meta" style="font-size: 12px; margin-top: 4px;">
                <span>${session.model_name || 'Unknown Model'}</span>
                <span>${duration}</span>
                <span>${formatTokens(session.total_tokens || 0)} tokens</span>
                <span class="status-badge ${session.status}" style="margin-left: 8px;">
                  ${session.status}
                </span>
              </div>
            </div>
            ${hasTodos ? `
              <button class="btn" onclick="dashboard.toggleSessionTodos('${session.id}')" style="padding: 4px 8px; font-size: 12px;">
                📝 ${session.todos.length} todos
              </button>
            ` : ''}
          </div>
          ${hasTodos ? `
            <div class="todo-list" id="todos-${session.id}" style="display: none; margin-top: 12px;">
              <div style="font-size: 12px; font-weight: 600; margin-bottom: 8px;">Session Tasks:</div>
              ${session.todos.map(todo => renderTodo(todo)).join('')}
            </div>
          ` : ''}
        </div>
      `;
    };

    const planSection = project.plan ? `
      <div class="plan-section">
        <div class="plan-title">📋 Project Plan</div>
        <div class="plan-content">${project.plan.description || project.plan.content || 'No plan details'}</div>
        ${project.plan.phases ? `
          <div style="margin-top: 8px;">
            <div style="font-size: 12px; font-weight: 600; margin-bottom: 4px;">Phases:</div>
            ${project.plan.phases.map(phase => `
              <div style="padding: 4px 8px; margin: 2px 0; background: var(--bg-primary); border-radius: 4px; font-size: 12px;">
                ${phase.name || phase}
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    ` : '';

    return `
      <div class="project-container">
        <div class="project-header">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-size: 16px; font-weight: 600;">
                📁 ${project.name || project.id}
              </div>
              <div class="session-meta" style="margin-top: 4px;">
                <span>${project.sessions.length} sessions</span>
                <span>${project.active_sessions} active</span>
                <span>${formatTokens(project.total_tokens)} tokens</span>
                <span>$${(project.total_cost || 0).toFixed(2)}</span>
              </div>
            </div>
            <div>
              <span class="status-badge ${project.active_sessions > 0 ? 'active' : 'completed'}">
                ${project.active_sessions > 0 ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
        </div>
        <div class="project-sessions">
          ${planSection}
          <div style="padding: 8px 0;">
            <div style="font-size: 14px; font-weight: 600; margin-bottom: 8px; padding: 0 8px;">Sessions:</div>
            ${project.sessions.map(session => renderSession(session)).join('')}
          </div>
        </div>
      </div>
    `;
  }

  toggleSessionTodos(sessionId) {
    const todosDiv = document.getElementById(`todos-${sessionId}`);
    if (todosDiv) {
      todosDiv.style.display = todosDiv.style.display === 'none' ? 'block' : 'none';
    }
  }

  renderAlertItem(alert) {
    const severityIcons = {
      info: 'ℹ️',
      warning: '⚠️',
      critical: '🚨'
    };

    return `
      <div class="alert-item">
        <div class="alert-icon ${alert.severity}">
          ${severityIcons[alert.severity] || 'ℹ️'}
        </div>
        <div class="alert-content">
          <div class="alert-message">${alert.message}</div>
        </div>
      </div>
    `;
  }

  renderEmptyState(message, hint) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <div class="empty-state-message">${message}</div>
        <div class="empty-state-hint">${hint}</div>
      </div>
    `;
  }

  setupCharts() {
    // Token usage chart
    const tokenCtx = document.getElementById('tokenChart');
    if (tokenCtx) {
      this.charts.tokens = new Chart(tokenCtx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'Tokens',
            data: [],
            borderColor: 'rgb(88, 166, 255)',
            backgroundColor: 'rgba(88, 166, 255, 0.1)',
            tension: 0.4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            y: {
              beginAtZero: true,
              grid: { color: '#30363d' },
              ticks: { color: '#8b949e' }
            },
            x: {
              grid: { color: '#30363d' },
              ticks: { color: '#8b949e' }
            }
          }
        }
      });
    }

    // Context usage chart
    const contextCtx = document.getElementById('contextChart');
    if (contextCtx) {
      this.charts.context = new Chart(contextCtx, {
        type: 'bar',
        data: {
          labels: ['0-25%', '25-50%', '50-70%', '70-80%', '80-90%', '90-100%'],
          datasets: [{
            label: 'Sessions',
            data: [0, 0, 0, 0, 0, 0],
            backgroundColor: [
              '#3fb950',
              '#3fb950',
              '#d29922',
              '#e8630a',
              '#f85149',
              '#f85149'
            ]
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            y: {
              beginAtZero: true,
              grid: { color: '#30363d' },
              ticks: { color: '#8b949e' }
            },
            x: {
              grid: { display: false },
              ticks: { color: '#8b949e' }
            }
          }
        }
      });
    }

    // Cost chart
    const costCtx = document.getElementById('costChart');
    if (costCtx) {
      this.charts.cost = new Chart(costCtx, {
        type: 'doughnut',
        data: {
          labels: [],
          datasets: [{
            data: [],
            backgroundColor: [
              '#58a6ff',
              '#3fb950',
              '#d29922',
              '#f85149'
            ]
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: '#8b949e' }
            }
          }
        }
      });
    }
  }

  async updateTrendsChart(period = '24h') {
    try {
      const response = await fetch(`${this.apiUrl}/api/analytics/trends?period=${period}`);
      const data = await response.json();

      if (this.charts.tokens && data.trends) {
        const labels = data.trends.map(t => this.formatDate(t.timestamp));
        const values = data.trends.map(t => t.avg_tokens);

        this.charts.tokens.data.labels = labels;
        this.charts.tokens.data.datasets[0].data = values;
        this.charts.tokens.update();
      }
    } catch (error) {
      console.error('Error updating trends chart:', error);
    }
  }

  async updateAnalyticsCharts() {
    // Update analytics charts with real data
    await this.updateTrendsChart('24h');
  }

  showNewSessionModal() {
    document.getElementById('newSessionModal').classList.add('active');
  }

  closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
  }

  async startNewSession() {
    const sessionData = {
      sessionId: document.getElementById('sessionId').value,
      projectId: document.getElementById('projectId').value,
      agentPersona: document.getElementById('agentPersona').value,
      modelName: document.getElementById('modelName').value
    };

    try {
      const response = await fetch(`${this.apiUrl}/api/sessions/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sessionData)
      });

      if (response.ok) {
        this.closeModal('newSessionModal');
        await this.refreshData();
      } else {
        const error = await response.json();
        this.showNotification(`Error: ${error.error}`, 'danger');
      }
    } catch (error) {
      console.error('Error starting session:', error);
      this.showNotification('Failed to start session', 'danger');
    }
  }

  async showSessionDetails(sessionId) {
    try {
      const response = await fetch(`${this.apiUrl}/api/sessions/${sessionId}`);
      const data = await response.json();

      this.currentSession = data.session;

      const content = `
        <div class="session-details">
          <div class="form-group">
            <label class="form-label">Session ID</label>
            <div class="text-muted">${data.session.id}</div>
          </div>
          <div class="form-group">
            <label class="form-label">Model</label>
            <div class="text-muted">${data.session.model_name}</div>
          </div>
          <div class="form-group">
            <label class="form-label">Status</label>
            <div><span class="status-badge ${data.session.status}">${data.session.status}</span></div>
          </div>
          <div class="form-group">
            <label class="form-label">Total Tokens</label>
            <div class="text-muted">${this.formatNumber(data.session.total_tokens || 0)}</div>
          </div>
          <div class="form-group">
            <label class="form-label">Total Cost</label>
            <div class="text-muted">${this.formatCurrency(data.session.total_cost || 0)}</div>
          </div>
        </div>
      `;

      document.getElementById('sessionDetailsContent').innerHTML = content;
      document.getElementById('sessionDetailsModal').classList.add('active');
    } catch (error) {
      console.error('Error loading session details:', error);
    }
  }

  async exportCurrentSession() {
    if (!this.currentSession) return;
    window.open(`${this.apiUrl}/api/sessions/${this.currentSession.id}/export?format=json`, '_blank');
  }

  async endCurrentSession() {
    if (!this.currentSession) return;

    if (!confirm('Are you sure you want to end this session?')) return;

    try {
      const response = await fetch(`${this.apiUrl}/api/sessions/${this.currentSession.id}/end`, {
        method: 'POST'
      });

      if (response.ok) {
        this.closeModal('sessionDetailsModal');
        this.showNotification('Session ended successfully', 'success');
        await this.refreshData();
      }
    } catch (error) {
      console.error('Error ending session:', error);
      this.showNotification('Failed to end session', 'danger');
    }
  }

  showNotification(message, type = 'info') {
    // Simple notification
    console.log(`[${type.toUpperCase()}] ${message}`);
  }

  formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toLocaleString();
  }

  formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 4
    }).format(amount);
  }

  formatPercentage(value) {
    return (value * 100).toFixed(1) + '%';
  }

  formatDate(timestamp) {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString();
  }

  formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
  }

  destroy() {
    if (this.ws) this.ws.close();
    if (this.refreshInterval) clearInterval(this.refreshInterval);
  }
}

// Initialize dashboard
const dashboard = new Dashboard();