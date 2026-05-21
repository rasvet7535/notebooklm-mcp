import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { firefox } from "playwright";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

const NOTEBOOK_ID   = process.env.NOTEBOOK_ID || "";
const USER_DATA_DIR = path.resolve(process.env.USER_DATA_DIR || "./firefox-profile");
const HEADLESS      = process.env.HEADLESS === "true";
const NOTEBOOKLM_URL = "https://notebooklm.google.com";

let browser = null;
let page = null;
let loginAttempted = false;

async function getPage() {
  if (page && !page.isClosed()) return page;

  if (!fs.existsSync(USER_DATA_DIR)) fs.mkdirSync(USER_DATA_DIR, { recursive: true });

  browser = await firefox.launchPersistentContext(USER_DATA_DIR, {
    headless: HEADLESS,
    args: ["--no-sandbox", "--disable-gpu"],
  });

  const pages = browser.pages();
  page = pages[0] || await browser.newPage();
  page.setDefaultTimeout(60000);
  return page;
}

async function navigateWithRetry(url, label) {
  const p = await getPage();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await p.waitForTimeout(2000);
      return p.url();
    } catch (e) {
      console.error(`[nlmcp] ${label} attempt ${attempt + 1} failed:`, e.message.substring(0, 80));
    }
  }
  return p.url();
}

async function waitForLogin(p) {
  for (let i = 0; i < 120; i++) {
    const url = p.url();
    if (url.includes("notebooklm.google.com") && !url.includes("signin") && !url.includes("accounts") && !url.includes("Error") && !url.includes("403")) {
      console.error(`[nlmcp] On NotebookLM after ${i * 5}s`);
      return true;
    }
    if (i % 12 === 0) console.error(`[nlmcp] Waiting for login... (${i * 5}s) URL: ${url.substring(0, 80)}`);
    await p.waitForTimeout(5000);
  }
  return false;
}

