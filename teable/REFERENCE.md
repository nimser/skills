# Teable reference

Verified against a Teable instance's own OpenAPI document (`GET /docs`, spec
embedded in `docs/swagger-ui-init.js`). Fetch that spec from the instance being
driven when a detail matters — versions differ.

## Field types

```
singleLineText  longText  user  attachment  checkbox  multipleSelect  singleSelect
date  number  rating  formula  rollup  conditionalRollup  link
createdTime  lastModifiedTime  createdBy  lastModifiedBy  autoNumber  button
```

### Option shapes

`singleSelect` / `multipleSelect`

```json
{ "choices": [ { "name": "ready", "color": "greenBright" }, { "name": "blocked", "color": "redBright" } ],
  "preventAutoNewOptions": true }
```

`preventAutoNewOptions` stops a stray write from inventing a state.

`date` — all three keys are required

```json
{ "formatting": { "date": "YYYY-MM-DD", "time": "None", "timeZone": "UTC" } }
```

Presets: `M/D/YYYY`, `D/M/YYYY`, `YYYY/MM/DD`, `YYYY-MM-DD`, `YYYY-MM`, `MM-DD`,
`YYYY`, `MM`, `DD`. Time: `HH:mm`, `hh:mm A`, `None`. `defaultValue: "now"` fills
new rows with the current time. Formatting is display only; the stored value stays
a timestamp, which is why sorting and filtering work.

`number`

```json
{ "formatting": { "type": "decimal", "precision": 2 },
  "showAs": { "type": "bar", "color": "blueBright", "showValue": true, "maxValue": 100 } }
```

Formatting types: `decimal`, `percent`, `currency` (adds `"symbol"`). `showAs`
renders `bar` or `ring` in the cell — a score column becomes a chart for free.

`rating`

```json
{ "icon": "star", "color": "yellowBright", "max": 5 }
```

Icons: `star moon sun zap flame heart apple thumb-up`. Colors: `yellowBright`,
`redBright`, `tealBright` only.

### Colors

Each hue in five shades: `<hue>Light2 <hue>Light1 <hue>Bright <hue> <hue>Dark1`,
for hues `blue cyan gray green orange pink purple red teal yellow`.

## View types

`grid  kanban  gallery  calendar  form  plugin`

- **kanban** — `{ "stackFieldId": "fld…", "coverFieldId": null, "isFieldNameHidden": true, "isEmptyStackHidden": false }`.
  The stack field must be a `singleSelect` (or user) field. This is the reason to
  type a status column properly: a text status cannot stack.
- **gallery** — `{ "coverFieldId": "fld…", "isCoverFit": true }`, cover must be an attachment field.
- **calendar** — `{ "startDateFieldId": "fld…", "endDateFieldId": "fld…", "titleFieldId": "fld…", "colorConfig": { "type": "field", "fieldId": "fld…" } }`.
- **grid** — `{ "rowHeight": "short|medium|tall|extraTall|autoFit", "frozenFieldId": "fld…" }`.

Per-view column visibility is `PUT /table/{tableId}/view/{viewId}/column-meta`
with `[{ "fieldId": "fld…", "columnMeta": { "hidden": true } }]`. Hiding is per
view, so the same table can show a clean board and a raw grid.

## Endpoints used by `teable.js`

| Purpose | Call |
|---|---|
| tables in a base | `GET /api/base/{baseId}/table/` |
| create table with fields | `POST /api/base/{baseId}/table/` — `{ name, description, fields: [...], records: [] }` |
| fields | `GET /api/table/{tableId}/field` |
| add field | `POST /api/table/{tableId}/field` |
| change a field's type in place | `PUT /api/table/{tableId}/field/{fieldId}/convert` |
| dry-run a conversion | `POST /api/table/{tableId}/field/plan` |
| views | `GET|POST /api/table/{tableId}/view` |
| view options | `PATCH /api/table/{tableId}/view/{viewId}/options` |
| column visibility | `PUT /api/table/{tableId}/view/{viewId}/column-meta` |
| view sort / group / filter | `PUT /api/table/{tableId}/view/{viewId}/{sort,group,filter}` |
| records | `GET /api/table/{tableId}/record?fieldKeyType=name&take=200&skip=0` |
| create / update | `POST /api/table/{tableId}/record`, `PATCH /api/table/{tableId}/record/{recordId}` |

Auth is `Authorization: Bearer <token>` on every call. `fieldKeyType=name` lets
records be addressed by field name instead of field id — worth it everywhere
except when a field gets renamed.

## Record deep link

`{baseUrl}/base/{baseId}/{tableId}/{viewId}?recordId={recordId}` opens one record
in its view. That is the link to put in a notification when a human has to look
at, or approve, a single row.

## Sharp edges

- A `date` conversion drops values it cannot parse. Read the column first.
- `singleSelect` conversion creates choices for existing values, uncoloured;
  pass `choices` explicitly to control colour and order.
- Records write JSON `null`, not `""`, to clear a cell.
- Paging is `take`/`skip`; `take` caps at 1000, and a page shorter than `take`
  means the end.
- A filter passed on a query string is a URL-encoded JSON object:
  `filter={"conjunction":"and","filterSet":[{"fieldId":"state","operator":"is","value":"ready"}]}`.
