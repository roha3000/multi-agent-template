#!/usr/bin/env node
/**
 * View Hook Debug Logs
 *
 * Shows the hook debug log with filtering and formatting.
 * Usage:
 *   node scripts/view-hook-debug.js          # Show last 50 entries
 *   node scripts/view-hook-debug.js -f       # Follow mode (tail -f)
 *   node scripts/view-hook-debug.js -n 100   # Show last 100 entries
 *   node scripts/view-hook-debug.js -h hook  # Filter by hook name
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const LOG_FILE = path.join(__dirname, '..', '.claude', 'logs', 'hook-debug.log');

const args = process.argv.slice(2);
let numLines = 50;
let follow = false;
let hookFilter = null;

// Parse args
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-f' || args[i] === '--follow') {
    follow = true;
  } else if (args[i] === '-n' && args[i + 1]) {
    numLines = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '-h' && args[i + 1]) {
    hookFilter = args[i + 1];
    i++;
  } else if (args[i] === '--help') {
    console.log(`
View Hook Debug Logs

Usage:
  node scripts/view-hook-debug.js [options]

Options:
  -f, --follow    Follow mode (like tail -f)
  -n <num>        Number of entries to show (default: 50)
  -h <hook>       Filter by hook name
  --help          Show this help

Log file: ${LOG_FILE}
`);
    process.exit(0);
  }
}

function formatEntry(entry) {
  const time = entry.ts.split('T')[1].split('.')[0]; // HH:MM:SS
  const pid = String(entry.pid).padStart(6);
  const hook = (entry.hook || 'unknown').padEnd(20);
  const event = (entry.event || '-').padEnd(15);

  // Format additional data
  const data = { ...entry };
  delete data.ts;
  delete data.pid;
  delete data.ppid;
  delete data.hook;
  delete data.event;
  const dataStr = Object.keys(data).length > 0 ? JSON.stringify(data) : '';

  return `${time} [${pid}] ${hook} ${event} ${dataStr}`;
}

function readLastLines(filePath, n) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n').filter(line => line.length > 0);

  return lines.slice(-n);
}

function displayEntries(lines, filter) {
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (!filter || entry.hook === filter || entry.event?.includes(filter)) {
        console.log(formatEntry(entry));
      }
    } catch (e) {
      // Skip invalid lines
    }
  }
}

// Main
console.log(`Hook Debug Log: ${LOG_FILE}`);
console.log(`Showing last ${numLines} entries${hookFilter ? ` (filter: ${hookFilter})` : ''}`);
console.log('='.repeat(80));

if (!fs.existsSync(LOG_FILE)) {
  console.log('No debug log file found. Run some hooks to generate log entries.');
  process.exit(0);
}

const lines = readLastLines(LOG_FILE, numLines);
displayEntries(lines, hookFilter);

if (follow) {
  console.log('\n--- Following log (Ctrl+C to stop) ---\n');

  // Watch for new entries
  let lastSize = fs.statSync(LOG_FILE).size;

  fs.watchFile(LOG_FILE, { interval: 100 }, (curr, prev) => {
    if (curr.size > lastSize) {
      const fd = fs.openSync(LOG_FILE, 'r');
      const buffer = Buffer.alloc(curr.size - lastSize);
      fs.readSync(fd, buffer, 0, buffer.length, lastSize);
      fs.closeSync(fd);

      const newContent = buffer.toString('utf-8');
      const newLines = newContent.trim().split('\n').filter(l => l.length > 0);
      displayEntries(newLines, hookFilter);

      lastSize = curr.size;
    }
  });

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    fs.unwatchFile(LOG_FILE);
    console.log('\nStopped following.');
    process.exit(0);
  });
}
