#!/usr/bin/env node
/**
 * Migration Script: Add hierarchy fields to all tasks
 *
 * This script adds explicit hierarchy fields to all tasks in:
 * - .claude/dev-docs/tasks.json (active tasks)
 * - .claude/dev-docs/archives/tasks-archive.json (archived tasks)
 *
 * After running this migration, backward compatibility code can be removed
 * from task-manager.js since all tasks will have explicit hierarchy fields.
 *
 * Usage: node scripts/migrate-tasks-hierarchy.js
 */

const fs = require('fs');
const path = require('path');

const HIERARCHY_DEFAULTS = {
  parentTaskId: null,
  childTaskIds: [],
  delegatedTo: null,
  delegationDepth: 0,
  decomposition: null
};

function migrateTask(task) {
  return {
    ...HIERARCHY_DEFAULTS,
    ...task,
    // Ensure arrays are arrays (not undefined from spread)
    childTaskIds: task.childTaskIds || [],
  };
}

function migrateFile(filePath, fileDescription) {
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  ${fileDescription}: File not found, skipping`);
    return { migrated: 0, skipped: 0 };
  }

  console.log(`📄 ${fileDescription}: ${filePath}`);

  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let migrated = 0;
  let skipped = 0;

  // Handle tasks object (both active and archive formats)
  const tasksObj = data.tasks || {};

  Object.keys(tasksObj).forEach(taskId => {
    const task = tasksObj[taskId];

    // Check if already has hierarchy fields
    const hasHierarchy = task.hasOwnProperty('parentTaskId') &&
                         task.hasOwnProperty('childTaskIds') &&
                         task.hasOwnProperty('delegationDepth');

    if (hasHierarchy) {
      skipped++;
    } else {
      tasksObj[taskId] = migrateTask(task);
      migrated++;
    }
  });

  // Update version if present
  if (data.version) {
    data.version = '1.1.0';
  }
  if (data.metadata) {
    data.metadata.version = '1.1.0';
    data.metadata.hierarchyMigration = new Date().toISOString();
  }

  // Write back
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

  console.log(`   ✅ Migrated: ${migrated} tasks`);
  console.log(`   ⏭️  Skipped (already had fields): ${skipped} tasks`);

  return { migrated, skipped };
}

function main() {
  console.log('🔄 Task Hierarchy Migration\n');
  console.log('Adding explicit hierarchy fields to all tasks...\n');

  const baseDir = path.join(__dirname, '..');

  // Migrate active tasks
  const activeTasksPath = path.join(baseDir, '.claude', 'dev-docs', 'tasks.json');
  const activeResult = migrateFile(activeTasksPath, 'Active Tasks');

  console.log('');

  // Migrate archived tasks
  const archivePath = path.join(baseDir, '.claude', 'dev-docs', 'archives', 'tasks-archive.json');
  const archiveResult = migrateFile(archivePath, 'Archived Tasks');

  console.log('\n' + '='.repeat(50));
  console.log('📊 Migration Summary');
  console.log('='.repeat(50));
  console.log(`Total migrated: ${activeResult.migrated + archiveResult.migrated} tasks`);
  console.log(`Total skipped:  ${activeResult.skipped + archiveResult.skipped} tasks`);
  console.log('\n✨ Migration complete!');
  console.log('\nNext steps:');
  console.log('1. Remove _ensureHierarchyFields() from task-manager.js');
  console.log('2. Remove defaultHierarchyFields property');
  console.log('3. Update tests that check backward compatibility');
}

main();
