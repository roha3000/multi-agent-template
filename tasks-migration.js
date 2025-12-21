#!/usr/bin/env node

/**
 * Migrate tasks from tasks.md to tasks.json
 *
 * Reads tasks.md and converts to structured tasks.json format
 *
 * Usage: node tasks-migration.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const TaskManager = require('./.claude/core/task-manager');

const DRY_RUN = process.argv.includes('--dry-run');

function migrateTasks() {
  const tasksPath = path.join(process.cwd(), 'tasks.md');

  if (!fs.existsSync(tasksPath)) {
    console.log('No tasks.md found. Skipping migration.');
    return;
  }

  console.log('Reading tasks.md...');
  const tasksMarkdown = fs.readFileSync(tasksPath, 'utf8');

  const taskManager = new TaskManager();
  const lines = tasksMarkdown.split('\n');

  let currentPhase = 'implementation';
  let currentSection = 'now';
  let tasksCreated = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect phase headings
    if (line.startsWith('##')) {
      const heading = line.replace(/^##\s+/, '').toLowerCase();
      if (heading.includes('research')) current Phase = 'research';
      else if (heading.includes('planning')) currentPhase = 'planning';
      else if (heading.includes('design')) currentPhase = 'design';
      else if (heading.includes('implementation') || heading.includes('implement')) currentPhase = 'implementation';
      else if (heading.includes('test')) currentPhase = 'testing';
      else if (heading.includes('validation')) currentPhase = 'validation';
    }

    // Detect backlog sections
    if (line.toLowerCase().includes('session ') || line.toLowerCase().includes('phase ')) {
      // Section headers - could map to tiers
      currentSection = 'next';
    }

    // Extract task from markdown checkbox
    const match = line.match(/^-\s+\[(x| )\]\s+(.+)$/i);
    if (match) {
      const [, checked, title] = match;
      const status = checked.toLowerCase() === 'x' ? 'completed' : 'ready';

      // Try to extract metadata from title
      let priority = 'medium';
      let estimate = '2h';
      let tags = [];
      let cleanTitle = title;

      // Parse inline metadata like "Title (priority:high, estimate:4h)"
      const metaMatch = title.match(/^(.+?)\s*\((.+?)\)$/);
      if (metaMatch) {
        cleanTitle = metaMatch[1].trim();
        const metaStr = metaMatch[2];

        const priorityMatch = metaStr.match(/priority:\s*(\w+)/i);
        if (priorityMatch) priority = priorityMatch[1].toLowerCase();

        const estimateMatch = metaStr.match(/estimate:\s*([0-9.]+[hd])/i);
        if (estimateMatch) estimate = estimateMatch[1];

        const tagsMatch = metaStr.match(/tags?:\s*([^,;]+)/i);
        if (tagsMatch) tags = tagsMatch[1].split(/[,;]/).map(t => t.trim());
      }

      // Infer tags from title keywords
      if (cleanTitle.toLowerCase().includes('auth')) tags.push('auth');
      if (cleanTitle.toLowerCase().includes('test')) tags.push('testing');
      if (cleanTitle.toLowerCase().includes('security')) tags.push('security');
      if (cleanTitle.toLowerCase().includes('dashboard')) tags.push('dashboard');
      if (cleanTitle.toLowerCase().includes('api')) tags.push('api');

      if (DRY_RUN) {
        console.log(`[DRY RUN] Would create: ${cleanTitle}`);
        console.log(`  Phase: ${currentPhase}, Priority: ${priority}, Tier: ${currentSection}, Status: ${status}`);
      } else {
        try {
          taskManager.createTask({
            title: cleanTitle,
            phase: currentPhase,
            priority,
            estimate,
            tags: [...new Set(tags)], // Deduplicate
            status,
            backlogTier: currentSection
          });
          tasksCreated++;
        } catch (error) {
          console.error(`Error creating task "${cleanTitle}":`, error.message);
        }
      }
    }
  }

  if (!DRY_RUN) {
    console.log(`\n✓ Migration complete. Created ${tasksCreated} tasks in tasks.json`);
    console.log('\nNext steps:');
    console.log('  1. Review tasks.json to verify migration');
    console.log('  2. Run "node task-cli.js backlog" to see summary');
    console.log('  3. Optionally rename tasks.md to tasks.md.bak');
  } else {
    console.log(`\n[DRY RUN] Would create ${tasksCreated} tasks`);
    console.log('\nRun without --dry-run to perform migration');
  }
}

try {
  migrateTasks();
} catch (error) {
  console.error('Migration failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
