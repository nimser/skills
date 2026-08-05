---
name: teable
description: Design and drive Teable bases over the REST API — typed fields (select, date, number, rating, checkbox), kanban/gallery/calendar views, records. Use when creating or changing a Teable table, when a table is all text columns, or when a board has to be readable by a human rather than only by an agent.
---

# Teable

A Teable table is a UI, not a JSON blob with a URL. The field type decides
whether a human can scan, group, filter and sort it — pick it before writing.

## Quick start

```bash
export TEABLE_BASE_URL=https://your.teable.host   # cloud: https://app.teable.io
export TEABLE_TOKEN=...                           # personal access token
{baseDir}/teable.js tables <baseId>               # id, name of every table
{baseDir}/teable.js fields <tableId>              # id, name, type of every field
{baseDir}/teable.js views  <tableId>              # id, name, type of every view
```

## Never default to text

`singleLineText` is the wrong answer for anything with a shape. Before adding a
field, answer: *is this a fixed set, a date, a quantity, a flag?*

| Data | Type | Why |
|---|---|---|
| Fixed set of states, one per row | `singleSelect` | coloured chips, groupable, **required for a kanban stack** |
| Fixed set, several per row (tags) | `multipleSelect` | filterable chips |
| A point in time | `date` | real sorting and date filters; format `YYYY-MM-DD` reads unambiguously anywhere |
| A count, a cost, a score | `number` | numeric sort, aggregation, `showAs` bar/ring |
| 1–5 severity or confidence | `rating` | scannable at a glance |
| Yes/no | `checkbox` | filterable, one glyph wide |
| Prose a human reads | `longText` | |
| A URL | `singleLineText` + `showAs` link, or `button` | clickable |
| Structured payload only an agent reads | `longText`, hidden in human views | last resort — see below |

An ISO date stored as text sorts lexically by luck and filters not at all. A
state stored as text has no colour, no stack, no validation.

## When one table serves a human and an agent

Keep the machine payload, hide it. One table can carry both audiences:

- Typed, human-legible fields first: title, state (`singleSelect`), score
  (`number`), dates (`date`), a one-line `why`.
- JSON payloads (`evidence`, `budget`, checks…) in `longText` fields that are
  hidden in every human view and visible only in a "raw" grid view.
- The kanban stacks on the state field; the grid view is the agent's surface.

```bash
{baseDir}/teable.js create-view <tableId> --name Board --type kanban --stack state
{baseDir}/teable.js hide <tableId> <viewId> evidence budget dod   # hide in this view only
```

## Changing an existing table

Converting keeps the data and rewrites the column in place — no re-import:

```bash
{baseDir}/teable.js convert <tableId> state --type singleSelect --choices "queued,running,done:green,blocked:red"
{baseDir}/teable.js convert <tableId> last_seen --type date --date-format YYYY-MM-DD --time None
```

Convert is destructive when a value does not fit the new type (a non-date text
becomes empty). Read the column first: `{baseDir}/teable.js records <tableId> --fields last_seen`.

## Records

```bash
{baseDir}/teable.js records <tableId> [--take 50] [--fields a,b]
{baseDir}/teable.js upsert  <tableId> --key fingerprint --json '{"fingerprint":"a1","state":"ready"}'
```

`upsert` matches on the key field and PATCHes when it finds one, POSTs otherwise,
and writes nothing when every field already holds that value.

## Full type and option reference

Field option shapes, view option shapes, colour names and the underlying REST
endpoints: [REFERENCE.md](REFERENCE.md).
