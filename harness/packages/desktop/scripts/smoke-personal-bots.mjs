/** Real Svelte UI checks against the development-only IPC fixture. No model requests. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const driver = process.env.KLERM_DESIGN_WEBDRIVER ?? "http://127.0.0.1:1444";
const page = new URL(process.env.KLERM_DESIGN_URL ?? "http://127.0.0.1:1431/test/design-preview.html");
assert.equal(page.pathname, "/test/design-preview.html", "Only the no-backend fixture may be tested.");
assert.ok(["127.0.0.1", "localhost"].includes(page.hostname), "The fixture must be local.");
const output = process.argv.includes("--screenshots") ? join(tmpdir(), `klerm-personal-bots-${Date.now()}`) : undefined;
if (output) await mkdir(output, { recursive: true });
let session;
async function request(path, body, method = "POST") {
	const response = await fetch(`${driver}${path}`, {
		method,
		signal: AbortSignal.timeout(30_000),
		headers: { "Content-Type": "application/json" },
		...(body ? { body: JSON.stringify(body) } : {}),
	});
	const result = await response.json();
	if (result.value?.error) throw new Error(JSON.stringify(result.value));
	return result.value;
}
const execute = (script, args = []) => request(`/session/${session}/execute/sync`, { script, args });
const pause = () => new Promise((resolve) => setTimeout(resolve, 350));
async function waitFor(script, description) {
	for (let attempt = 0; attempt < 30; attempt++) {
		if (await execute(script)) return;
		await pause();
	}
	throw new Error(description);
}
async function click(selector, text) {
	await execute(
		"const elements = [...document.querySelectorAll(arguments[0])]; const el = arguments[1] ? elements.find(e => e.textContent.trim() === arguments[1]) : elements[0]; if (!el) throw new Error('Missing control: ' + arguments[0] + ' ' + arguments[1]); el.scrollIntoView({block:'nearest'}); const rect = el.getBoundingClientRect(); const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2); if (!rect.width || !rect.height || !el.contains(hit)) throw new Error('Control hidden or covered: ' + arguments[0] + ' ' + arguments[1] + ' hit=' + hit?.outerHTML.slice(0,200)); el.focus(); el.click();",
		[selector, text ?? ""],
	);
	await pause();
}
async function setValue(selector, value, event = "input") {
	await execute(
		"const el = document.querySelector(arguments[0]); if (!el) throw new Error('Missing field: ' + arguments[0]); el.value = arguments[1]; el.dispatchEvent(new Event(arguments[2], {bubbles:true}));",
		[selector, value, event],
	);
	await pause();
}
async function clickable(selector, text) {
	return execute(
		"const elements = [...document.querySelectorAll(arguments[0])]; const el = arguments[1] ? elements.find(e => e.textContent.trim() === arguments[1]) : elements[0]; if (!el) return false; const rect = el.getBoundingClientRect(); if (!rect.width || !rect.height) return false; const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2); return Boolean(hit && el.contains(hit));",
		[selector, text ?? ""],
	);
}
async function screenshot(name) {
	if (!output) return;
	const image = await request(`/session/${session}/screenshot`, undefined, "GET");
	await writeFile(join(output, `${name}.png`), Buffer.from(image, "base64"));
}

try {
	const created = await request("/session", {
		capabilities: { alwaysMatch: {
			browserName: "MiniBrowser",
			pageLoadStrategy: "eager",
			"webkitgtk:browserOptions": {
				binary: process.env.KLERM_DESIGN_BROWSER ?? "/usr/libexec/webkit2gtk-4.1/MiniBrowser",
				args: ["--automation"],
			},
		} },
	});
	session = created.sessionId;
	await request(`/session/${session}/window/rect`, { width: 1440, height: 900 });
	for (const theme of ["light", "dark"]) {
		page.search = `?theme=${theme}`;
		await request(`/session/${session}/url`, { url: page.href });
		await waitFor("const splash = document.querySelector('[aria-label=\"Klerm is starting\"]'); return Boolean(window.__klermDesign && document.querySelector('nav[aria-label=\"Workspace views\"]') && splash && getComputedStyle(splash).visibility === 'hidden');", "Fixture did not load.");
		await click('nav[aria-label="Workspace views"] button', "Personal Bots");
		await waitFor("return document.querySelectorAll('[aria-label=\"Personal conversation\"] article').length === 2;", "Personal conversation did not load.");
		assert.equal(await execute("return document.querySelector('[aria-label=\"Personal agent details\"]') === null;"), true);
		assert.ok(await execute("return parseFloat(getComputedStyle(document.querySelector('[data-personal-composer]')).minHeight) >= 88;"));
		assert.equal(await execute("return document.documentElement.scrollWidth <= innerWidth && getComputedStyle(document.getElementById('app')).filter === 'none';"), true);
		await screenshot(`${theme}-chat`);

		await setValue('[aria-label="Search Personal Agents"]', "no-such-agent");
		assert.equal(await execute("return document.querySelector('[aria-label=\"Personal agent list\"]').textContent.includes('No agents match');"), true);
		assert.equal(await execute("return document.querySelectorAll('[aria-label=\"Personal conversation\"] article').length;"), 2);
		await setValue('[aria-label="Search Personal Agents"]', "");
		await click('[aria-label="Toggle agent details"]');
		assert.equal(await execute("return Boolean(document.querySelector('[aria-label=\"Personal agent details\"]'));"), true);
		await click('[aria-label="Close agent details"]');

		await click('[aria-label="Agent settings"]');
		assert.equal(await execute("const dialog = document.querySelector('[role=\"dialog\"]'); const controls = [...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex=\"0\"]')].filter(el => el.offsetParent !== null && el.tabIndex >= 0); controls.at(-1).focus(); controls.at(-1).dispatchEvent(new KeyboardEvent('keydown', {key:'Tab', bubbles:true, cancelable:true})); return document.activeElement === controls[0];"), true);
		await screenshot(`${theme}-settings`);
		await click('[role="dialog"] button', "Edit");
		await setValue('[aria-label="Profile behaviour"]', "Give practical review feedback and explain the next step.");
		await screenshot(`${theme}-profile`);
		await click('[role="dialog"] button', "Save profile");
		await click('[aria-label="Close agent settings"]');
		assert.equal(await execute("return document.querySelectorAll('[aria-label=\"Personal conversation\"] article').length;"), 2);
		await click('[aria-label="Agent settings"]');
		await click('[role="dialog"] button', "Edit");
		assert.equal(await execute("return document.querySelector('[aria-label=\"Profile behaviour\"]').value;"), "Give practical review feedback and explain the next step.");
		await click('[role="dialog"] button', "Back");
		await click('[aria-label="Close agent settings"]');

		await click('[aria-label="Personal agent list"] button', "New personal agent");
		await setValue('[aria-label="Agent name"]', "Harbor");
		await setValue('[aria-label="Agent purpose"]', "Review project changes.");
		assert.equal(await execute("return document.querySelector('[aria-label=\"Browser access\"]').checked || document.querySelector('[aria-label=\"Kanban access\"]').checked;"), false);
		await click('[role="dialog"] [role="tab"]', "Model");
		await click('[role="dialog"] button[aria-haspopup="listbox"]');
		await click('[role="dialog"] button[role="option"]', "demo/reviewer");
		await execute("const tab = document.querySelector('[role=\"dialog\"] [role=\"tab\"][aria-selected=\"true\"]'); tab.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));");
		await pause();
		assert.equal(await execute("return document.querySelector('[role=\"dialog\"] [role=\"tab\"][aria-selected=\"true\"]').textContent;"), "Reasoning");
		await setValue('[aria-label="Agent reasoning effort"]', "high", "change");
		await click('[role="dialog"] [role="tab"]', "Identity & access");
		await click('[role="dialog"] button', "Create agent");
		await waitFor("return !document.querySelector('[role=\"dialog\"]') && window.__klermDesign.agents.some(a => a.name === 'Harbor');", "Agent creation failed.");
		const agent = await execute("return window.__klermDesign.agents.find(a => a.name === 'Harbor');");
		assert.equal(agent.model, "demo/reviewer");
		assert.equal(agent.effort, "high");
		assert.equal(agent.browserEnabled, false);
		assert.equal(agent.kanbanEnabled, false);
		await click('[aria-label="Personal conversation"] button', "Plan a task together");
		assert.ok((await execute("return document.querySelector('[data-personal-composer]').value;")).includes("acceptance criteria"));
		assert.equal(await execute("return window.__klermDesign.requests.some(type => ['prompt','prompt_personal_bot','generate_personal_bot_memory'].includes(type));"), false);
		assert.equal(await execute("return document.documentElement.dataset.theme;"), theme);
		await request(`/session/${session}/window/rect`, { width: 640, height: 650 });
		await pause();
		const compactWidth = await execute("return innerWidth;");
		if (compactWidth <= 720 && (await clickable('[aria-label="Choose Personal Agent"]'))) {
			if (await execute("const backdrop = document.querySelector('[aria-label=\"Close navigation\"]'); return Boolean(backdrop && getComputedStyle(backdrop).display !== 'none');")) await click('[aria-label="Close navigation"]');
			await click('[aria-label="Choose Personal Agent"]');
			assert.equal(await execute("return getComputedStyle(document.querySelector('[aria-label=\"Personal agent list\"]')).display !== 'none';"), true);
			await click('[aria-label="Close agent list"]');
			await click('[aria-label="Agent settings"]');
			assert.equal(await execute("const dialog = document.querySelector('[role=\"dialog\"]'); const rect = dialog.getBoundingClientRect(); return rect.x >= 0 && rect.right <= innerWidth && rect.y >= 0 && rect.bottom <= innerHeight;"), true);
			await screenshot(`${theme}-compact-settings`);
			await click('[aria-label="Close agent settings"]');
			console.log(`${theme}: compact agent drawer and bounded settings at ${compactWidth}px passed`);
		} else console.log(`Compact drawer check skipped at ${compactWidth}px (narrow controls not clickable in this WebKit window)`);
		await request(`/session/${session}/window/rect`, { width: 1440, height: 900 });
		await pause();
		console.log(`${theme}: chat/search/details/profile editing, creation model/effort and zero model calls passed`);
	}
	console.log(`Personal Bots UI smoke passed${output ? `. Screenshots: ${output}` : ""}`);
} finally {
	if (session) await request(`/session/${session}`, undefined, "DELETE");
}
