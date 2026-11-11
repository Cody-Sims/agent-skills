# Resume-Safe Operational Ledger

Read only when creating or resuming persistent task tracking. This protocol
does not require SQL, a particular host schema, or a new database abstraction.

## Reconciliation Checklist

1. Identify the existing ledger, its runtime/application owner, supported read
   and write operations, and transaction guarantees. Inspect actual schema,
   required columns/defaults, keys, constraints, status vocabulary, rows, and
   dependency direction. Do not copy a schema from another host.
2. Recover the run namespace and task/stream/owner mapping from the checkpoint.
   Keep IDs stable across retries; give separate streams distinct IDs even if
   titles match. Reserve one writer for each affected scope. Serialize shared
   edge updates; transfer ownership explicitly before replacing a worker.
3. Compare intended tasks with observed rows and edges. Record each as:
   matching/reuse, absent/insert, incompatible/block, or uncertain/read further.
   A duplicate key is evidence to inspect, not proof the existing task matches.
   Preserve completed and in-progress state, descriptions, and dependencies.
   Reopening work or changing dependencies requires an explicit plan revision.
4. Build the smallest supported mutation set. Do not add columns to a runtime
   table to accommodate a guessed schema. Store unsupported optional metadata
   in the plan/checkpoint; stop if required semantics cannot be represented.
   New application tables need their own approved schema and exclusive owner;
   their creation does not authorize replacing runtime-owned tables.
5. Recheck under exclusive ownership before writing. Use a transaction only if
   the host explicitly supports its scope, connection lifetime, and rollback
   behavior. A SQL-looking tool may not support transaction control. Otherwise
   apply and verify one small change at a time. On any failure, inspect actual
   state, including transaction state when exposed, before retrying.
6. Read back affected tasks and edges. Check ownership, preserved statuses,
   endpoint existence, dependency direction, and absence of new cycles. Record
   confirmed changes, remaining conflicts, schema mapping, and next safe action
   in the existing checkpoint. Do not mark unfinished work done to clear a gate.

## Conditional SQLite-Style Example

Synthetic state only. Use these reads only if the host exposes SQLite catalog
queries and PRAGMAs. Other hosts need their documented schema-discovery API.

```sql
SELECT name, sql FROM sqlite_master WHERE type = 'table'
  AND name IN ('todos', 'todo_deps');
PRAGMA table_info(todos);
PRAGMA table_info(todo_deps);
PRAGMA index_list(todos);
PRAGMA foreign_key_list(todo_deps);
```

For this example, discovery confirms runtime-owned `todos(id PRIMARY KEY,
title, status)` and `todo_deps(todo_id, depends_on)` with a unique edge pair,
no other required columns, and `pending`, `in_progress`, `done` statuses.
This is not a schema to create or a promise about any runtime. The checkpoint
assigns `run-copper/ingest/*` to the ingest owner and
`run-copper/export/*` to the export owner; neither can write the other's rows.
Read all intended IDs, their prerequisites, and incident edges before writing:

```sql
SELECT id, title, status FROM todos
  WHERE id IN ('run-copper/ingest/scan', 'run-copper/ingest/normalize',
    'run-copper/ingest/verify', 'run-copper/export/normalize');
SELECT todo_id, depends_on FROM todo_deps
  WHERE todo_id LIKE 'run-copper/%' OR depends_on LIKE 'run-copper/%';
```

Observed rows: ingest `scan` is `done`, ingest `normalize` is `in_progress`,
export `normalize` is `pending`; both normalize tasks have title "Normalize".
The existing edge is ingest `normalize` depending on ingest `scan`.
The intended plan matches the ingest tasks and adds ingest `verify` after
ingest `normalize`. Reuse scan and normalize unchanged, leave export untouched,
retain the existing edge, and confirm verify and its edge are absent. Only
then, with the ingest writer reserved, apply and read back each missing write:

```sql
INSERT INTO todos (id, title, status)
  VALUES ('run-copper/ingest/verify', 'Verify', 'pending');
SELECT id, title, status FROM todos
  WHERE id = 'run-copper/ingest/verify';
```

Confirm the inserted row matches before adding the edge:

```sql
INSERT INTO todo_deps (todo_id, depends_on)
  VALUES ('run-copper/ingest/verify', 'run-copper/ingest/normalize');
SELECT todo_id, depends_on FROM todo_deps
  WHERE todo_id = 'run-copper/ingest/verify';
```

These are separate checked writes unless transaction support was established.
If the first succeeds and the second fails, reread both tables, reuse verify,
and repair only the still-missing edge after resolving the error. A retry of
both statements is not reconciliation. If an ID instead belongs to a different
purpose or owner, stop and resolve the conflict; do not ignore the duplicate.

If a later batch references a nonexistent `owner` column after earlier writes,
assume neither full success nor full rollback. Rediscover columns and read every
affected ID/edge. Preserve confirmed work, keep ownership in the checkpoint if
supported there, and retry only the compatible missing mutations. Do not reset
statuses, replay the whole batch, or migrate built-in tables as error recovery.
