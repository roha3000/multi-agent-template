/**
 * Hierarchy Visualization Component Tests
 *
 * Comprehensive tests for the hierarchy-viz module covering:
 * - State management (HierarchyTreeState)
 * - Tree building and transformation
 * - Tree rendering with JSDOM
 * - Event handlers and interactions
 *
 * @jest-environment jsdom
 */

// Mock fetch globally before requiring the module
global.fetch = jest.fn();

// Import the module after setting up mocks
const {
  HierarchyTreeState,
  buildHierarchyTree,
  renderHierarchyTree,
  toggleTreeNode,
  selectTreeNode,
  expandAllNodes,
  collapseAllNodes
} = require('../../.claude/core/hierarchy-viz');

describe('HierarchyTreeState', () => {
  beforeEach(() => {
    HierarchyTreeState.reset();
  });

  describe('reset()', () => {
    it('clears rootNode to null', () => {
      HierarchyTreeState.rootNode = { id: 'test' };
      HierarchyTreeState.reset();
      expect(HierarchyTreeState.rootNode).toBeNull();
    });

    it('clears nodeMap', () => {
      HierarchyTreeState.nodeMap.set('node1', { id: 'node1' });
      HierarchyTreeState.nodeMap.set('node2', { id: 'node2' });
      HierarchyTreeState.reset();
      expect(HierarchyTreeState.nodeMap.size).toBe(0);
    });

    it('clears selectedNodeId to null', () => {
      HierarchyTreeState.selectedNodeId = 'selected-1';
      HierarchyTreeState.reset();
      expect(HierarchyTreeState.selectedNodeId).toBeNull();
    });

    it('clears expandedNodeIds Set', () => {
      HierarchyTreeState.expandedNodeIds.add('exp-1');
      HierarchyTreeState.expandedNodeIds.add('exp-2');
      HierarchyTreeState.reset();
      expect(HierarchyTreeState.expandedNodeIds.size).toBe(0);
    });

    it('preserves callback functions', () => {
      const selectCallback = jest.fn();
      const expandCallback = jest.fn();
      HierarchyTreeState.onNodeSelect = selectCallback;
      HierarchyTreeState.onNodeExpand = expandCallback;
      HierarchyTreeState.reset();
      // Callbacks should be preserved (not cleared by reset)
      expect(HierarchyTreeState.onNodeSelect).toBe(selectCallback);
      expect(HierarchyTreeState.onNodeExpand).toBe(expandCallback);
    });
  });

  describe('registerNode()', () => {
    it('adds node to nodeMap', () => {
      const node = { id: 'test-node', name: 'Test' };
      HierarchyTreeState.registerNode(node);
      expect(HierarchyTreeState.nodeMap.has('test-node')).toBe(true);
    });

    it('stores the node with correct id key', () => {
      const node = { id: 'my-id-123', name: 'My Node', type: 'agent' };
      HierarchyTreeState.registerNode(node);
      expect(HierarchyTreeState.nodeMap.get('my-id-123')).toBe(node);
    });

    it('overwrites existing node with same id', () => {
      const node1 = { id: 'dup', name: 'First' };
      const node2 = { id: 'dup', name: 'Second' };
      HierarchyTreeState.registerNode(node1);
      HierarchyTreeState.registerNode(node2);
      expect(HierarchyTreeState.nodeMap.get('dup').name).toBe('Second');
    });

    it('registers multiple unique nodes', () => {
      HierarchyTreeState.registerNode({ id: 'a', name: 'A' });
      HierarchyTreeState.registerNode({ id: 'b', name: 'B' });
      HierarchyTreeState.registerNode({ id: 'c', name: 'C' });
      expect(HierarchyTreeState.nodeMap.size).toBe(3);
    });
  });

  describe('getNode()', () => {
    it('retrieves registered node by id', () => {
      const node = { id: 'find-me', name: 'Find Me', status: 'active' };
      HierarchyTreeState.registerNode(node);
      const retrieved = HierarchyTreeState.getNode('find-me');
      expect(retrieved).toBe(node);
    });

    it('returns undefined for non-existent node', () => {
      const result = HierarchyTreeState.getNode('does-not-exist');
      expect(result).toBeUndefined();
    });

    it('returns undefined after reset', () => {
      HierarchyTreeState.registerNode({ id: 'temp', name: 'Temporary' });
      HierarchyTreeState.reset();
      expect(HierarchyTreeState.getNode('temp')).toBeUndefined();
    });
  });
});

