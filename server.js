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

const NOTEBOOK_ID    = process.env.NOTEBOOK_ID || "1cf6b25e-d2db-4a3c-bd0b-4d8017bf7fdc";
const USER_DATA_DIR  = path.resolve(process.env.USER_DATA_DIR || "./firefox-profile");
const STORAGE_FILE   = path.resolve("storageState.json");

let browserCtx = null;
let page = null;
let ready = false;

async function launch() {
  const hasSession = fs.existsSync(STORAGE_FILE);

  browserCtx = await firefox.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    firefoxUserPrefs: {
      "dom.webdriver.enabled": false,
      "dom.webdriver.remote.enabled": false,
      "xpinstall.signatures.required": false,
      "extensions.autoDisableScopes": 0,
    },
    args: ["--no-sandbox", "--disable-gpu"],
  });

  page = browserCtx.pages()[0] || await browserCtx.newPage();

  if (hasSession) {
    console.error("[nlmcp] Session found, navigating to notebook...");
    await page.goto("https://notebooklm.google.com", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    waitForReady();
    return;
  }

  console.error("[nlmcp] ===============================================================");
  console.error("[nlmcp] VISIBLE BRIDGE MODE — первый запуск / сессия не найдена");
  console.error("[nlmcp] Подключи SandVPN, войди в Google, открой ноутбук Pygmalion.");
  console.error("[nlmcp] Сервер будет ждать сколько нужно.");
  console.error("[nlmcp] Сессия сохранится АВТОМАТИЧЕСКИ после входа.");
  console.error("[nlmcp] ===============================================================");
  waitForReady();
}

