import { firefox } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const USER_DATA_DIR = resolve(__dirname, "./firefox-profile");
const STORAGE_FILE = resolve(__dirname, "storageState.json");
const NOTEBOOK_ID = "1cf6b25e-d2db-4a3c-bd0b-4d8017bf7fdc";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

try { fs.unlinkSync(path.join(USER_DATA_DIR, "parent.lock")); } catch {}

console.log("Launching...");
const browser = await firefox.launchPersistentContext(USER_DATA_DIR, {
  headless: false,
  firefoxUserPrefs: { "dom.webdriver.enabled": false },
  args: ["--no-sandbox"],
});

const page = browser.pages()[0] || await browser.newPage();
page.setDefaultTimeout(120000);

// Use URL with ?tab=chat to load chat directly
await page.goto(`https://notebooklm.google.com/notebook/${NOTEBOOK_ID}?tab=chat`, {
  waitUntil: "domcontentloaded", timeout: 60000
}).catch(() => {});

for (let i = 0; i < 20; i++) {
  await sleep(3000);
  const b = await page.locator("body").textContent().catch(() => "");
  console.log(`  [${i*3}s] ${b.length}b`);
  if (b.length > 8000) break;
}

await page.context().storageState({ path: STORAGE_FILE }).catch(() => {});
console.log("Session saved.\n");

// Find the CHAT textarea (not the "discover sources" one)
// Chat has placeholder "Задайте вопрос" similar, sources has "Найдите новые источники"
const chatInput = page.locator('textarea').filter({ hasNot: page.locator('[placeholder*="источник"]') }).first();
const count = await chatInput.count().catch(() => 0);
console.log(`Chat textarea found: ${count > 0}`);

if (count > 0) {
  const pl = await chatInput.getAttribute('placeholder').catch(() => '?');
  console.log(`Placeholder: "${pl}"`);
  
  // Remove readonly from ALL textareas
  await page.evaluate(() => {
    document.querySelectorAll('textarea[readonly]').forEach(el => el.removeAttribute('readonly'));
  });
  await sleep(1000);
  
  const query = 'Что говорится в "Черной бумаге" о пределе эмиссии У.Е.? Каким должен быть лимит на одного участника?';
  console.log(`Query: ${query.substring(0, 50)}...`);
  
  // Use evaluate to bypass overlay intercept
  await page.evaluate((q) => {
    // Find the chat textarea (not the sources one)
    const areas = document.querySelectorAll('textarea');
    let target = null;
    for (const a of areas) {
      const p = (a.placeholder || '').toLowerCase();
      if (!p.includes('источник') && !p.includes('source') && a.offsetParent !== null) {
        target = a; break;
      }
    }
    if (!target) {
      // Fallback: any visible, big enough textarea
      for (const a of areas) {
        const r = a.getBoundingClientRect();
        if (r.width > 200 && r.height > 15) { target = a; break; }
      }
    }
    if (!target) return 'NO_INPUT';
    
    // Focus and set value
    target.removeAttribute('readonly');
    target.focus();
    target.value = q;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    return 'OK:' + target.id + ' pl="' + target.placeholder + '"';
  }, query);
  
  console.log(`Input filled: ${await page.evaluate(() => 'filled')}`);
  
  // Now press Enter via Playwright keyboard
  await page.keyboard.press("Enter");
  console.log("✓ Enter pressed");
  
  // Wait for AI response
  console.log("\nWaiting for AI...");
  const bodyBefore = await page.locator("body").textContent().catch(() => "");
  
  for (let i = 0; i < 50; i++) {
    await sleep(3000);
    const bodyNow = await page.locator("body").textContent().catch(() => "");
    const diff = bodyNow.length - bodyBefore.length;
    if (diff > 3000) {
      const newContent = bodyNow.substring(bodyBefore.length);
      console.log(`\n=== AI RESPONSE (+${diff}b) ===`);
      const readable = [...newContent.matchAll(/[А-Я][А-Яа-я\s,\-—()0-9"«»]{40,}/g)].map(m => m[0]).join('\n\n');
      console.log(readable.substring(0, 10000));
      fs.writeFileSync(resolve(__dirname, "ai-response.txt"), newContent, 'utf8');
      console.log("\n=== END ===");
      break;
    }
    if (diff > 200) console.log(`  ${(i+1)*3}s +${diff}b`);
    if (i % 5 === 4) console.log(`  ${(i+1)*3}s waiting... (+${diff})`);
  }
}

const final = await page.locator("body").textContent().catch(() => "");
fs.writeFileSync(resolve(__dirname, "page-dump.txt"), final, 'utf8');
console.log(`\nSaved: page-dump.txt (${final.length}b)`);
await browser.close();
console.log("Closed. Main Firefox untouched.");
