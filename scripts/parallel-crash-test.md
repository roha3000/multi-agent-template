# Parallel Session Crash Test

Run these prompts in two separate Claude CLI sessions to test concurrent file access.

## Setup

1. Open two terminal windows
2. `cd` to this project in both
3. Start Claude CLI in both: `claude`
4. Run the prompts below simultaneously (within ~2 seconds of each other)

---

## Test 1: Simultaneous Task Status Updates

**Goal:** Both sessions update task status at the same time, triggering concurrent writes to tasks.json

**Session A - Run this:**
```
Update task parallel-crash-fix to status in_progress, then immediately update it to completed, then back to in_progress. Do this 5 times in rapid succession using the task-manager directly by running: node -e "const tm = new (require('./.claude/core/task-manager'))(); for(let i=0; i<5; i++) { tm.updateTask('parallel-crash-fix', {status: i%2 ? 'completed' : 'in_progress'}); console.log('A:', i); }"
```

**Session B - Run this at the same time:**
```
Update task parallel-crash-fix to status completed, then immediately update it to in_progress, then back to completed. Do this 5 times in rapid succession using the task-manager directly by running: node -e "const tm = new (require('./.claude/core/task-manager'))(); for(let i=0; i<5; i++) { tm.updateTask('parallel-crash-fix', {status: i%2 ? 'in_progress' : 'completed'}); console.log('B:', i); }"
```

---

## Test 2: Simultaneous Task Creation

**Goal:** Both sessions create new tasks at the same time

**Session A:**
```
Run this command to create tasks rapidly: node -e "const tm = new (require('./.claude/core/task-manager'))(); for(let i=0; i<10; i++) { tm.createTask({id: 'test-a-'+Date.now()+'-'+i, title: 'Test A '+i, phase: 'research'}); } console.log('Done A');"
```

**Session B (run within 1 second):**
```
Run this command to create tasks rapidly: node -e "const tm = new (require('./.claude/core/task-manager'))(); for(let i=0; i<10; i++) { tm.createTask({id: 'test-b-'+Date.now()+'-'+i, title: 'Test B '+i, phase: 'research'}); } console.log('Done B');"
```

---

## Test 3: Read While Writing (Most Likely Crash Scenario)

**Goal:** One session writes repeatedly while the other reads repeatedly

**Session A (Writer) - Start this first:**
```
Run this write loop: node -e "const tm = new (require('./.claude/core/task-manager'))(); let i=0; setInterval(() => { tm.updateTask('parallel-crash-fix', {updated: new Date().toISOString(), counter: i++}); console.log('Write', i); }, 50);" &
```

**Session B (Reader) - Start immediately after:**
```
Run this read loop: node -e "const tm = new (require('./.claude/core/task-manager'))(); let i=0; setInterval(() => { tm.load(); console.log('Read', i++, 'tasks:', Object.keys(tm.tasks.tasks || {}).length); }, 30);"
```

Let both run for 10-20 seconds, then Ctrl+C to stop.

---

## Test 4: File Edit Conflicts (Claude's Native Behavior)

**Goal:** Both sessions edit the same file using Claude's Edit tool

**Session A:**
```
Edit the file .claude/dev-docs/plan.md and add a line at the end that says "Session A was here at [current timestamp]". Then read the file to confirm.
```

**Session B (run at same time):**
```
Edit the file .claude/dev-docs/plan.md and add a line at the end that says "Session B was here at [current timestamp]". Then read the file to confirm.
```

---

## Test 5: SQLite Database Concurrent Access

**Goal:** Both sessions query/write to SQLite databases simultaneously

**Session A:**
```
Run: node -e "const CoordDB = require('./.claude/core/coordination-db'); const db = new CoordDB('./.coordination/test-parallel.db'); for(let i=0; i<20; i++) { db.registerSession('session-a-'+i, '/test', 'test'); } console.log('A done');"
```

**Session B:**
```
Run: node -e "const CoordDB = require('./.claude/core/coordination-db'); const db = new CoordDB('./.coordination/test-parallel.db'); for(let i=0; i<20; i++) { db.registerSession('session-b-'+i, '/test', 'test'); } console.log('B done');"
```

---

## Test 6: Heavy Research with File Watching

**Goal:** Both sessions do research that involves reading many files

**Session A:**
```
Search the entire codebase for all uses of "writeFileSync" and summarize where atomic writes might be needed. Read at least 10 different files.
```

**Session B:**
```
Search the entire codebase for all uses of "readFileSync" and identify potential race conditions. Read at least 10 different files.
```

---

## What to Watch For

1. **Crash without error** - CLI just exits
2. **JSON parse errors** - "Unexpected token" or "Unexpected end of JSON"
3. **EBUSY errors** - "resource busy or locked"
4. **SQLITE_BUSY** - Database lock timeout
5. **File corruption** - tasks.json becomes invalid

## After Testing

Check the logs:
```bash
# Hook debug log (if hooks are enabled)
cat .claude/logs/hook-debug.log | tail -50

# Check tasks.json validity
node -e "require('./.claude/dev-docs/tasks.json'); console.log('Valid')"

# Check for temp files left behind
ls -la .claude/dev-docs/*.tmp 2>/dev/null
```

## Cleanup

Remove test tasks:
```bash
node -e "
const tm = new (require('./.claude/core/task-manager'))();
const toRemove = Object.keys(tm.tasks.tasks).filter(id => id.startsWith('test-a-') || id.startsWith('test-b-'));
toRemove.forEach(id => tm.deleteTask(id));
console.log('Removed', toRemove.length, 'test tasks');
"
```