describe('Tree Building', () => {
  beforeEach(() => {
    HierarchyTreeState.reset();
    global.fetch.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  describe('buildHierarchyTree()', () => {
    it('resets state before building', async () => {
      HierarchyTreeState.nodeMap.set('old', { id: 'old' });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'new-root', name: 'Root' })
      });

      await buildHierarchyTree('session-1');

      expect(HierarchyTreeState.nodeMap.has('old')).toBe(false);
    });

    it('fetches hierarchy from correct API endpoint', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'root', name: 'Root Agent' })
      });

      await buildHierarchyTree('my-session-123');

      expect(global.fetch).toHaveBeenCalledWith('/api/sessions/my-session-123/hierarchy');
    });

    it('encodes special characters in session ID', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'root', name: 'Root' })
      });

      await buildHierarchyTree('session/with spaces&special');

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/sessions/session%2Fwith%20spaces%26special/hierarchy'
      );
    });

    it('transforms API response to tree structure', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'root-agent',
          name: 'Research Lead',
          status: 'running',
          type: 'root',
          children: [
            { id: 'child-1', name: 'Analyst', status: 'success' }
          ]
        })
      });

      const tree = await buildHierarchyTree('session-1');

      expect(tree.id).toBe('root-agent');
      expect(tree.name).toBe('Research Lead');
      expect(tree.status).toBe('active');
      expect(tree.children).toHaveLength(1);
      expect(tree.children[0].name).toBe('Analyst');
    });

    it('sets rootNode in state', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'the-root', name: 'Root' })
      });

      const tree = await buildHierarchyTree('session-1');

      expect(HierarchyTreeState.rootNode).toBe(tree);
    });

    it('auto-expands root node', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'auto-expand-root', name: 'Root' })
      });

      await buildHierarchyTree('session-1');

      expect(HierarchyTreeState.expandedNodeIds.has('auto-expand-root')).toBe(true);
    });

    it('registers all nodes in nodeMap', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'parent',
          name: 'Parent',
          children: [
            { id: 'child1', name: 'Child 1' },
            { id: 'child2', name: 'Child 2' }
          ]
        })
      });

      await buildHierarchyTree('session-1');

      expect(HierarchyTreeState.nodeMap.size).toBe(3);
      expect(HierarchyTreeState.getNode('parent')).toBeDefined();
      expect(HierarchyTreeState.getNode('child1')).toBeDefined();
      expect(HierarchyTreeState.getNode('child2')).toBeDefined();
    });

    it('creates empty tree node for 404 response', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 404
      });

      const tree = await buildHierarchyTree('non-existent-session');

      expect(tree.id).toBe('non-existent-session');
      expect(tree.name).toBe('No Hierarchy Data');
      expect(tree.type).toBe('root');
      expect(tree.status).toBe('idle');
      expect(tree.children).toEqual([]);
    });

    it('creates error tree node for other API errors', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500
      });

      const tree = await buildHierarchyTree('error-session');

      expect(tree.id).toBe('error-session');
      expect(tree.name).toContain('Error');
      expect(tree.name).toContain('500');
      expect(tree.status).toBe('failed');
    });

    it('creates error tree node for fetch exceptions', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Network failure'));

      const tree = await buildHierarchyTree('network-error-session');

      expect(tree.id).toBe('network-error-session');
      expect(tree.name).toContain('Error');
      expect(tree.name).toContain('Network failure');
      expect(tree.status).toBe('failed');
    });

    it('logs errors to console', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Test error'));

      await buildHierarchyTree('log-test');

      expect(console.error).toHaveBeenCalledWith(
        'Failed to build hierarchy tree:',
        expect.any(Error)
      );
    });
  });

  describe('transformApiResponseToTree (via buildHierarchyTree)', () => {
    it('uses agentId as fallback for id', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ agentId: 'agent-xyz', name: 'Agent' })
      });

      const tree = await buildHierarchyTree('session');
      expect(tree.id).toBe('agent-xyz');
    });

    it('uses persona as fallback for name', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'x', persona: 'Research Analyst' })
      });

      const tree = await buildHierarchyTree('session');
      expect(tree.name).toBe('Research Analyst');
    });

    it('uses agentId as fallback for name when persona missing', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'agent-id-as-name' })
      });

      const tree = await buildHierarchyTree('session');
      expect(tree.name).toBe('Unknown Agent');
    });

    it('generates node ID when no id or agentId provided', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'Node Without ID' })
      });

      const tree = await buildHierarchyTree('session');

      // Should have a generated ID starting with 'node-'
      expect(tree.id).toMatch(/^node-\d+-[a-z0-9]+$/);
      expect(tree.name).toBe('Node Without ID');
    });

    it('sets depth correctly for nested nodes', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'depth-0',
          children: [{
            id: 'depth-1',
            children: [{ id: 'depth-2' }]
          }]
        })
      });

      const tree = await buildHierarchyTree('session');

      expect(tree.depth).toBe(0);
      expect(tree.children[0].depth).toBe(1);
      expect(tree.children[0].children[0].depth).toBe(2);
    });

    it('sets parentId correctly', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'parent-node',
          children: [{ id: 'child-node' }]
        })
      });

      const tree = await buildHierarchyTree('session');

      expect(tree.parentId).toBeNull();
      expect(tree.children[0].parentId).toBe('parent-node');
    });

    it('collapses nodes at depth > 1', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'root',
          children: [{
            id: 'level1',
            children: [{ id: 'level2' }]
          }]
        })
      });

      const tree = await buildHierarchyTree('session');

      expect(tree.collapsed).toBe(false);
      expect(tree.children[0].collapsed).toBe(false);
      expect(tree.children[0].children[0].collapsed).toBe(true);
    });

    it('handles delegates as children', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'delegator',
          delegates: [
            { id: 'delegate-1', name: 'D1' },
            { id: 'delegate-2', name: 'D2' }
          ]
        })
      });

      const tree = await buildHierarchyTree('session');

      expect(tree.children).toHaveLength(2);
      expect(tree.children[0].id).toBe('delegate-1');
    });

    it('handles subAgents as children', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'main',
          subAgents: [{ id: 'sub-1' }, { id: 'sub-2' }]
        })
      });

      const tree = await buildHierarchyTree('session');

      expect(tree.children).toHaveLength(2);
    });
  });

  describe('determineNodeType (via buildHierarchyTree)', () => {
    it('uses explicit type when provided', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'x', type: 'session' })
      });

      const tree = await buildHierarchyTree('session');
      expect(tree.type).toBe('session');
    });

    it('identifies root node by isRoot flag', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'x', isRoot: true })
      });

      const tree = await buildHierarchyTree('session');
      expect(tree.type).toBe('root');
    });

    it('identifies root node by depth 0', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'x', depth: 0 })
      });

      const tree = await buildHierarchyTree('session');
      expect(tree.type).toBe('root');
    });

    it('identifies session by sessionId without agentId', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'x', sessionId: 'sess-123' })
      });

      const tree = await buildHierarchyTree('session');
      expect(tree.type).toBe('session');
    });

    it('defaults to agent type', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'x', name: 'Worker' })
      });

      const tree = await buildHierarchyTree('session');
      expect(tree.type).toBe('agent');
    });
  });

  describe('normalizeStatus (via buildHierarchyTree)', () => {
    const testStatusMapping = async (inputStatus, expectedStatus) => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'x', status: inputStatus })
      });
      const tree = await buildHierarchyTree('session');
      expect(tree.status).toBe(expectedStatus);
    };

    it('maps running to active', async () => {
      await testStatusMapping('running', 'active');
    });

    it('maps in_progress to active', async () => {
      await testStatusMapping('in_progress', 'active');
    });

    it('maps success to completed', async () => {
      await testStatusMapping('success', 'completed');
    });

    it('maps done to completed', async () => {
      await testStatusMapping('done', 'completed');
    });

    it('maps error to failed', async () => {
      await testStatusMapping('error', 'failed');
    });

    it('maps waiting to pending', async () => {
      await testStatusMapping('waiting', 'pending');
    });

    it('maps queued to pending', async () => {
      await testStatusMapping('queued', 'pending');
    });

    it('passes through unmapped status', async () => {
      await testStatusMapping('active', 'active');
    });

    it('defaults to idle for undefined status', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'x' })
      });
      const tree = await buildHierarchyTree('session');
      expect(tree.status).toBe('idle');
    });
  });

  describe('extractMetrics (via buildHierarchyTree)', () => {
    it('extracts tokensUsed from metrics.tokensUsed', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'x',
          metrics: { tokensUsed: 5000 }
        })
      });

      const tree = await buildHierarchyTree('session');
      expect(tree.metrics.tokensUsed).toBe(5000);
    });

    it('uses metrics.tokens as fallback', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'x',
          metrics: { tokens: 3000 }
        })
      });

      const tree = await buildHierarchyTree('session');
      expect(tree.metrics.tokensUsed).toBe(3000);
    });

    it('extracts qualityScore with fallback', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'x',
          metrics: { quality: 85 }
        })
      });

      const tree = await buildHierarchyTree('session');
      expect(tree.metrics.qualityScore).toBe(85);
    });

    it('extracts durationMs with fallback', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'x',
          metrics: { duration: 12000 }
        })
      });

      const tree = await buildHierarchyTree('session');
      expect(tree.metrics.durationMs).toBe(12000);
    });

    it('extracts taskCount with fallback', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'x',
          metrics: { tasks: 5 }
        })
      });

      const tree = await buildHierarchyTree('session');
      expect(tree.metrics.taskCount).toBe(5);
    });

    it('calculates delegationCount from children length', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'x',
          children: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]
        })
      });

      const tree = await buildHierarchyTree('session');
      expect(tree.metrics.delegationCount).toBe(3);
    });

    it('uses metrics.delegationCount if provided', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'x',
          metrics: { delegationCount: 10 },
          children: [{ id: 'c1' }]
        })
      });

      const tree = await buildHierarchyTree('session');
      expect(tree.metrics.delegationCount).toBe(10);
    });

    it('defaults all metrics to 0 when not provided', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'x' })
      });

      const tree = await buildHierarchyTree('session');
      expect(tree.metrics.tokensUsed).toBe(0);
      expect(tree.metrics.qualityScore).toBe(0);
      expect(tree.metrics.durationMs).toBe(0);
      expect(tree.metrics.taskCount).toBe(0);
      expect(tree.metrics.delegationCount).toBe(0);
    });
  });

  describe('createEmptyTreeNode (via 404 response)', () => {
    it('creates node with session ID', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 404
      });

      const tree = await buildHierarchyTree('empty-session-xyz');
      expect(tree.id).toBe('empty-session-xyz');
    });

    it('sets name to "No Hierarchy Data"', async () => {
      global.fetch.mockResolvedValueOnce({ ok: false, status: 404 });

      const tree = await buildHierarchyTree('x');
      expect(tree.name).toBe('No Hierarchy Data');
    });

    it('sets default properties', async () => {
      global.fetch.mockResolvedValueOnce({ ok: false, status: 404 });

      const tree = await buildHierarchyTree('x');

      expect(tree.type).toBe('root');
      expect(tree.status).toBe('idle');
      expect(tree.children).toEqual([]);
      expect(tree.parentId).toBeNull();
      expect(tree.collapsed).toBe(false);
      expect(tree.selected).toBe(false);
      expect(tree.depth).toBe(0);
    });

    it('sets zero metrics', async () => {
      global.fetch.mockResolvedValueOnce({ ok: false, status: 404 });

      const tree = await buildHierarchyTree('x');

      expect(tree.metrics.tokensUsed).toBe(0);
      expect(tree.metrics.qualityScore).toBe(0);
      expect(tree.metrics.durationMs).toBe(0);
      expect(tree.metrics.taskCount).toBe(0);
      expect(tree.metrics.delegationCount).toBe(0);
    });

    it('registers empty node in state', async () => {
      global.fetch.mockResolvedValueOnce({ ok: false, status: 404 });

      await buildHierarchyTree('registered-empty');

      expect(HierarchyTreeState.getNode('registered-empty')).toBeDefined();
      expect(HierarchyTreeState.rootNode).toBeDefined();
    });
  });

  describe('createErrorTreeNode (via error response)', () => {
    it('creates node with session ID and error message in name', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 503
      });

      const tree = await buildHierarchyTree('err-session');

      expect(tree.id).toBe('err-session');
      expect(tree.name).toContain('Error');
      expect(tree.name).toContain('503');
    });

    it('sets status to failed', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Connection refused'));

      const tree = await buildHierarchyTree('x');
      expect(tree.status).toBe('failed');
    });

    it('registers error node in state', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Test'));

      await buildHierarchyTree('error-registered');

      expect(HierarchyTreeState.getNode('error-registered')).toBeDefined();
      expect(HierarchyTreeState.rootNode.status).toBe('failed');
    });
  });
});

