#!/usr/bin/env node
/**
 * Archive old completed tasks to reduce tasks.json size
 * Keeps the N most recently completed tasks (and active task children), archives the rest
 *
 * Key behavior:
 * - Archives completed PARENT tasks from backlog.completed list
 * - Also archives completed CHILD tasks whose parents are archived/completed
 * - Keeps children of in-progress parent tasks (e.g., auto-delegation subtasks)
 */

const fs = require('fs');
const path = require('path');

const TASKS_PATH = path.join(__dirname, '..', '.claude', 'dev-docs', 'tasks.json');
const ARCHIVE_PATH = path.join(__dirname, '..', '.claude', 'dev-docs', 'archives', 'tasks-archive.json');
const MAX_COMPLETED_TO_KEEP = 5;

function main() {
  console.log('=== Task Archival Script ===\n');

  // Load tasks.json
  const tasksData = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
  const completedIds = tasksData.backlog.completed.tasks;

  // Find ALL completed task definitions (including children not in backlog)
  const allCompletedDefs = Object.entries(tasksData.tasks)
    .filter(([id, task]) => task.status === 'completed')
    .map(([id, task]) => ({ id, task, parentTaskId: task.parentTaskId }));

  console.log(`Found ${completedIds.length} completed tasks in backlog`);
  console.log(`Found ${allCompletedDefs.length} completed task DEFINITIONS total\n`);

  // Get completed PARENT tasks (in backlog) with their timestamps
  const completedParents = completedIds
    .map(id => {
      const task = tasksData.tasks[id];
      if (!task) {
        console.warn(`Warning: Task ${id} in completed list but no definition found`);
        return null;
      }
      return {
        id,
        task,
        completedAt: task.completedAt ? new Date(task.completedAt).getTime() :
                     task.completed ? new Date(task.completed).getTime() : 0
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.completedAt - a.completedAt); // Most recent first

  // Split parents into keep and archive
  const parentsToKeep = completedParents.slice(0, MAX_COMPLETED_TO_KEEP);
  const parentsToArchive = completedParents.slice(MAX_COMPLETED_TO_KEEP);

  // Build set of parent IDs to keep vs archive
  const keepParentIds = new Set(parentsToKeep.map(t => t.id));
  const archiveParentIds = new Set(parentsToArchive.map(t => t.id));

  // Find children to archive: ALL completed children whose parent is also completed
  // (We don't need child definitions if the parent work is done)
  const childrenToArchive = allCompletedDefs
    .filter(({ id, parentTaskId }) => {
      if (!parentTaskId) return false; // Not a child
      const parent = tasksData.tasks[parentTaskId];
      // Archive if parent is completed (regardless of whether parent is kept)
      if (parent && parent.status === 'completed') return true;
      // Archive if parent is being archived
      if (archiveParentIds.has(parentTaskId)) return true;
      return false;
    });

  // Combine parents and children to archive
  const tasksToArchive = [
    ...parentsToArchive,
    ...childrenToArchive.map(({ id, task }) => ({ id, task }))
  ];

  console.log('Parent tasks to KEEP (most recent):');
  parentsToKeep.forEach(t => {
    console.log(`  - ${t.id} (completed: ${t.task.completedAt || t.task.completed || 'no timestamp'})`);
  });

  console.log(`\nChildren to ARCHIVE (${childrenToArchive.length}):`);
  childrenToArchive.slice(0, 5).forEach(({ id }) => {
    console.log(`  - ${id}`);
  });
  if (childrenToArchive.length > 5) {
    console.log(`  ... and ${childrenToArchive.length - 5} more`);
  }

  console.log(`\nTotal tasks to ARCHIVE (${tasksToArchive.length}):`);
  tasksToArchive.slice(0, 8).forEach(t => {
    console.log(`  - ${t.id}`);
  });
  if (tasksToArchive.length > 8) {
    console.log(`  ... and ${tasksToArchive.length - 8} more`);
  }

  // Load or create archive
  let archive = { archivedAt: new Date().toISOString(), tasks: {} };
  if (fs.existsSync(ARCHIVE_PATH)) {
    archive = JSON.parse(fs.readFileSync(ARCHIVE_PATH, 'utf8'));
  }

  // Add tasks to archive
  tasksToArchive.forEach(({ id, task }) => {
    archive.tasks[id] = task;
  });

  // Update tasks.json
  // 1. Update completed list to only keep recent parent IDs
  tasksData.backlog.completed.tasks = parentsToKeep.map(t => t.id);

  // 2. Remove archived task definitions from tasks object
  tasksToArchive.forEach(({ id }) => {
    delete tasksData.tasks[id];
  });

  // 3. Slim down kept completed task definitions (archive full version, keep summary)
  parentsToKeep.forEach(({ id, task }) => {
    // First, archive the full definition
    archive.tasks[id + '_full'] = task;

    // Then slim down the kept definition
    const slim = {
      id: task.id,
      title: task.title,
      description: task.description?.substring(0, 100) + (task.description?.length > 100 ? '...' : ''),
      phase: task.phase,
      status: task.status,
      completedAt: task.completedAt || task.completed,
      completionNotes: task.completionNotes,
      childTaskIds: task.childTaskIds,
      parentTaskId: task.parentTaskId
    };
    tasksData.tasks[id] = slim;
  });

  // 4. Slim down completed children of in-progress parents (kept for hierarchy, but don't need full details)
  Object.entries(tasksData.tasks).forEach(([id, task]) => {
    if (task.status === 'completed' && task.parentTaskId) {
      const parent = tasksData.tasks[task.parentTaskId];
      if (parent && parent.status !== 'completed') {
        // Archive full definition
        archive.tasks[id + '_full'] = task;
        // Slim it down
        tasksData.tasks[id] = {
          id: task.id,
          title: task.title,
          phase: task.phase,
          status: task.status,
          parentTaskId: task.parentTaskId,
          completedAt: task.completedAt,
          completionNotes: task.completionNotes
        };
      }
    }
  });

  // 5. Add archival config
  tasksData.archival = {
    maxCompleted: MAX_COMPLETED_TO_KEEP,
    autoArchive: true,
    archivePath: '.claude/dev-docs/archives/tasks-archive.json',
    lastArchived: new Date().toISOString()
  };

  // Write files
  fs.writeFileSync(ARCHIVE_PATH, JSON.stringify(archive, null, 2));
  fs.writeFileSync(TASKS_PATH, JSON.stringify(tasksData, null, 2));

  console.log('\n=== Results ===');
  console.log(`Archive: ${Object.keys(archive.tasks).length} tasks saved to ${ARCHIVE_PATH}`);
  console.log(`tasks.json: ${Object.keys(tasksData.tasks).length} task definitions remaining`);
  console.log(`Completed list: ${tasksData.backlog.completed.tasks.length} tasks`);

  // Show file sizes
  const newSize = fs.statSync(TASKS_PATH).size;
  const archiveSize = fs.statSync(ARCHIVE_PATH).size;
  console.log(`\nFile sizes:`);
  console.log(`  tasks.json: ${(newSize / 1024).toFixed(1)} KB`);
  console.log(`  tasks-archive.json: ${(archiveSize / 1024).toFixed(1)} KB`);
}

main();
