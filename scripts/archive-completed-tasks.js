#!/usr/bin/env node
/**
 * Archive old completed tasks to reduce tasks.json size
 * Keeps the N most recently completed tasks, archives the rest
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

  console.log(`Found ${completedIds.length} completed tasks`);
  console.log(`Will keep ${MAX_COMPLETED_TO_KEEP}, archive ${completedIds.length - MAX_COMPLETED_TO_KEEP}\n`);

  // Get completed tasks with their timestamps
  const completedTasks = completedIds
    .map(id => {
      const task = tasksData.tasks[id];
      if (!task) {
        console.warn(`Warning: Task ${id} in completed list but no definition found`);
        return null;
      }
      return {
        id,
        task,
        completedAt: task.completed ? new Date(task.completed).getTime() : 0
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.completedAt - a.completedAt); // Most recent first

  // Split into keep and archive
  const tasksToKeep = completedTasks.slice(0, MAX_COMPLETED_TO_KEEP);
  const tasksToArchive = completedTasks.slice(MAX_COMPLETED_TO_KEEP);

  console.log('Tasks to KEEP (most recent):');
  tasksToKeep.forEach(t => {
    console.log(`  - ${t.id} (completed: ${t.task.completed || 'no timestamp'})`);
  });

  console.log(`\nTasks to ARCHIVE (${tasksToArchive.length}):`);
  tasksToArchive.slice(0, 5).forEach(t => {
    console.log(`  - ${t.id}`);
  });
  if (tasksToArchive.length > 5) {
    console.log(`  ... and ${tasksToArchive.length - 5} more`);
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
  // 1. Update completed list to only keep recent IDs
  tasksData.backlog.completed.tasks = tasksToKeep.map(t => t.id);

  // 2. Remove archived task definitions from tasks object
  tasksToArchive.forEach(({ id }) => {
    delete tasksData.tasks[id];
  });

  // 3. Add archival config
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
