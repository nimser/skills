#!/usr/bin/env node
// teable — schema-first CLI for a Teable base over the REST API. No dependencies.
// Auth: TEABLE_TOKEN. Host: TEABLE_BASE_URL (default https://app.teable.io).

const BASE_URL = (process.env.TEABLE_BASE_URL || "https://app.teable.io").replace(/\/$/, "");
const TOKEN = process.env.TEABLE_TOKEN || "";

const USAGE = `teable.js — Teable schema and records

  tables <baseId>
  fields <tableId>
  views  <tableId>
  create-table <baseId> --name N --fields <json-file|-> [--description D]
  add-field    <tableId> --name N --type T [--choices "a,b:green"] [--date-format F] [--time T] [--precision N] [--max N] [--icon I]
  convert      <tableId> <fieldName> --type T [same options as add-field]
  create-view  <tableId> --name N --type grid|kanban|gallery|calendar|form [--stack fieldName] [--cover fieldName]
  hide         <tableId> <viewId> <fieldName...>
  show         <tableId> <viewId> <fieldName...>
  records      <tableId> [--take N] [--skip N] [--fields a,b] [--view viewId]
  upsert       <tableId> --key fieldName --json '<record json>'
  link         <baseId> <tableId> <viewId> <recordId>      print a record deep link

Field types: singleLineText longText checkbox singleSelect multipleSelect date
number rating user attachment link formula rollup autoNumber button
createdTime lastModifiedTime createdBy lastModifiedBy`;

function die(message) {
	console.error(`teable: ${message}`);
	process.exit(1);
}

async function api(method, path, body) {
	if (!TOKEN) die("TEABLE_TOKEN is not set");
	const response = await fetch(`${BASE_URL}/api${path}`, {
		method,
		headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: AbortSignal.timeout(30_000),
	});
	const text = await response.text();
	if (!response.ok) die(`${method} ${path} → ${response.status} ${text.slice(0, 300)}`);
	return text ? JSON.parse(text) : undefined;
}

function parseFlags(argv) {
	const flags = {};
	const positional = [];
	for (let index = 0; index < argv.length; index++) {
		const token = argv[index];
		if (token.startsWith("--")) flags[token.slice(2)] = argv[index + 1]?.startsWith("--") || argv[index + 1] === undefined ? true : argv[++index];
		else positional.push(token);
	}
	return { flags, positional };
}

/** "ready,blocked:red,done:greenBright" → choices with explicit colours where given. */
function choicesOf(spec) {
	return String(spec)
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry) => {
			const [name, color] = entry.split(":");
			return color ? { name, color } : { name };
		});
}

function optionsFor(type, flags) {
	switch (type) {
		case "singleSelect":
		case "multipleSelect":
			if (!flags.choices) return undefined;
			return { choices: choicesOf(flags.choices), preventAutoNewOptions: flags.strict === true };
		case "date":
			return { formatting: { date: flags["date-format"] || "YYYY-MM-DD", time: flags.time || "None", timeZone: flags.tz || "UTC" } };
		case "number":
			return { formatting: { type: flags.format || "decimal", precision: Number(flags.precision ?? 0), ...(flags.symbol ? { symbol: flags.symbol } : {}) } };
		case "rating":
			return { icon: flags.icon || "star", color: flags.color || "yellowBright", max: Number(flags.max ?? 5) };
		default:
			return undefined;
	}
}

async function fieldByName(tableId, name) {
	const fields = await api("GET", `/table/${tableId}/field`);
	const found = fields.find((field) => field.name === name || field.id === name);
	if (!found) die(`no field '${name}' in ${tableId}`);
	return found;
}

const [command, ...rest] = process.argv.slice(2);
const { flags, positional } = parseFlags(rest);

