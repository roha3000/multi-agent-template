#!/usr/bin/env node
/**
 * Migration script: Add _concurrency field for optimistic locking
 *
 * This script adds optimistic locking support to tasks.json files by adding
 * a _concurrency field with version tracking.
 *
 * Run: node scripts/migrate-tasks-concurrency.js
 */

const fs = require('fs');
const path = require('path');

const TASKS_PATH = path.join(process.cwd(), '.claude', 'dev-docs', 'tasks.json');
const ARCHIVE_PATH = path.join(process.cwd(), '.claude', 'dev-docs', 'archives', 'tasks-archive.json');

/**
 * Creates a timestamped backup of a file
 */
function createBackup(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.backup-concurrency-${timestamp}`;

  try {
    fs.copyFileSync(filePath, backupPath);
    return backupPath;
  } catch (error) {
    console.error(`  ERROR: Failed to create backup: ${error.message}`);
    return null;
  }
}

/**
 * Reads and parses a JSON file
 */
function readJsonFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`  ERROR: Failed to read/parse file: ${error.message}`);
    return null;
  }
}

/**
 * Writes an object to a JSON file with pretty formatting
 */
function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error(`  ERROR: Failed to write file: ${error.message}`);
    return false;
  }
}

/**
 * Creates the _concurrency field object
 */
function createConcurrencyField() {
  return {
    version: 1,
    lastModifiedBy: 'migration-script',
    lastModifiedAt: new Date().toISOString()
  };
}

/**
 * Migrates a single tasks file to add _concurrency field
 */
function migrateFile(filePath, fileDescription) {
  console.log(`\nProcessing ${fileDescription}:`);
  console.log(`  Path: ${filePath}`);

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    console.log('  Status: File not found - SKIPPED');
    return { success: false, skipped: true, error: null };
  }

  console.log('  Status: File found');

  // Read the file
  const data = readJsonFile(filePath);
  if (data === null) {
    return { success: false, skipped: false, error: 'Failed to read file' };
  }

  // Check if _concurrency already exists
  if (data._concurrency) {
    console.log('  Status: _concurrency field already exists - SKIPPED');
    console.log(`    Current version: ${data._concurrency.version}`);
    console.log(`    Last modified by: ${data._concurrency.lastModifiedBy}`);
    console.log(`    Last modified at: ${data._concurrency.lastModifiedAt}`);
    return { success: true, skipped: true, error: null };
  }

  // Create backup
  console.log('  Creating backup...');
  const backupPath = createBackup(filePath);
  if (!backupPath) {
    return { success: false, skipped: false, error: 'Failed to create backup' };
  }
  console.log(`  Backup created: ${backupPath}`);

  // Add _concurrency field at the beginning
  const migratedData = {
    _concurrency: createConcurrencyField(),
    ...data
  };

  // Write the migrated file
  console.log('  Adding _concurrency field...');
  if (!writeJsonFile(filePath, migratedData)) {
    return { success: false, skipped: false, error: 'Failed to write migrated file' };
  }

  // Validate the written file
  console.log('  Validating migration...');
  const validationData = readJsonFile(filePath);
  if (!validationData) {
    return { success: false, skipped: false, error: 'Failed to validate migrated file' };
  }

  if (!validationData._concurrency) {
    return { success: false, skipped: false, error: 'Validation failed: _concurrency field not found' };
  }

  if (validationData._concurrency.version !== 1) {
    return { success: false, skipped: false, error: 'Validation failed: version is not 1' };
  }

  console.log('  Status: Migration SUCCESSFUL');
  console.log('    - _concurrency field added');
  console.log('    - version: 1');
  console.log(`    - lastModifiedBy: migration-script`);
  console.log(`    - lastModifiedAt: ${validationData._concurrency.lastModifiedAt}`);

  return { success: true, skipped: false, error: null };
}

/**
 * Main migration function
 */
function migrate() {
  console.log('=== Tasks Concurrency Migration ===');
  console.log('Adding optimistic locking support to tasks files\n');
  console.log(`Current working directory: ${process.cwd()}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  const results = {
    tasksFile: null,
    archiveFile: null
  };

  // Migrate main tasks.json
  results.tasksFile = migrateFile(TASKS_PATH, 'Main tasks file');

  // Migrate archive file
  results.archiveFile = migrateFile(ARCHIVE_PATH, 'Archive file');

  // Summary
  console.log('\n=== Migration Summary ===\n');

  const files = [
    { name: 'tasks.json', result: results.tasksFile },
    { name: 'tasks-archive.json', result: results.archiveFile }
  ];

  let totalMigrated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const file of files) {
    let status;
    if (file.result.error) {
      status = `ERROR: ${file.result.error}`;
      totalErrors++;
    } else if (file.result.skipped) {
      status = file.result.success ? 'Already migrated' : 'Not found';
      totalSkipped++;
    } else if (file.result.success) {
      status = 'Migrated successfully';
      totalMigrated++;
    } else {
      status = 'Unknown status';
    }
    console.log(`  ${file.name}: ${status}`);
  }

  console.log('');
  console.log(`  Files migrated: ${totalMigrated}`);
  console.log(`  Files skipped: ${totalSkipped}`);
  console.log(`  Errors: ${totalErrors}`);

  if (totalErrors > 0) {
    console.log('\nMigration completed with errors. Please check the output above.');
    process.exit(1);
  } else {
    console.log('\nMigration completed successfully.');
    process.exit(0);
  }
}

// Run migration
migrate();
