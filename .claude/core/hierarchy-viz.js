/**
 * Hierarchy Visualization Component
 *
 * Provides interactive tree visualization for agent hierarchies.
 * Integrates with the global dashboard for real-time updates.
 *
 * @module hierarchy-viz
 */

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

const HierarchyTreeState = {
  rootNode: null,
  nodeMap: new Map(),
  selectedNodeId: null,
  expandedNodeIds: new Set(),
  onNodeSelect: null,
  onNodeExpand: null,

  reset() {
    this.rootNode = null;
    this.nodeMap.clear();
    this.selectedNodeId = null;
    this.expandedNodeIds.clear();
  },

  registerNode(node) {
    this.nodeMap.set(node.id, node);
  },

  getNode(nodeId) {
    return this.nodeMap.get(nodeId);
  }
};

// ============================================================================
// TREE BUILDING
// ============================================================================

/**
 * Builds a hierarchy tree from the session hierarchy API
 * @param {string} sessionId - Session ID to fetch hierarchy for
 * @returns {Promise<Object|null>} Root node of the tree
 */
async function buildHierarchyTree(sessionId) {
  HierarchyTreeState.reset();

  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/hierarchy`);

    if (!response.ok) {
      if (response.status === 404) {
        return createEmptyTreeNode(sessionId);
      }
      throw new Error(`API error: ${response.status}`);
    }

    const hierarchyData = await response.json();
    const rootNode = transformApiResponseToTree(hierarchyData, null, 0);

    HierarchyTreeState.rootNode = rootNode;
    HierarchyTreeState.expandedNodeIds.add(rootNode.id);

    return rootNode;
  } catch (error) {
    console.error('Failed to build hierarchy tree:', error);
    return createErrorTreeNode(sessionId, error.message);
  }
}

function transformApiResponseToTree(apiNode, parentId, depth) {
  const node = {
    id: apiNode.id || apiNode.agentId || generateNodeId(),
    name: apiNode.name || apiNode.persona || apiNode.agentId || 'Unknown Agent',
    type: determineNodeType(apiNode),
    status: normalizeStatus(apiNode.status),
    children: [],
    parentId: parentId,
    collapsed: depth > 1,
    selected: false,
    depth: depth,
    metrics: extractMetrics(apiNode)
  };

  HierarchyTreeState.registerNode(node);

  const childNodes = apiNode.children || apiNode.delegates || apiNode.subAgents || [];
  node.children = childNodes.map(child =>
    transformApiResponseToTree(child, node.id, depth + 1)
  );

  return node;
}

function determineNodeType(apiNode) {
  if (apiNode.type) return apiNode.type;
  if (apiNode.isRoot || apiNode.depth === 0) return 'root';
  if (apiNode.sessionId && !apiNode.agentId) return 'session';
  return 'agent';
}

function normalizeStatus(status) {
  const statusMap = {
    'running': 'active',
    'in_progress': 'active',
    'success': 'completed',
    'done': 'completed',
    'error': 'failed',
    'waiting': 'pending',
    'queued': 'pending'
  };
  return statusMap[status] || status || 'idle';
}

function extractMetrics(apiNode) {
  const metrics = apiNode.metrics || {};
  return {
    tokensUsed: metrics.tokensUsed || metrics.tokens || 0,
    qualityScore: metrics.qualityScore || metrics.quality || 0,
    durationMs: metrics.durationMs || metrics.duration || 0,
    taskCount: metrics.taskCount || metrics.tasks || 0,
    delegationCount: metrics.delegationCount || (apiNode.children || []).length
  };
}

function createEmptyTreeNode(sessionId) {
  const node = {
    id: sessionId,
    name: 'No Hierarchy Data',
    type: 'root',
    status: 'idle',
    children: [],
    parentId: null,
    collapsed: false,
    selected: false,
    depth: 0,
    metrics: { tokensUsed: 0, qualityScore: 0, durationMs: 0, taskCount: 0, delegationCount: 0 }
  };
  HierarchyTreeState.registerNode(node);
  HierarchyTreeState.rootNode = node;
  return node;
}

function createErrorTreeNode(sessionId, errorMessage) {
  const node = {
    id: sessionId,
    name: `Error: ${errorMessage}`,
    type: 'root',
    status: 'failed',
    children: [],
    parentId: null,
    collapsed: false,
    selected: false,
    depth: 0,
    metrics: { tokensUsed: 0, qualityScore: 0, durationMs: 0, taskCount: 0, delegationCount: 0 }
  };
  HierarchyTreeState.registerNode(node);
  HierarchyTreeState.rootNode = node;
  return node;
}

function generateNodeId() {
  return `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ============================================================================
// TREE RENDERING
// ============================================================================

/**
 * Renders the hierarchy tree into a container element
 * @param {Object} treeData - Root node of the tree
 * @param {HTMLElement} container - Container element
 * @param {Object} options - Rendering options
 */
function renderHierarchyTree(treeData, container, options = {}) {
  const { showMetrics = true, animated = true } = options;

  container.innerHTML = '';

  if (!treeData) {
    container.innerHTML = `
      <div class="hierarchy-empty">
        <div class="hierarchy-empty-icon">📊</div>
        <div class="hierarchy-empty-text">No hierarchy data available</div>
      </div>
    `;
    return;
  }

  const treeWrapper = document.createElement('div');
  treeWrapper.className = 'hierarchy-tree';
  if (animated) treeWrapper.classList.add('hierarchy-tree--animated');

  const treeHtml = renderTreeNode(treeData, showMetrics);
  treeWrapper.innerHTML = treeHtml;

  container.appendChild(treeWrapper);
  attachTreeEventListeners(container);
}

function renderTreeNode(node, showMetrics) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = HierarchyTreeState.expandedNodeIds.has(node.id);
  const isSelected = HierarchyTreeState.selectedNodeId === node.id;

  const nodeClasses = [
    'hierarchy-tree__node',
    `hierarchy-tree__node--${node.type}`,
    `hierarchy-tree__node--${node.status}`,
    hasChildren ? 'hierarchy-tree__node--has-children' : '',
    isExpanded ? 'hierarchy-tree__node--expanded' : 'hierarchy-tree__node--collapsed',
    isSelected ? 'hierarchy-tree__node--selected' : ''
  ].filter(Boolean).join(' ');

  const nodeContent = `
    <div class="${nodeClasses}"
         data-node-id="${escapeHtml(node.id)}"
         data-depth="${node.depth}">

      <div class="hierarchy-tree__node-row">
        ${hasChildren ? `
          <button class="hierarchy-tree__toggle"
                  data-action="toggle"
                  data-node-id="${escapeHtml(node.id)}">
            <span class="hierarchy-tree__toggle-icon">${isExpanded ? '▼' : '▶'}</span>
          </button>
        ` : `
          <span class="hierarchy-tree__toggle-placeholder"></span>
        `}

        <span class="hierarchy-tree__status-dot hierarchy-tree__status-dot--${node.status}"></span>

        <span class="hierarchy-tree__icon hierarchy-tree__icon--${node.type}">
          ${getNodeIcon(node.type)}
        </span>

        <span class="hierarchy-tree__name"
              data-action="select"
              data-node-id="${escapeHtml(node.id)}">
          ${escapeHtml(node.name)}
        </span>

        ${showMetrics ? renderInlineMetrics(node.metrics) : ''}

        ${hasChildren ? `
          <span class="hierarchy-tree__badge">${node.children.length}</span>
        ` : ''}
      </div>

      ${hasChildren ? `
        <div class="hierarchy-tree__children"
             style="display: ${isExpanded ? 'block' : 'none'}">
          ${node.children.map(child => renderTreeNode(child, showMetrics)).join('')}
        </div>
      ` : ''}
    </div>
  `;

  return nodeContent;
}

