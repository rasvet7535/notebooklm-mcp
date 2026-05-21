import { firefox } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const USER_DATA_DIR = resolve(__dirname, "./firefox-profile");
const STORAGE_FILE = resolve(__dirname, "storageState.json");
const USER_PROFILE = "C:\\Users\\RASVE\\AppData\\Roaming\\Mozilla\\Firefox\\Profiles\\8ribzkgy.default-release";
const NOTEBOOK_ID = "1cf6b25e-d2db-4a3c-bd0b-4d8017bf7fdc";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Copy real profile to Playwright profile dir
if (!fs.existsSync(USER_DATA_DIR)) fs.mkdirSync(USER_DATA_DIR, { recursive: true });
for (const entry of fs.readdirSync(USER_PROFILE)) {
  const src = path.join(USER_PROFILE, entry);
  const dst = path.join(USER_DATA_DIR, entry);
  try {
    if (entry === "extensions" && fs.statSync(src).isDirectory()) {
      fs.cpSync(src, dst, { recursive: true });
    } else if (entry.endsWith(".sqlite") || entry.endsWith(".json") || entry.endsWith(".js") || entry.endsWith(".db")) {
      if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
    }
  } catch {}
}

// Remove lock
try { fs.unlinkSync(path.join(USER_DATA_DIR, "parent.lock")); } catch {}

console.log("\n========== NotebookLM Auth Setup ==========");
console.log("1. Firefox откроется в видимом окне");
console.log("2. Дождись загрузки NotebookLM");
console.log("3. Если нужно — ВОЙДИ В GOOGLE в этом окне");
console.log("4. Открой НОУТБУК Pygmalion");
console.log("5. Скрипт сам сохранит сессию и продолжит");
console.log("===========================================\n");

const browser = await firefox.launchPersistentContext(USER_DATA_DIR, {
  headless: false,
  firefoxUserPrefs: {
    "dom.webdriver.enabled": false,
    "dom.webdriver.remote.enabled": false,
    "xpinstall.signatures.required": false,
    "extensions.autoDisableScopes": 0,
  },
  args: ["--no-sandbox"],
});

const page = browser.pages()[0] || await browser.newPage();
page.setDefaultTimeout(120000);

// Open main page
await page.goto("https://notebooklm.google.com", {
  waitUntil: "domcontentloaded", timeout: 60000
}).catch(() => {});

console.log("Waiting for you to log in and open the notebook...");
console.log("(Script will auto-detect and save when ready)\n");

// Wait loop - detect when user navigates to the notebook
for (let i = 0; i < 600; i++) {
  await sleep(5000);
  try {
    if (page.isClosed()) { console.log("Browser closed. Exiting."); process.exit(0); }
    const url = page.url();
    const body = await page.locator("body").textContent().catch(() => "");
    console.log(`  [${i*5}s] URL: ${url.substring(0, 70)} | Body: ${body.length}`);

    // Successfully on notebook page
    if (url.includes(`/notebook/${NOTEBOOK_ID}`) && body.length > 1000) {
      console.log("\n✓ Notebook page detected! Saving session...");
      await sleep(5000); // extra wait for full load
      await page.context().storageState({ path: STORAGE_FILE });
      console.log("✓ Session saved to storageState.json");

      // Now send the query
      const query = 'Что говорится в "Черной бумаге" о пределе эмиссии У.Е.? Каким должен быть лимит на одного участника?';
      console.log(`\nSending query: "${query.substring(0, 50)}..."`);

      // Remove readonly from textareas
      await page.evaluate(() => {
        document.querySelectorAll('textarea[readonly]').forEach(el => el.removeAttribute('readonly'));
      });
      await sleep(3000);

      // Fill input
      const filled = await page.evaluate((q) => {
        const areas = document.querySelectorAll('textarea');
        let target = null;
        for (const el of areas) {
          const r = el.getBoundingClientRect();
          const p = (el.placeholder || '').toLowerCase();
          if (r.width > 100 && !p.includes('источник')) { target = el; break; }
        }
        if (!target && areas.length > 0) target = areas[0];
        if (!target) return 'NO_INPUT';
        target.focus();
        target.value = q;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        return 'OK:' + (target.id || target.className.substring(0, 40));
      }, query);
      console.log(`Input: ${filled}`);

      // Wait for AI response
      console.log("\nWaiting for AI response (up to 3 min)...");
      const bodyBefore = await page.locator("body").textContent().catch(() => "");
      for (let j = 0; j < 60; j++) {
        await sleep(3000);
        const bodyNow = await page.locator("body").textContent().catch(() => "");
        if (bodyNow.length > bodyBefore.length + 500) {
          const newContent = bodyNow.substring(bodyBefore.length);
          console.log(`\n=== AI RESPONSE (${newContent.length} new chars) ===`);
          // Filter meaningful text
          const lines = newContent.split('\n').filter(l => l.trim().length > 20);
          console.log(lines.join('\n').substring(0, 10000));
          console.log("\n=== END ===");
          // Save to file
          fs.writeFileSync(resolve(__dirname, "ai-response.txt"), newContent, 'utf8');
          console.log("Response saved to ai-response.txt");
          break;
        }
        if (j % 5 === 4) console.log(`  waiting... ${(j+1)*3}s`);
      }
      console.log("\n✓ Done! Browser stays open for inspection.");
      break;
    }

    // On main page with notebook list
    if (body.length > 2000 && url.includes("notebooklm") && !url.includes("signin") && !url.includes("403")) {
      console.log("  → On main page. Try navigating to notebook...");
      await page.goto(`https://notebooklm.google.com/notebook/${NOTEBOOK_ID}`, {
        waitUntil: "domcontentloaded", timeout: 30000
      }).catch(() => {});
    }
  } catch (e) {
    console.log("  Error:", e.message.substring(0, 50));
  }
}

console.log("\nCtrl+C to exit. Firefox stays open.");
await new Promise(() => {});
