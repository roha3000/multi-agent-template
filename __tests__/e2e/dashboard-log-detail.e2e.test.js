/**
 * E2E Tests for Dashboard Log Detail Modal
 *
 * Tests the log detail modal functionality including:
 * - Modal HTML structure
 * - Opening and closing behavior
 * - Content rendering for different tool types
 *
 * @module __tests__/e2e/dashboard-log-detail.e2e
 */

const fs = require('fs');
const path = require('path');

const dashboardPath = path.join(__dirname, '../../global-dashboard.html');
const dashboardHtml = fs.readFileSync(dashboardPath, 'utf8');

describe('Dashboard Log Detail Modal', () => {
  describe('Modal HTML Structure', () => {
    it('should have the log detail modal element', () => {
      expect(dashboardHtml).toContain('id="logDetailModal"');
    });

    it('should have the modal overlay class for click-to-close', () => {
      expect(dashboardHtml).toContain('class="modal-overlay" id="logDetailModal"');
    });

    it('should have onclick handler on overlay to close', () => {
      expect(dashboardHtml).toContain('onclick="closeLogDetailModal(event)"');
    });

    it('should have the modal title element', () => {
      expect(dashboardHtml).toContain('id="logDetailTitle"');
    });

    it('should have the modal body element', () => {
      expect(dashboardHtml).toContain('id="logDetailBody"');
    });

    it('should have a close button', () => {
      expect(dashboardHtml).toMatch(/class="modal-close"[^>]*onclick="closeLogDetailModal\(\)"/);
    });

    it('should prevent click propagation on modal content', () => {
      expect(dashboardHtml).toContain('onclick="event.stopPropagation()"');
    });
  });

  describe('Modal JavaScript Functions', () => {
    it('should define openLogDetailModal function', () => {
      expect(dashboardHtml).toContain('function openLogDetailModal(entry)');
    });

    it('should define closeLogDetailModal function', () => {
      expect(dashboardHtml).toContain('function closeLogDetailModal(event)');
    });

    it('should check for modal and title elements in openLogDetailModal', () => {
      const match = dashboardHtml.match(/function openLogDetailModal[\s\S]*?function closeLogDetailModal/);
      expect(match).toBeTruthy();
      const funcBody = match[0];
      expect(funcBody).toContain('getElementById(\'logDetailModal\')');
      expect(funcBody).toContain('getElementById(\'logDetailTitle\')');
      expect(funcBody).toContain('getElementById(\'logDetailBody\')');
    });

    it('should add open class when opening modal', () => {
      expect(dashboardHtml).toContain('modal.classList.add(\'open\')');
    });

    it('should remove open class when closing modal', () => {
      expect(dashboardHtml).toContain('modal.classList.remove(\'open\')');
    });

    it('should handle entry.detail object for detailed view', () => {
      expect(dashboardHtml).toContain('entry.detail');
      expect(dashboardHtml).toContain('Object.keys(entry.detail)');
    });

    it('should display timestamp in modal', () => {
      const match = dashboardHtml.match(/function openLogDetailModal[\s\S]*?function closeLogDetailModal/);
      expect(match[0]).toContain('Timestamp');
      expect(match[0]).toContain('toLocaleString()');
    });

    it('should display summary in modal', () => {
      const match = dashboardHtml.match(/function openLogDetailModal[\s\S]*?function closeLogDetailModal/);
      expect(match[0]).toContain('Summary');
      expect(match[0]).toContain('entry.summary');
    });

    it('should format long values with pre blocks', () => {
      expect(dashboardHtml).toContain('isLongValue');
      expect(dashboardHtml).toContain('<pre style=');
    });

    it('should escape HTML in displayed values', () => {
      const match = dashboardHtml.match(/function openLogDetailModal[\s\S]*?function closeLogDetailModal/);
      expect(match[0]).toContain('escapeHtml');
    });
  });

  describe('Activity Table Row Behavior', () => {
    it('should store activity entries in array', () => {
      expect(dashboardHtml).toContain('let activityEntries = []');
    });

    it('should add double-click handler to rows', () => {
      expect(dashboardHtml).toContain('ondblclick="openLogDetailModal(activityEntries[');
    });

    it('should show pointer cursor on rows', () => {
      expect(dashboardHtml).toContain('style="cursor:pointer;"');
    });

    it('should add single-click handler for row selection', () => {
      expect(dashboardHtml).toContain('onclick="selectLogEntry(');
    });

    it('should define selectLogEntry function', () => {
      expect(dashboardHtml).toContain('function selectLogEntry(index)');
    });

    it('should handle SSE stream entries with click handlers', () => {
      expect(dashboardHtml).toContain('tr.onclick = () => selectLogEntry(0)');
      expect(dashboardHtml).toContain('tr.ondblclick = () => openLogDetailModal(activityEntries[0])');
    });

    it('should store SSE entries in activityEntries array', () => {
      expect(dashboardHtml).toContain('activityEntries.unshift(data.entry)');
    });

    it('should limit stored entries to 50', () => {
      expect(dashboardHtml).toContain('if (activityEntries.length > 50) activityEntries.pop()');
    });

    it('should shift selected index when new entries arrive', () => {
      expect(dashboardHtml).toContain('if (selectedLogIndex >= 0)');
      expect(dashboardHtml).toContain('selectedLogIndex++');
    });

    it('should re-apply selection highlight after new entries', () => {
      expect(dashboardHtml).toContain('Re-apply selection highlight');
    });
  });

  describe('Side Panel Layout', () => {
    it('should have split-pane layout with flexbox', () => {
      expect(dashboardHtml).toContain('display:flex;gap:12px;height:100%');
    });

    it('should have log detail panel element', () => {
      expect(dashboardHtml).toContain('id="log-detail-panel"');
    });

    it('should have log detail content element', () => {
      expect(dashboardHtml).toContain('id="log-detail-content"');
    });

    it('should show placeholder text when no entry selected', () => {
      expect(dashboardHtml).toContain('Select a log entry to view details');
    });

    it('should define showLogDetail function', () => {
      expect(dashboardHtml).toContain('function showLogDetail(entry)');
    });

    it('should update panel content in showLogDetail', () => {
      expect(dashboardHtml).toContain("getElementById('log-detail-content')");
    });

    it('should track selected log index', () => {
      expect(dashboardHtml).toContain('let selectedLogIndex = -1');
    });

    it('should highlight selected row', () => {
      expect(dashboardHtml).toContain("style.background = i === index ? 'var(--bg-secondary)' : ''");
    });
  });

  describe('Entry Detail Fields Support', () => {
    it('should iterate over detail entries', () => {
      expect(dashboardHtml).toContain('Object.entries(entry.detail)');
    });

    it('should handle object values with JSON.stringify', () => {
      expect(dashboardHtml).toContain('JSON.stringify(value, null, 2)');
    });

    it('should detect long values for special formatting', () => {
      // Modal uses 100, side panel uses 80
      expect(dashboardHtml).toMatch(/displayValue\.length > (80|100)/);
      expect(dashboardHtml).toContain('displayValue.includes(\'\\n\')');
    });

    it('should show message when no details available', () => {
      expect(dashboardHtml).toContain('No additional details available');
    });
  });
});

describe('Track Progress Hook Detail Field', () => {
  const hookPath = path.join(__dirname, '../../.claude/hooks/track-progress.js');
  const hookSource = fs.readFileSync(hookPath, 'utf8');

  it('should define getToolDetail function', () => {
    expect(hookSource).toContain('function getToolDetail(toolName, toolInput, toolResponse)');
  });

  it('should include detail field in log entry', () => {
    expect(hookSource).toContain('detail: detail');
  });

  it('should call getToolDetail when processing tool data', () => {
    expect(hookSource).toContain('const detail = getToolDetail(toolName, data.tool_input, data.tool_response)');
  });

  it('should cap detail content at 5KB', () => {
    expect(hookSource).toContain('maxDetailLen = 5000');
  });

  it('should handle all major tool types', () => {
    const expectedTools = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Task', 'WebFetch', 'WebSearch', 'TodoWrite'];
    expectedTools.forEach(tool => {
      expect(hookSource).toContain(`case '${tool}':`);
    });
  });

  it('should remove undefined and null values from detail', () => {
    expect(hookSource).toContain('if (detail[k] === undefined || detail[k] === null) delete detail[k]');
  });
});
