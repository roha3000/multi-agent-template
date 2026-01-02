/**
 * Task Dependency Graph Generator
 *
 * Transforms TaskManager data into a format suitable for D3.js visualization.
 * Generates nodes and links representing tasks and their dependencies.
 *
 * @module task-graph
 */

class TaskGraph {
  /**
   * Create a TaskGraph instance
   * @param {Object} taskManager - TaskManager instance
   */
  constructor(taskManager) {
    this.taskManager = taskManager;
  }

  /**
   * Generate graph data for D3.js force-directed layout
   * @returns {Object} { nodes: [], links: [] }
   */
  generateGraphData() {
    const tasks = this.taskManager.getAllTasks();
    const nodes = [];
    const links = [];
    const taskMap = new Map();

    // Create nodes
    for (const task of tasks) {
      const node = {
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        phase: task.phase,
        estimate: task.estimate,
        tags: task.tags || [],
        // Visual properties
        group: this._getGroupFromPhase(task.phase),
        radius: this._getRadiusFromPriority(task.priority),
        color: this._getColorFromStatus(task.status),
      };
      nodes.push(node);
      taskMap.set(task.id, node);
    }

    // Create links from dependencies
    for (const task of tasks) {
      if (task.depends) {
        // Links from "requires" (this task depends on others)
        if (task.depends.requires) {
          for (const reqId of task.depends.requires) {
            if (taskMap.has(reqId)) {
              links.push({
                source: reqId,
                target: task.id,
                type: 'requires',
                // Arrow points to dependent task
              });
            }
          }
        }

        // Links from "blocks" (this task blocks others)
        if (task.depends.blocks) {
          for (const blockId of task.depends.blocks) {
            if (taskMap.has(blockId)) {
              links.push({
                source: task.id,
                target: blockId,
                type: 'blocks',
              });
            }
          }
        }

        // Related links (dashed, no arrow)
        if (task.depends.related) {
          for (const relId of task.depends.related) {
            if (taskMap.has(relId)) {
              // Avoid duplicate related links
              const exists = links.some(l =>
                (l.source === task.id && l.target === relId) ||
                (l.source === relId && l.target === task.id)
              );
              if (!exists) {
                links.push({
                  source: task.id,
                  target: relId,
                  type: 'related',
                });
              }
            }
          }
        }
      }
    }

    return { nodes, links };
  }

  /**
   * Generate hierarchical tree data (for tree layout)
   * @returns {Object} Tree structure with root and children
   */
  generateTreeData() {
    const tasks = this.taskManager.getAllTasks();
    const taskMap = new Map(tasks.map(t => [t.id, { ...t, children: [] }]));
    const addedAsChild = new Set();

    // First pass: Build parent-child relationships from childTaskIds
    for (const task of tasks) {
      if (task.childTaskIds && task.childTaskIds.length > 0) {
        const parentNode = taskMap.get(task.id);
        if (parentNode) {
          for (const childId of task.childTaskIds) {
            const childNode = taskMap.get(childId);
            if (childNode) {
              parentNode.children.push(childNode);
              addedAsChild.add(childId);
            }
          }
        }
      }
    }

    // Second pass: Add dependency-based children (for tasks without explicit childTaskIds)
    for (const task of tasks) {
      if (addedAsChild.has(task.id)) continue; // Already added as child

      const hasRequirements = task.depends?.requires?.length > 0;

      if (hasRequirements) {
        // Add as child to first requirement (only if not already added via childTaskIds)
        const parentId = task.depends.requires[0];
        const parent = taskMap.get(parentId);
        if (parent && !addedAsChild.has(task.id)) {
          parent.children.push(taskMap.get(task.id));
          addedAsChild.add(task.id);
        }
      }
    }

    // Find root tasks (not added as children anywhere)
    const roots = tasks
      .filter(t => !addedAsChild.has(t.id))
      .map(t => taskMap.get(t.id));

    return {
      id: 'root',
      title: 'All Tasks',
      children: roots,
    };
  }