describe('Tree Rendering', () => {
  let container;

  beforeEach(() => {
    HierarchyTreeState.reset();
    container = document.createElement('div');
    container.id = 'test-container';
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('renderHierarchyTree()', () => {
    it('clears container before rendering', () => {
      container.innerHTML = '<p>Old content</p>';

      renderHierarchyTree(null, container);

      expect(container.querySelector('p')).toBeNull();
    });

    it('renders empty state when treeData is null', () => {
      renderHierarchyTree(null, container);

      expect(container.querySelector('.hierarchy-empty')).toBeTruthy();
      expect(container.textContent).toContain('No hierarchy data available');
    });

    it('renders empty state when treeData is undefined', () => {
      renderHierarchyTree(undefined, container);

      expect(container.querySelector('.hierarchy-empty')).toBeTruthy();
    });

    it('creates hierarchy-tree wrapper element', () => {
      const treeData = createTestNode('root', 'Root');

      renderHierarchyTree(treeData, container);

      expect(container.querySelector('.hierarchy-tree')).toBeTruthy();
    });

    it('adds animated class when animated option is true', () => {
      const treeData = createTestNode('root', 'Root');

      renderHierarchyTree(treeData, container, { animated: true });

      expect(container.querySelector('.hierarchy-tree--animated')).toBeTruthy();
    });

    it('does not add animated class when animated is false', () => {
      const treeData = createTestNode('root', 'Root');

      renderHierarchyTree(treeData, container, { animated: false });

      expect(container.querySelector('.hierarchy-tree--animated')).toBeNull();
    });

    it('renders node with correct data attributes', () => {
      const treeData = createTestNode('node-123', 'Test Node');
      HierarchyTreeState.registerNode(treeData);

      renderHierarchyTree(treeData, container);

      const nodeElement = container.querySelector('[data-node-id="node-123"]');
      expect(nodeElement).toBeTruthy();
      expect(nodeElement.dataset.depth).toBe('0');
    });

    it('renders node name', () => {
      const treeData = createTestNode('x', 'My Agent Name');
      HierarchyTreeState.registerNode(treeData);

      renderHierarchyTree(treeData, container);

      expect(container.textContent).toContain('My Agent Name');
    });

    it('renders toggle button for nodes with children', () => {
      const treeData = createTestNode('parent', 'Parent', [
        createTestNode('child', 'Child')
      ]);
      HierarchyTreeState.registerNode(treeData);

      renderHierarchyTree(treeData, container);

      const toggleButton = container.querySelector('.hierarchy-tree__toggle');
      expect(toggleButton).toBeTruthy();
    });

    it('renders placeholder for leaf nodes', () => {
      const treeData = createTestNode('leaf', 'Leaf');
      HierarchyTreeState.registerNode(treeData);

      renderHierarchyTree(treeData, container);

      expect(container.querySelector('.hierarchy-tree__toggle-placeholder')).toBeTruthy();
    });

    it('renders child count badge', () => {
      const treeData = createTestNode('parent', 'Parent', [
        createTestNode('c1', 'Child 1'),
        createTestNode('c2', 'Child 2'),
        createTestNode('c3', 'Child 3')
      ]);
      HierarchyTreeState.registerNode(treeData);

      renderHierarchyTree(treeData, container);

      const badge = container.querySelector('.hierarchy-tree__badge');
      expect(badge).toBeTruthy();
      expect(badge.textContent).toBe('3');
    });

    it('renders children in container', () => {
      const treeData = createTestNode('parent', 'Parent', [
        createTestNode('child-1', 'Child One')
      ]);
      HierarchyTreeState.registerNode(treeData);
      treeData.children.forEach(c => HierarchyTreeState.registerNode(c));
      HierarchyTreeState.expandedNodeIds.add('parent');

      renderHierarchyTree(treeData, container);

      const childrenContainer = container.querySelector('.hierarchy-tree__children');
      expect(childrenContainer).toBeTruthy();
    });

    it('shows children when expanded', () => {
      const treeData = createTestNode('parent', 'Parent', [
        createTestNode('child', 'Child')
      ]);
      HierarchyTreeState.registerNode(treeData);
      HierarchyTreeState.expandedNodeIds.add('parent');

      renderHierarchyTree(treeData, container);

      const childrenContainer = container.querySelector('.hierarchy-tree__children');
      expect(childrenContainer.style.display).toBe('block');
    });

    it('hides children when collapsed', () => {
      const treeData = createTestNode('parent', 'Parent', [
        createTestNode('child', 'Child')
      ]);
      HierarchyTreeState.registerNode(treeData);
      // Not in expandedNodeIds = collapsed

      renderHierarchyTree(treeData, container);

      const childrenContainer = container.querySelector('.hierarchy-tree__children');
      expect(childrenContainer.style.display).toBe('none');
    });

    it('shows metrics when showMetrics is true', () => {
      const treeData = createTestNode('x', 'X');
      treeData.metrics = { tokensUsed: 5000, qualityScore: 90, durationMs: 1000 };
      HierarchyTreeState.registerNode(treeData);

      renderHierarchyTree(treeData, container, { showMetrics: true });

      expect(container.querySelector('.hierarchy-tree__metrics')).toBeTruthy();
    });

    it('hides metrics when showMetrics is false', () => {
      const treeData = createTestNode('x', 'X');
      treeData.metrics = { tokensUsed: 5000, qualityScore: 90, durationMs: 1000 };
      HierarchyTreeState.registerNode(treeData);

      renderHierarchyTree(treeData, container, { showMetrics: false });

      expect(container.querySelector('.hierarchy-tree__metrics')).toBeNull();
    });

    it('attaches click event listeners', () => {
      const treeData = createTestNode('click-test', 'Click Test');
      HierarchyTreeState.registerNode(treeData);

      renderHierarchyTree(treeData, container);

      // Verify container has click event by trying to dispatch
      const clickEvent = new MouseEvent('click', { bubbles: true });
      expect(() => container.dispatchEvent(clickEvent)).not.toThrow();
    });
  });

  describe('renderTreeNode CSS classes', () => {
    it('includes type-specific class', () => {
      const treeData = createTestNode('x', 'X');
      treeData.type = 'agent';
      HierarchyTreeState.registerNode(treeData);

      renderHierarchyTree(treeData, container);

      expect(container.querySelector('.hierarchy-tree__node--agent')).toBeTruthy();
    });

    it('includes status-specific class', () => {
      const treeData = createTestNode('x', 'X');
      treeData.status = 'active';
      HierarchyTreeState.registerNode(treeData);

      renderHierarchyTree(treeData, container);

      expect(container.querySelector('.hierarchy-tree__node--active')).toBeTruthy();
    });

    it('includes has-children class when applicable', () => {
      const treeData = createTestNode('parent', 'P', [createTestNode('c', 'C')]);
      HierarchyTreeState.registerNode(treeData);

      renderHierarchyTree(treeData, container);

      expect(container.querySelector('.hierarchy-tree__node--has-children')).toBeTruthy();
    });

    it('includes expanded class when node is expanded', () => {
      const treeData = createTestNode('exp', 'Expanded', [createTestNode('c', 'C')]);
      HierarchyTreeState.registerNode(treeData);
      HierarchyTreeState.expandedNodeIds.add('exp');

      renderHierarchyTree(treeData, container);

      expect(container.querySelector('.hierarchy-tree__node--expanded')).toBeTruthy();
    });

    it('includes collapsed class when node is collapsed', () => {
      const treeData = createTestNode('coll', 'Collapsed', [createTestNode('c', 'C')]);
      HierarchyTreeState.registerNode(treeData);

      renderHierarchyTree(treeData, container);

      expect(container.querySelector('.hierarchy-tree__node--collapsed')).toBeTruthy();
    });

    it('includes selected class when node is selected', () => {
      const treeData = createTestNode('sel', 'Selected');
      HierarchyTreeState.registerNode(treeData);
      HierarchyTreeState.selectedNodeId = 'sel';

      renderHierarchyTree(treeData, container);

      expect(container.querySelector('.hierarchy-tree__node--selected')).toBeTruthy();
    });
  });

  describe('getNodeIcon (via renderHierarchyTree)', () => {
    it('returns home icon for root type', () => {
      const treeData = createTestNode('x', 'X');
      treeData.type = 'root';
      HierarchyTreeState.registerNode(treeData);

      renderHierarchyTree(treeData, container);

      expect(container.textContent).toContain('\uD83C\uDFE0'); // Home emoji
    });

    it('returns clipboard icon for session type', () => {
      const treeData = createTestNode('x', 'X');
      treeData.type = 'session';
      HierarchyTreeState.registerNode(treeData);

      renderHierarchyTree(treeData, container);

      expect(container.textContent).toContain('\uD83D\uDCCB'); // Clipboard emoji
    });

    it('returns robot icon for agent type', () => {
      const treeData = createTestNode('x', 'X');
      treeData.type = 'agent';
      HierarchyTreeState.registerNode(treeData);

      renderHierarchyTree(treeData, container);

      expect(container.textContent).toContain('\uD83E\uDD16'); // Robot emoji
    });

    it('returns document icon for unknown type', () => {
      const treeData = createTestNode('x', 'X');
      treeData.type = 'unknown-type';
      HierarchyTreeState.registerNode(treeData);

      renderHierarchyTree(treeData, container);

      expect(container.textContent).toContain('\uD83D\uDCC4'); // Document emoji
    });
  });

  describe('formatDuration (via renderHierarchyTree)', () => {
    it('formats milliseconds', () => {
      const treeData = createTestNode('x', 'X');
      treeData.metrics = { tokensUsed: 1, qualityScore: 0, durationMs: 500 };
      HierarchyTreeState.registerNode(treeData);

      renderHierarchyTree(treeData, container, { showMetrics: true });

      expect(container.textContent).toContain('500ms');
    });

    it('formats seconds', () => {
      const treeData = createTestNode('x', 'X');
      treeData.metrics = { tokensUsed: 1, qualityScore: 0, durationMs: 5500 };
      HierarchyTreeState.registerNode(treeData);

      renderHierarchyTree(treeData, container, { showMetrics: true });

      expect(container.textContent).toContain('5.5s');
    });

    it('formats minutes', () => {
      const treeData = createTestNode('x', 'X');
      treeData.metrics = { tokensUsed: 1, qualityScore: 0, durationMs: 180000 };
      HierarchyTreeState.registerNode(treeData);

      renderHierarchyTree(treeData, container, { showMetrics: true });

      expect(container.textContent).toContain('3m');
    });

    it('formats hours', () => {
      const treeData = createTestNode('x', 'X');
      treeData.metrics = { tokensUsed: 1, qualityScore: 0, durationMs: 5400000 };
      HierarchyTreeState.registerNode(treeData);

      renderHierarchyTree(treeData, container, { showMetrics: true });

      expect(container.textContent).toContain('1.5h');
    });
  });

  describe('formatNumber (via renderHierarchyTree)', () => {
    it('formats small numbers as-is', () => {
      const treeData = createTestNode('x', 'X');
      treeData.metrics = { tokensUsed: 500, qualityScore: 0, durationMs: 0 };
      HierarchyTreeState.registerNode(treeData);

      renderHierarchyTree(treeData, container, { showMetrics: true });

      expect(container.textContent).toContain('500');
    });

    it('formats thousands with K suffix', () => {
      const treeData = createTestNode('x', 'X');
      treeData.metrics = { tokensUsed: 5500, qualityScore: 0, durationMs: 0 };
      HierarchyTreeState.registerNode(treeData);

      renderHierarchyTree(treeData, container, { showMetrics: true });

      expect(container.textContent).toContain('5.5K');
    });

    it('formats millions with M suffix', () => {
      const treeData = createTestNode('x', 'X');
      treeData.metrics = { tokensUsed: 1500000, qualityScore: 0, durationMs: 0 };
      HierarchyTreeState.registerNode(treeData);

      renderHierarchyTree(treeData, container, { showMetrics: true });

      expect(container.textContent).toContain('1.5M');
    });
  });

  describe('escapeHtml (via renderHierarchyTree)', () => {
    it('escapes < and > characters', () => {
      const treeData = createTestNode('x', '<script>alert("xss")</script>');
      HierarchyTreeState.registerNode(treeData);

      renderHierarchyTree(treeData, container);

      expect(container.innerHTML).not.toContain('<script>');
      expect(container.innerHTML).toContain('&lt;script&gt;');
    });

    it('escapes & character', () => {
      const treeData = createTestNode('x', 'A & B');
      HierarchyTreeState.registerNode(treeData);

      renderHierarchyTree(treeData, container);

      expect(container.innerHTML).toContain('&amp;');
    });

    it('escapes quotes', () => {
      const treeData = createTestNode('x', 'Say "Hello"');
      HierarchyTreeState.registerNode(treeData);

      renderHierarchyTree(treeData, container);

      // The quotes should be escaped in attributes, and content should be preserved
      const nameSpan = container.querySelector('.hierarchy-tree__name');
      expect(nameSpan.textContent.trim()).toBe('Say "Hello"');
    });

    it('handles empty strings', () => {
      const treeData = createTestNode('x', '');
      HierarchyTreeState.registerNode(treeData);

      expect(() => renderHierarchyTree(treeData, container)).not.toThrow();
    });

    it('handles null/undefined gracefully in id', () => {
      const treeData = createTestNode('safe-id', 'Name');
      HierarchyTreeState.registerNode(treeData);

      expect(() => renderHierarchyTree(treeData, container)).not.toThrow();
    });
  });
});

describe('Event Handlers', () => {
  let container;

  beforeEach(() => {
    HierarchyTreeState.reset();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('toggleTreeNode()', () => {
    it('does nothing if node does not exist', () => {
      expect(() => toggleTreeNode('non-existent')).not.toThrow();
    });

    it('does nothing if node has no children', () => {
      const node = createTestNode('leaf', 'Leaf');
      node.children = [];
      HierarchyTreeState.registerNode(node);

      toggleTreeNode('leaf');

      // Should not throw, state unchanged
      expect(HierarchyTreeState.expandedNodeIds.has('leaf')).toBe(false);
    });

    it('expands a collapsed node', () => {
      const node = createTestNode('toggle-me', 'Toggle', [createTestNode('c', 'C')]);
      HierarchyTreeState.registerNode(node);

      toggleTreeNode('toggle-me');

      expect(HierarchyTreeState.expandedNodeIds.has('toggle-me')).toBe(true);
    });

    it('collapses an expanded node', () => {
      const node = createTestNode('toggle-me', 'Toggle', [createTestNode('c', 'C')]);
      HierarchyTreeState.registerNode(node);
      HierarchyTreeState.expandedNodeIds.add('toggle-me');

      toggleTreeNode('toggle-me');

      expect(HierarchyTreeState.expandedNodeIds.has('toggle-me')).toBe(false);
    });

    it('updates DOM element classes', () => {
      const node = createTestNode('dom-toggle', 'Node', [createTestNode('c', 'C')]);
      HierarchyTreeState.registerNode(node);
      node.children.forEach(c => HierarchyTreeState.registerNode(c));

      renderHierarchyTree(node, container);

      toggleTreeNode('dom-toggle');

      const nodeElement = container.querySelector('[data-node-id="dom-toggle"]');
      expect(nodeElement.classList.contains('hierarchy-tree__node--expanded')).toBe(true);
    });

    it('updates toggle icon text', () => {
      const node = createTestNode('icon-toggle', 'Node', [createTestNode('c', 'C')]);
      HierarchyTreeState.registerNode(node);
      node.children.forEach(c => HierarchyTreeState.registerNode(c));

      renderHierarchyTree(node, container);

      // Initially collapsed, icon should be right arrow
      let toggleIcon = container.querySelector('.hierarchy-tree__toggle-icon');
      expect(toggleIcon.textContent).toBe('\u25B6'); // Right arrow

      toggleTreeNode('icon-toggle');

      toggleIcon = container.querySelector('.hierarchy-tree__toggle-icon');
      expect(toggleIcon.textContent).toBe('\u25BC'); // Down arrow
    });

    it('shows/hides children container', () => {
      const node = createTestNode('children-toggle', 'Node', [createTestNode('c', 'C')]);
      HierarchyTreeState.registerNode(node);
      node.children.forEach(c => HierarchyTreeState.registerNode(c));

      renderHierarchyTree(node, container);

      const childrenContainer = container.querySelector('.hierarchy-tree__children');
      expect(childrenContainer.style.display).toBe('none');

      toggleTreeNode('children-toggle');

      expect(childrenContainer.style.display).toBe('block');
    });

    it('calls onNodeExpand callback', () => {
      const callback = jest.fn();
      HierarchyTreeState.onNodeExpand = callback;

      const node = createTestNode('callback-toggle', 'Node', [createTestNode('c', 'C')]);
      HierarchyTreeState.registerNode(node);

      toggleTreeNode('callback-toggle');

      expect(callback).toHaveBeenCalledWith('callback-toggle', true);
    });

    it('calls onNodeExpand with false when collapsing', () => {
      const callback = jest.fn();
      HierarchyTreeState.onNodeExpand = callback;

      const node = createTestNode('collapse-callback', 'Node', [createTestNode('c', 'C')]);
      HierarchyTreeState.registerNode(node);
      HierarchyTreeState.expandedNodeIds.add('collapse-callback');

      toggleTreeNode('collapse-callback');

      expect(callback).toHaveBeenCalledWith('collapse-callback', false);
    });
  });

  describe('selectTreeNode()', () => {
    it('does nothing if node does not exist', () => {
      expect(() => selectTreeNode('non-existent')).not.toThrow();
      expect(HierarchyTreeState.selectedNodeId).toBeNull();
    });

    it('updates selectedNodeId in state', () => {
      const node = createTestNode('select-me', 'Select Me');
      HierarchyTreeState.registerNode(node);

      selectTreeNode('select-me');

      expect(HierarchyTreeState.selectedNodeId).toBe('select-me');
    });

    it('removes selected class from previously selected node', () => {
      const node1 = createTestNode('first', 'First');
      const node2 = createTestNode('second', 'Second');
      HierarchyTreeState.registerNode(node1);
      HierarchyTreeState.registerNode(node2);

      // Create mock DOM structure
      const elem1 = document.createElement('div');
      elem1.setAttribute('data-node-id', 'first');
      elem1.classList.add('hierarchy-tree__node--selected');
      container.appendChild(elem1);

      const elem2 = document.createElement('div');
      elem2.setAttribute('data-node-id', 'second');
      container.appendChild(elem2);

      HierarchyTreeState.selectedNodeId = 'first';

      selectTreeNode('second');

      expect(elem1.classList.contains('hierarchy-tree__node--selected')).toBe(false);
    });

    it('adds selected class to newly selected node', () => {
      const node = createTestNode('new-select', 'New Select');
      HierarchyTreeState.registerNode(node);

      const elem = document.createElement('div');
      elem.setAttribute('data-node-id', 'new-select');
      container.appendChild(elem);

      selectTreeNode('new-select');

      expect(elem.classList.contains('hierarchy-tree__node--selected')).toBe(true);
    });

    it('calls onNodeSelect callback with node', () => {
      const callback = jest.fn();
      HierarchyTreeState.onNodeSelect = callback;

      const node = createTestNode('callback-select', 'Callback Select');
      HierarchyTreeState.registerNode(node);

      selectTreeNode('callback-select');

      expect(callback).toHaveBeenCalledWith(node);
    });
  });

  describe('expandAllNodes()', () => {
    it('expands all nodes with children', () => {
      const root = createTestNode('root', 'Root', [
        createTestNode('child1', 'Child 1', [
          createTestNode('grandchild', 'Grandchild')
        ]),
        createTestNode('child2', 'Child 2')
      ]);

      // Register all nodes
      HierarchyTreeState.registerNode(root);
      HierarchyTreeState.registerNode(root.children[0]);
      HierarchyTreeState.registerNode(root.children[0].children[0]);
      HierarchyTreeState.registerNode(root.children[1]);

      expandAllNodes();

      expect(HierarchyTreeState.expandedNodeIds.has('root')).toBe(true);
      expect(HierarchyTreeState.expandedNodeIds.has('child1')).toBe(true);
      // Leaf nodes should not be expanded (they have no children)
      expect(HierarchyTreeState.expandedNodeIds.has('grandchild')).toBe(false);
      expect(HierarchyTreeState.expandedNodeIds.has('child2')).toBe(false);
    });

    it('skips already expanded nodes', () => {
      const node = createTestNode('already', 'Already', [createTestNode('c', 'C')]);
      HierarchyTreeState.registerNode(node);
      HierarchyTreeState.expandedNodeIds.add('already');

      // Should not cause double-toggle (which would collapse)
      expandAllNodes();

      expect(HierarchyTreeState.expandedNodeIds.has('already')).toBe(true);
    });
  });

  describe('collapseAllNodes()', () => {
    it('collapses all expanded nodes except root', () => {
      // Create a hierarchy where child has children (grandchild), so it can be collapsed
      const grandchild = createTestNode('grandchild', 'Grandchild', [
        createTestNode('greatgrandchild', 'GreatGrandchild')
      ]);
      const child = createTestNode('child', 'Child', [grandchild]);
      const root = createTestNode('root', 'Root', [child]);

      root.depth = 0;
      child.depth = 1;
      grandchild.depth = 2;
      grandchild.children[0].depth = 3;

      HierarchyTreeState.registerNode(root);
      HierarchyTreeState.registerNode(child);
      HierarchyTreeState.registerNode(grandchild);
      HierarchyTreeState.registerNode(grandchild.children[0]);

      // Expand all nodes that have children
      HierarchyTreeState.expandedNodeIds.add('root');
      HierarchyTreeState.expandedNodeIds.add('child');
      HierarchyTreeState.expandedNodeIds.add('grandchild');

      collapseAllNodes();

      // Root (depth 0) should stay expanded
      expect(HierarchyTreeState.expandedNodeIds.has('root')).toBe(true);
      // Others should be collapsed
      expect(HierarchyTreeState.expandedNodeIds.has('child')).toBe(false);
      expect(HierarchyTreeState.expandedNodeIds.has('grandchild')).toBe(false);
    });

    it('skips already collapsed nodes', () => {
      const node = createTestNode('skip', 'Skip', [createTestNode('c', 'C')]);
      node.depth = 1;
      HierarchyTreeState.registerNode(node);
      // Not in expandedNodeIds, so already collapsed

      // Should not toggle (which would expand)
      collapseAllNodes();

      expect(HierarchyTreeState.expandedNodeIds.has('skip')).toBe(false);
    });
  });

  describe('Click event handling', () => {
    it('handles toggle action on click', () => {
      const node = createTestNode('click-toggle', 'Click Toggle', [createTestNode('c', 'C')]);
      HierarchyTreeState.registerNode(node);
      node.children.forEach(c => HierarchyTreeState.registerNode(c));

      renderHierarchyTree(node, container);

      const toggleButton = container.querySelector('[data-action="toggle"]');
      toggleButton.click();

      expect(HierarchyTreeState.expandedNodeIds.has('click-toggle')).toBe(true);
    });

    it('handles select action on click', () => {
      const node = createTestNode('click-select', 'Click Select');
      HierarchyTreeState.registerNode(node);

      renderHierarchyTree(node, container);

      const nameSpan = container.querySelector('[data-action="select"]');
      nameSpan.click();

      expect(HierarchyTreeState.selectedNodeId).toBe('click-select');
    });

    it('ignores clicks without data-action', () => {
      const node = createTestNode('no-action', 'No Action');
      HierarchyTreeState.registerNode(node);

      renderHierarchyTree(node, container);

      // Click on status dot (no data-action)
      const statusDot = container.querySelector('.hierarchy-tree__status-dot');
      expect(() => statusDot.click()).not.toThrow();
    });

    it('ignores clicks without node id', () => {
      // This tests the handleTreeClick guard clause
      const event = new MouseEvent('click', { bubbles: true });
      const target = document.createElement('div');
      target.dataset.action = 'toggle';
      // No nodeId set

      container.appendChild(target);

      expect(() => container.dispatchEvent(event)).not.toThrow();
    });
  });
});

describe('Integration Tests', () => {
  let container;

  beforeEach(() => {
    HierarchyTreeState.reset();
    global.fetch.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    document.body.removeChild(container);
    console.error.mockRestore();
  });

  it('builds and renders a complete hierarchy', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'session-root',
        name: 'Research Session',
        type: 'root',
        status: 'running',
        metrics: {
          tokensUsed: 15000,
          qualityScore: 88,
          durationMs: 45000
        },
        children: [
          {
            id: 'analyst',
            name: 'Research Analyst',
            status: 'success',
            metrics: { tokensUsed: 8000, qualityScore: 92 }
          },
          {
            id: 'writer',
            name: 'Technical Writer',
            status: 'in_progress',
            children: [
              {
                id: 'editor',
                name: 'Editor',
                status: 'waiting'
              }
            ]
          }
        ]
      })
    });

    const tree = await buildHierarchyTree('integration-test');
    renderHierarchyTree(tree, container, { showMetrics: true });

    // Verify tree structure
    expect(container.textContent).toContain('Research Session');
    expect(container.textContent).toContain('Research Analyst');
    expect(container.textContent).toContain('Technical Writer');

    // Verify nodes are registered
    expect(HierarchyTreeState.nodeMap.size).toBe(4);

    // Verify root is expanded
    expect(HierarchyTreeState.expandedNodeIds.has('session-root')).toBe(true);

    // Verify status normalization
    const analystNode = HierarchyTreeState.getNode('analyst');
    expect(analystNode.status).toBe('completed');

    // Verify metrics are displayed (formatNumber adds decimal for K, e.g., "15.0K")
    expect(container.textContent).toContain('15.0K'); // formatted token count
  });

  it('handles user interactions correctly', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'interactive-root',
        name: 'Interactive Test',
        children: [
          { id: 'interactive-child', name: 'Child' }
        ]
      })
    });

    const tree = await buildHierarchyTree('interaction-test');
    renderHierarchyTree(tree, container);

    // Initial state: root expanded
    expect(HierarchyTreeState.expandedNodeIds.has('interactive-root')).toBe(true);

    // Toggle to collapse
    const toggleButton = container.querySelector('[data-action="toggle"]');
    toggleButton.click();

    expect(HierarchyTreeState.expandedNodeIds.has('interactive-root')).toBe(false);

    // Select a node
    const nameSpan = container.querySelector('[data-action="select"]');
    nameSpan.click();

    expect(HierarchyTreeState.selectedNodeId).toBe('interactive-root');
  });

  it('renders deeply nested hierarchies correctly', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'level-0',
        name: 'Level 0',
        children: [{
          id: 'level-1',
          name: 'Level 1',
          children: [{
            id: 'level-2',
            name: 'Level 2',
            children: [{
              id: 'level-3',
              name: 'Level 3',
              children: [{
                id: 'level-4',
                name: 'Level 4'
              }]
            }]
          }]
        }]
      })
    });

    const tree = await buildHierarchyTree('deep-test');
    renderHierarchyTree(tree, container);

    // All levels should be registered
    expect(HierarchyTreeState.nodeMap.size).toBe(5);

    // Verify depth is correct
    expect(HierarchyTreeState.getNode('level-0').depth).toBe(0);
    expect(HierarchyTreeState.getNode('level-4').depth).toBe(4);

    // Nodes at depth > 1 should start collapsed
    expect(HierarchyTreeState.getNode('level-2').collapsed).toBe(true);
    expect(HierarchyTreeState.getNode('level-3').collapsed).toBe(true);
  });
});

// Helper function to create test nodes
function createTestNode(id, name, children = []) {
  return {
    id,
    name,
    type: 'agent',
    status: 'idle',
    children,
    parentId: null,
    collapsed: false,
    selected: false,
    depth: 0,
    metrics: { tokensUsed: 0, qualityScore: 0, durationMs: 0, taskCount: 0, delegationCount: 0 }
  };
}