const commands = {
	async tables([baseId]) {
		for (const table of await api("GET", `/base/${baseId}/table/`)) console.log(`${table.id}\t${table.name}`);
	},
	async fields([tableId]) {
		for (const field of await api("GET", `/table/${tableId}/field`)) {
			const detail = field.options?.choices ? field.options.choices.map((choice) => choice.name).join("|") : field.options?.formatting ? JSON.stringify(field.options.formatting) : "";
			console.log(`${field.id}\t${field.name}\t${field.type}\t${detail}`);
		}
	},
	async views([tableId]) {
		for (const view of await api("GET", `/table/${tableId}/view`)) console.log(`${view.id}\t${view.name}\t${view.type}`);
	},
	async "create-table"([baseId]) {
		const source = flags.fields === "-" ? require("node:fs").readFileSync(0, "utf8") : require("node:fs").readFileSync(flags.fields, "utf8");
		const created = await api("POST", `/base/${baseId}/table/`, { name: flags.name, description: flags.description || undefined, fields: JSON.parse(source), records: [] });
		console.log(`${created.id}\t${created.name}`);
	},
	async "add-field"([tableId]) {
		const options = optionsFor(flags.type, flags);
		const created = await api("POST", `/table/${tableId}/field`, { name: flags.name, type: flags.type, ...(options ? { options } : {}) });
		console.log(`${created.id}\t${created.name}\t${created.type}`);
	},
	async convert([tableId, name]) {
		const field = await fieldByName(tableId, name);
		const options = optionsFor(flags.type, flags);
		const converted = await api("PUT", `/table/${tableId}/field/${field.id}/convert`, { name: field.name, type: flags.type, ...(options ? { options } : {}) });
		console.log(`${converted.id}\t${converted.name}\t${converted.type}`);
	},
	async "create-view"([tableId]) {
		const type = flags.type || "grid";
		let options;
		if (type === "kanban") {
			if (!flags.stack) die("a kanban view needs --stack <singleSelect field>");
			const stack = await fieldByName(tableId, flags.stack);
			if (stack.type !== "singleSelect" && stack.type !== "user") die(`--stack must be singleSelect or user, '${stack.name}' is ${stack.type}`);
			options = { stackFieldId: stack.id, isEmptyStackHidden: flags["hide-empty"] === true };
		}
		if (type === "gallery" && flags.cover) options = { coverFieldId: (await fieldByName(tableId, flags.cover)).id, isCoverFit: true };
		const created = await api("POST", `/table/${tableId}/view`, { name: flags.name, type, ...(options ? { options } : {}) });
		console.log(`${created.id}\t${created.name}\t${created.type}`);
	},
	async hide([tableId, viewId, ...names]) {
		await setVisibility(tableId, viewId, names, true);
	},
	async show([tableId, viewId, ...names]) {
		await setVisibility(tableId, viewId, names, false);
	},
	async records([tableId]) {
		const query = new URLSearchParams({ fieldKeyType: "name", take: String(flags.take ?? 50), skip: String(flags.skip ?? 0) });
		if (flags.view) query.set("viewId", flags.view);
		if (flags.fields) for (const name of String(flags.fields).split(",")) query.append("projection", name.trim());
		const page = await api("GET", `/table/${tableId}/record?${query}`);
		for (const record of page.records ?? []) console.log(JSON.stringify({ id: record.id, ...record.fields }));
	},
	async upsert([tableId]) {
		const record = JSON.parse(String(flags.json));
		const key = String(flags.key);
		const value = record[key];
		if (value === undefined) die(`--json has no '${key}' field`);
		const filter = encodeURIComponent(JSON.stringify({ conjunction: "and", filterSet: [{ fieldId: key, operator: "is", value }] }));
		const found = await api("GET", `/table/${tableId}/record?fieldKeyType=name&take=1&filter=${filter}`);
		const existing = found.records?.[0];
		if (!existing) {
			await api("POST", `/table/${tableId}/record`, { fieldKeyType: "name", records: [{ fields: record }] });
			return console.log(`created ${value}`);
		}
		const changed = Object.entries(record).filter(([name, next]) => JSON.stringify(existing.fields[name] ?? null) !== JSON.stringify(next ?? null));
		if (!changed.length) return console.log(`unchanged ${value}`);
		await api("PATCH", `/table/${tableId}/record/${existing.id}`, { fieldKeyType: "name", record: { fields: record } });
		console.log(`updated ${value} (${changed.map(([name]) => name).join(",")})`);
	},
	async link([baseId, tableId, viewId, recordId]) {
		console.log(`${BASE_URL}/base/${baseId}/${tableId}/${viewId}?recordId=${recordId}`);
	},
};

async function setVisibility(tableId, viewId, names, hidden) {
	const [fields, views] = await Promise.all([api("GET", `/table/${tableId}/field`), api("GET", `/table/${tableId}/view`)]);
	const view = views.find((candidate) => candidate.id === viewId);
	if (!view) die(`no view '${viewId}' in ${tableId}`);
	// Teable's unions differ by view: grid uses `hidden`, kanban/gallery use `visible`.
	// The wrong one is accepted on write but makes the view projection unreadable afterwards.
	const columnMeta = view.type === "kanban" || view.type === "gallery" ? { visible: !hidden } : { hidden };
	const payload = names.map((name) => {
		const field = fields.find((candidate) => candidate.name === name || candidate.id === name);
		if (!field) die(`no field '${name}' in ${tableId}`);
		return { fieldId: field.id, columnMeta };
	});
	await api("PUT", `/table/${tableId}/view/${viewId}/column-meta`, payload);
	console.log(`${hidden ? "hidden" : "shown"}: ${names.join(", ")}`);
}

if (!command || command === "--help" || !commands[command]) {
	console.log(USAGE);
	process.exit(command && command !== "--help" ? 1 : 0);
}
commands[command](positional).catch((error) => die(error.message));