function renderInlineMetrics(metrics) {
  if (!metrics || (metrics.tokensUsed === 0 && metrics.qualityScore === 0)) {
    return '';
  }

  const qualityClass = getQualityClass(metrics.qualityScore);
  const duration = formatDuration(metrics.durationMs);
  const tokens = formatNumber(metrics.tokensUsed);

  return `
    <span class="hierarchy-tree__metrics">
      ${metrics.tokensUsed > 0 ? `
        <span class="hierarchy-tree__metric hierarchy-tree__metric--tokens" title="Tokens Used">
          <span class="hierarchy-tree__metric-icon">⚡</span>
          <span class="hierarchy-tree__metric-value">${tokens}</span>
        </span>
      ` : ''}
      ${metrics.qualityScore > 0 ? `
        <span class="hierarchy-tree__metric hierarchy-tree__metric--quality ${qualityClass}" title="Quality Score">
          <span class="hierarchy-tree__metric-icon">★</span>
          <span class="hierarchy-tree__metric-value">${metrics.qualityScore}</span>
        </span>
      ` : ''}
      ${metrics.durationMs > 0 ? `
        <span class="hierarchy-tree__metric hierarchy-tree__metric--duration" title="Duration">
          <span class="hierarchy-tree__metric-icon">⏱</span>
          <span class="hierarchy-tree__metric-value">${duration}</span>
        </span>
      ` : ''}
    </span>
  `;
}