async function waitForReady() {
  let blockedCount = 0;
  while (true) {
    try {
      if (page.isClosed()) { await sleep(3000); continue; }
      const url = page.url();
      const body = await page.locator("body").textContent().catch(() => "");

      // Notebook loaded — use ?tab=chat for direct chat access
      if (url.includes("/notebook/") && body.length > 1500) {
        const chatUrl = url.includes("?tab=chat") ? url : url.split("?")[0] + "?tab=chat";
        if (!url.includes("?tab=chat")) {
          console.error("[nlmcp] ?tab=chat not in URL, navigating...");
          await page.goto(chatUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
          await sleep(3000);
        }
        console.error(`[nlmcp] Notebook ready`);
        await saveSession();
        ready = true;
        return;
      }

      // Main page with content — try clicking Pygmalion
      if (body.length > 2000 && url.includes("notebooklm") && !url.includes("signin") && !url.includes("accounts") && !url.includes("403")) {
        console.error(`[nlmcp] Main page loaded, looking for notebook...`);
        const allEls = await page.locator('a, [role="button"], [class*="card"], [class*="notebook"]').all();
        let clicked = false;
        for (const el of allEls) {
          const text = await el.textContent().catch(() => "");
          const href = await el.getAttribute("href").catch(() => "") || "";
          if (href.includes(NOTEBOOK_ID) || text?.includes("Pygmalion") || text?.includes("pygmalion")) {
            await el.click();
            await sleep(5000);
            const url2 = page.url();
            if (url2.includes("/notebook/")) {
              const chatUrl = url2.split("?")[0] + "?tab=chat";
              await page.goto(chatUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
              await sleep(3000);
              console.error(`[nlmcp] Notebook ready (from list)`);
              await saveSession();
              ready = true;
              return;
            }
            clicked = true;
            break;
          }
        }
        if (!clicked) {
          await saveSession();
          ready = true;
          return;
        }
      }

      // Blocked — retry
      if (body.length < 500 || url.includes("403") || url.includes("Error")) {
        blockedCount++;
        if (blockedCount > 24) {
          console.error(`[nlmcp] Still blocked after ${blockedCount * 5}s. Retrying navigation...`);
          try { await page.goto("https://notebooklm.google.com", { waitUntil: "domcontentloaded", timeout: 30000 }); } catch {}
          blockedCount = 0;
        }
      } else {
        blockedCount = 0;
      }
    } catch {}
    await sleep(5000);
  }
}

async function saveSession() {
  try {
    await page.context().storageState({ path: STORAGE_FILE });
    const stats = fs.statSync(STORAGE_FILE);
    console.error(`[nlmcp] Session saved (${(stats.size / 1024).toFixed(1)} KB)`);
  } catch (e) {
    console.error(`[nlmcp] Session save failed: ${e.message}`);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitReady() { while (!ready) await sleep(1000); return page; }

async function ask(query) {
  const p = await waitReady();
  const url = p.url();

  // Navigate to ?tab=chat if not already there
  if (!url.includes("?tab=chat")) {
    const chatUrl = url.split("?")[0] + "?tab=chat";
    console.error("[nlmcp] Navigating to ?tab=chat...");
    await p.goto(chatUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await sleep(3000);
  }

  const bodyBefore = await p.locator("body").textContent().catch(() => "");
  console.error("[nlmcp] URL:", url.substring(0, 120), "| Body:", bodyBefore.length, "chars");

  // Find chat input
  let input = null;
  for (const sel of ['textarea', '[contenteditable="true"]', '[role="textbox"]', '.ql-editor']) {
    const el = p.locator(sel).first();
    if (await el.count().then(c => c > 0).catch(() => false) && await el.isVisible().catch(() => false)) {
      input = el; break;
    }
  }

  if (!input) {
    return `Input field not found.\nURL: ${url}\n\n${bodyBefore.substring(0, 3000)}`;
  }

  // Send query
  await input.click();
  await input.fill(query);
  await p.keyboard.press("Enter");
  console.error("[nlmcp] Query sent, waiting for AI response...");

  // Wait up to 90 seconds for Angular to process and render
  await p.waitForTimeout(30000);
  console.error("[nlmcp] 30s elapsed, checking for response...");

  // Try to find response containers
  const respSelectors = ['[class*="chat"]', '[class*="conversation"]', '[class*="message"]', '[class*="response"]', 'main', 'article', '[role="main"]'];
  for (const sel of respSelectors) {
    const el = p.locator(sel).last();
    if (await el.count().then(c => c > 0).catch(() => false)) {
      const text = await el.textContent().catch(() => "");
      if (text && text.length > 100) {
        console.error(`[nlmcp] Response from ${sel}: ${text.length} chars`);
        return text.substring(0, 10000);
      }
    }
  }

  // Additional wait for slow responses
  console.error("[nlmcp] No response yet, waiting 60s more...");
  await p.waitForTimeout(60000);

  for (const sel of respSelectors) {
    const el = p.locator(sel).last();
    if (await el.count().then(c => c > 0).catch(() => false)) {
      const text = await el.textContent().catch(() => "");
      if (text && text.length > 100) {
        console.error(`[nlmcp] Response after 90s from ${sel}: ${text.length} chars`);
        return text.substring(0, 10000);
      }
    }
  }

  // Fallback — return whatever is on page
  const bodyAfter = await p.locator("body").textContent().catch(() => "");
  console.error("[nlmcp] Fallback: returning full body");
  return bodyAfter.substring(0, 10000) || "(empty response)";
}

const server = new Server({ name: "notebooklm-mcp", version: "1.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "ask_notebooklm",
      description: "Ask a question to the Google NotebookLM notebook. Uses Visible Bridge Mode with ?tab=chat bypass.",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
    {
      name: "notebooklm_status",
      description: "Check current NotebookLM page status (URL, body size, session validity).",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (!browserCtx) await launch();

    if (name === "notebooklm_status") {
      const p = await waitReady();
      const url = p.url();
      const body = await p.locator("body").textContent().catch(() => "");
      return { content: [{ type: "text", text: JSON.stringify({ url, bodyLength: body.length }, null, 2) }] };
    }

    if (name === "ask_notebooklm") {
      const result = await ask(String(args.query));
      return { content: [{ type: "text", text: result }] };
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

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