async function ensureNotebookLM() {
  const p = await getPage();
  let url = p.url();
  console.error("[nlmcp] Current URL:", url.substring(0, 100));

  // Already on NotebookLM and not on error page
  if (url.includes("notebooklm.google.com") && !url.includes("signin") && !url.includes("accounts") && !url.includes("403")) {
    if (NOTEBOOK_ID && !url.includes(NOTEBOOK_ID)) {
      const nbUrl = `${NOTEBOOKLM_URL}/notebook/${NOTEBOOK_ID}`;
      url = await navigateWithRetry(nbUrl, "notebook-nav");
      if (url.includes("403") || url.includes("Error")) {
        // Notebook 403 — go back to main page
        console.error("[nlmcp] Notebook returns 403, falling back to main page");
        await p.goto(NOTEBOOKLM_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
        await p.waitForTimeout(3000);
      }
    }
    return p;
  }

  // Navigate to main page
  url = await navigateWithRetry(NOTEBOOKLM_URL, "main-nav");
  if (url.includes("signin") || url.includes("accounts")) {
    if (!loginAttempted) {
      loginAttempted = true;
      console.error("[nlmcp] Login required. Firefox visible — please log in.");
      const ok = await waitForLogin(p);
      if (!ok) return p;
    }
  }

  if (NOTEBOOK_ID) {
    const nbUrl = `${NOTEBOOKLM_URL}/notebook/${NOTEBOOK_ID}`;
    url = await navigateWithRetry(nbUrl, "notebook-nav");
    if (url.includes("403") || url.includes("Error")) {
      console.error("[nlmcp] Notebook returns 403 — showing main page instead");
      await p.goto(NOTEBOOKLM_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    }
  }

  return p;
}

async function getPageSnapshot(p) {
  const body = await p.locator("body").textContent().catch(() => "");
  const title = await p.title().catch(() => "");
  const url = p.url();

  const links = await p.locator("a").all();
  const linkData = [];
  for (const l of links) {
    const href = await l.getAttribute("href").catch(() => "");
    const text = await l.textContent().catch(() => "");
    if (href) linkData.push({ text: text.trim().substring(0, 60), href: href.substring(0, 120) });
  }

  return { url, title, bodyLength: body.length, links: linkData, bodySnippet: body.substring(0, 2000) };
}

async function findChatInput(p) {
  for (const sel of ['textarea', '[contenteditable="true"]', '[role="textbox"]', 'div[contenteditable="true"]', '.ql-editor', 'input:not([type="hidden"])']) {
    const el = p.locator(sel).first();
    if (await el.count().then(c => c > 0).catch(() => false)) {
      if (await el.isVisible().catch(() => false)) {
        console.error("[nlmcp] Input found:", sel);
        return el;
      }
    }
  }
  return null;
}

async function ask(p, query) {
  const snap = await getPageSnapshot(p);
  console.error("[nlmcp] Page:", snap.url, "| body:", snap.bodyLength, "bytes");

  if (snap.url.includes("signin") || snap.url.includes("accounts")) {
    return { type: "login_required", text: "Требуется вход в Google. Firefox visible — залогиньтесь." };
  }

  if (snap.url.includes("403") || snap.url.includes("Error 403") || snap.bodyLength < 200) {
    let extra = "";
    if (snap.links.length > 0) {
      extra = "\n\nСсылки на странице:\n" + snap.links.map(l => `  "${l.text}" -> ${l.href}`).join("\n");
    }
    return { type: "forbidden", text: `403 Forbidden на URL: ${snap.url}.${extra}` };
  }

  const input = await findChatInput(p);
  if (!input) {
    return {
      type: "no_input",
      text: `Не найден поле ввода.\nURL: ${snap.url}\nРазмер: ${snap.bodyLength} bytes\n\nСтраница:\n${snap.bodySnippet}`,
      snapshot: snap,
    };
  }

  await input.click();
  await input.fill(query);
  await p.keyboard.press("Enter");
  await p.waitForTimeout(8000);

  const lastResp = p.locator('[class*="response"], [class*="message"], [class*="answer"], [class*="result"]').last();
  try {
    const answer = await lastResp.textContent({ timeout: 30000 });
    return { type: "answer", text: answer || "(пустой ответ)" };
  } catch {
    // Try again with longer wait
    await p.waitForTimeout(10000);
    try {
      const answer = await lastResp.textContent({ timeout: 20000 });
      return { type: "answer", text: answer || "(пустой ответ)" };
    } catch {
      return { type: "timeout", text: "(таймаут ожидания ответа AI)" };
    }
  }
}

// ── MCP Server ──────────────────────────────────────────────────────

const server = new Server(
  { name: "notebooklm-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_notebooklm",
      description: "Search within the current Google NotebookLM notebook.",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
    {
      name: "ask_notebooklm",
      description: "Ask a question to the Google NotebookLM notebook.",
      inputSchema: { type: "object", properties: { query: { type: "string" }, mode: { type: "string", enum: ["chat", "note"], default: "chat" } }, required: ["query"] },
    },
    {
      name: "list_notebooks",
      description: "List available notebooks on the NotebookLM main page (use if specific notebook returns 403).",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "notebooklm_status",
      description: "Check current NotebookLM page status — URL, auth state, page content summary.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const p = await ensureNotebookLM();

    if (name === "notebooklm_status") {
      const snap = await getPageSnapshot(p);
      return { content: [{ type: "text", text: JSON.stringify(snap, null, 2) }] };
    }

    if (name === "list_notebooks") {
      // Go to main page and list available notebooks
      await p.goto(NOTEBOOKLM_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      await p.waitForTimeout(5000);
      const snap = await getPageSnapshot(p);
      return { content: [{ type: "text", text: JSON.stringify(snap, null, 2) }] };
    }

    if (name === "search_notebooklm" || name === "ask_notebooklm") {
      const result = await ask(p, String(args.query));
      return { content: [{ type: "text", text: result.text }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