function getNodeIcon(type) {
  const icons = { root: '🏠', session: '📋', agent: '🤖' };
  return icons[type] || '📄';
}

function getQualityClass(score) {
  if (score >= 90) return 'hierarchy-tree__metric--quality-excellent';
  if (score >= 80) return 'hierarchy-tree__metric--quality-good';
  if (score >= 60) return 'hierarchy-tree__metric--quality-fair';
  return 'hierarchy-tree__metric--quality-poor';
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

function formatNumber(num) {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

function attachTreeEventListeners(container) {
  container.addEventListener('click', handleTreeClick);
}

function handleTreeClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;

  const action = target.dataset.action;
  const nodeId = target.dataset.nodeId;

  if (!nodeId) return;

  switch (action) {
    case 'toggle':
      toggleTreeNode(nodeId);
      break;
    case 'select':
      selectTreeNode(nodeId);
      break;
  }
}

function toggleTreeNode(nodeId) {
  const node = HierarchyTreeState.getNode(nodeId);
  if (!node || !node.children || node.children.length === 0) return;

  const isCurrentlyExpanded = HierarchyTreeState.expandedNodeIds.has(nodeId);

  if (isCurrentlyExpanded) {
    HierarchyTreeState.expandedNodeIds.delete(nodeId);
  } else {
    HierarchyTreeState.expandedNodeIds.add(nodeId);
  }

  const nodeElement = document.querySelector(`[data-node-id="${nodeId}"]`);
  if (nodeElement) {
    const isExpanded = HierarchyTreeState.expandedNodeIds.has(nodeId);

    nodeElement.classList.toggle('hierarchy-tree__node--expanded', isExpanded);
    nodeElement.classList.toggle('hierarchy-tree__node--collapsed', !isExpanded);

    const toggleIcon = nodeElement.querySelector('.hierarchy-tree__toggle-icon');
    if (toggleIcon) {
      toggleIcon.textContent = isExpanded ? '▼' : '▶';
    }

    const childrenContainer = nodeElement.querySelector(':scope > .hierarchy-tree__children');
    if (childrenContainer) {
      childrenContainer.style.display = isExpanded ? 'block' : 'none';
    }
  }

  if (HierarchyTreeState.onNodeExpand) {
    HierarchyTreeState.onNodeExpand(nodeId, HierarchyTreeState.expandedNodeIds.has(nodeId));
  }
}

function selectTreeNode(nodeId) {
  const node = HierarchyTreeState.getNode(nodeId);
  if (!node) return;

  const previouslySelectedId = HierarchyTreeState.selectedNodeId;
  HierarchyTreeState.selectedNodeId = nodeId;

  if (previouslySelectedId) {
    const previousElement = document.querySelector(`[data-node-id="${previouslySelectedId}"]`);
    if (previousElement) {
      previousElement.classList.remove('hierarchy-tree__node--selected');
    }
  }

  const nodeElement = document.querySelector(`[data-node-id="${nodeId}"]`);
  if (nodeElement) {
    nodeElement.classList.add('hierarchy-tree__node--selected');
  }

  if (HierarchyTreeState.onNodeSelect) {
    HierarchyTreeState.onNodeSelect(node);
  }
}

function expandAllNodes() {
  HierarchyTreeState.nodeMap.forEach((node, id) => {
    if (node.children && node.children.length > 0) {
      if (!HierarchyTreeState.expandedNodeIds.has(id)) {
        toggleTreeNode(id);
      }
    }
  });
}

function collapseAllNodes() {
  HierarchyTreeState.nodeMap.forEach((node, id) => {
    if (node.depth > 0 && HierarchyTreeState.expandedNodeIds.has(id)) {
      toggleTreeNode(id);
    }
  });
}

// ============================================================================
// PUBLIC API
// ============================================================================

if (typeof window !== 'undefined') {
  window.HierarchyTree = {
    state: HierarchyTreeState,
    build: buildHierarchyTree,
    render: renderHierarchyTree,
    toggle: toggleTreeNode,
    select: selectTreeNode,
    expandAll: expandAllNodes,
    collapseAll: collapseAllNodes,
    onSelect: (callback) => { HierarchyTreeState.onNodeSelect = callback; },
    onExpand: (callback) => { HierarchyTreeState.onNodeExpand = callback; }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    HierarchyTreeState,
    buildHierarchyTree,
    renderHierarchyTree,
    toggleTreeNode,
    selectTreeNode,
    expandAllNodes,
    collapseAllNodes
  };
}