  /**
   * Get graph statistics
   * @returns {Object} Statistics about the graph
   */
  getStatistics() {
    const { nodes, links } = this.generateGraphData();

    const statusCounts = {};
    const phaseCounts = {};

    for (const node of nodes) {
      statusCounts[node.status] = (statusCounts[node.status] || 0) + 1;
      phaseCounts[node.phase] = (phaseCounts[node.phase] || 0) + 1;
    }

    // Find critical path (longest chain of dependencies)
    const criticalPath = this._findCriticalPath(nodes, links);

    return {
      totalNodes: nodes.length,
      totalLinks: links.length,
      statusCounts,
      phaseCounts,
      criticalPath,
      avgDependencies: links.length / Math.max(nodes.length, 1),
    };
  }

  /**
   * Find the critical path (longest dependency chain)
   * @private
   */
  _findCriticalPath(nodes, links) {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const adjacency = new Map();

    // Build adjacency list
    for (const node of nodes) {
      adjacency.set(node.id, []);
    }
    for (const link of links) {
      if (link.type === 'requires' || link.type === 'blocks') {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
        adjacency.get(sourceId)?.push(targetId);
      }
    }

    // DFS to find longest path
    const memo = new Map();

    function dfs(nodeId, visited = new Set()) {
      if (visited.has(nodeId)) return []; // Cycle detected
      if (memo.has(nodeId)) return memo.get(nodeId);

      visited.add(nodeId);
      const neighbors = adjacency.get(nodeId) || [];

      let longestPath = [nodeId];
      for (const neighbor of neighbors) {
        const path = dfs(neighbor, new Set(visited));
        if (path.length + 1 > longestPath.length) {
          longestPath = [nodeId, ...path];
        }
      }

      memo.set(nodeId, longestPath);
      return longestPath;
    }

    let criticalPath = [];
    for (const node of nodes) {
      const path = dfs(node.id);
      if (path.length > criticalPath.length) {
        criticalPath = path;
      }
    }

    return criticalPath.map(id => nodeMap.get(id)?.title || id);
  }

  /**
   * Get group number from phase (for coloring)
   * @private
   */
  _getGroupFromPhase(phase) {
    const phases = {
      research: 1,
      planning: 2,
      design: 3,
      implementation: 4,
      testing: 5,
      validation: 6,
    };
    return phases[phase] || 0;
  }

  /**
   * Get node radius from priority
   * @private
   */
  _getRadiusFromPriority(priority) {
    const sizes = {
      high: 20,
      medium: 15,
      low: 10,
    };
    return sizes[priority] || 12;
  }

  /**
   * Get node color from status
   * @private
   */
  _getColorFromStatus(status) {
    const colors = {
      completed: '#22c55e', // Green
      'in_progress': '#3b82f6', // Blue
      in_progress: '#3b82f6', // Blue
      ready: '#f59e0b', // Amber
      blocked: '#ef4444', // Red
      pending: '#6b7280', // Gray
    };
    return colors[status] || '#9ca3af';
  }

  /**
   * Export graph to DOT format (for Graphviz)
   * @returns {string} DOT format string
   */
  toDOT() {
    const { nodes, links } = this.generateGraphData();

    let dot = 'digraph TaskGraph {\n';
    dot += '  rankdir=LR;\n';
    dot += '  node [shape=box, style=rounded];\n\n';

    // Nodes
    for (const node of nodes) {
      const color = node.color.replace('#', '');
      dot += `  "${node.id}" [label="${node.title}", fillcolor="#${color}", style="filled,rounded"];\n`;
    }

    dot += '\n';

    // Edges
    for (const link of links) {
      const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
      const targetId = typeof link.target === 'object' ? link.target.id : link.target;
      const style = link.type === 'related' ? 'dashed' : 'solid';
      dot += `  "${sourceId}" -> "${targetId}" [style=${style}];\n`;
    }

    dot += '}\n';
    return dot;
  }
}

module.exports = TaskGraph;
