import { firefox } from "playwright";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import fs from "fs";
import path from "path";
import readline from "readline";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const profileDir = resolve(__dirname, process.env.USER_DATA_DIR || "./firefox-profile");
const STORAGE_FILE = resolve(__dirname, process.env.STORAGE_FILE || "storageState.json");
const REAL_FIREFOX = "C:\\Program Files\\Mozilla Firefox\\firefox.exe";
const userProfile = "C:\\Users\\RASVE\\AppData\\Roaming\\Mozilla\\Firefox\\Profiles\\8ribzkgy.default-release";

// Prepare profile: copy extensions + auth tokens from user's real Firefox
if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });
const extSrc = path.join(userProfile, "extensions");
const extDst = path.join(profileDir, "extensions");
if (fs.existsSync(extSrc)) {
  if (!fs.existsSync(extDst)) fs.mkdirSync(extDst, { recursive: true });
  for (const f of fs.readdirSync(extSrc)) {
    if (f.endsWith(".xpi")) fs.copyFileSync(path.join(extSrc, f), path.join(extDst, f));
  }
}
for (const f of ["cookies.sqlite", "permissions.sqlite", "permissions.db", "addons.json", "extension-settings.json", "extension-preferences.json"]) {
  const s = path.join(userProfile, f);
  if (fs.existsSync(s)) fs.copyFileSync(s, path.join(profileDir, f));
}
// Copy SandVPN prefs
const userPrefsPath = path.join(userProfile, "prefs.js");
const profilePrefsPath = path.join(profileDir, "prefs.js");
if (fs.existsSync(userPrefsPath)) {
  const userPrefs = fs.readFileSync(userPrefsPath, "utf8");
  const importantLines = userPrefs.split("\n").filter(l =>
    l.includes("sandvpn") || l.includes("sandvpn_") || l.includes("webextension") || l.includes("extensions")
  );
  if (importantLines.length > 0) {
    fs.appendFileSync(profilePrefsPath, "\n" + importantLines.join("\n") + "\n");
  }
}

console.log("================================================================");
console.log("НАСТРОЙКА СЕССИИ NOTEBOOKLM — Visible Bridge Mode");
console.log("================================================================");
console.log("  Запускается ваш Firefox (не изолированная сборка Playwright)");
console.log("  SandVPN + куки из вашего профиля (+317 cookies, OSID-токены)");
console.log("  Вкладка: notebooklm.google.com");
console.log("");
console.log("  ПОРЯДОК ДЕЙСТВИЙ:");
console.log("  1. Дождись подключения SandVPN (иконка в панели)");
console.log("  2. Если нужно — войди в Google на странице notebooklm");
console.log("  3. Открой ноутбук Pygmalion (кликни по нему)");
console.log("  4. ВЕРНИСЬ В ТЕРМИНАЛ И НАЖМИ ENTER");
console.log("  5. Скрипт: сохранит сессию (cookies → storageState.json)");
console.log("            проверит валидность (URL ноутбука, размер тела)");
console.log("            и закроет Firefox");
console.log("================================================================");

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let browser;
try {
  browser = await firefox.launchPersistentContext(profileDir, {
    headless: false,
    executablePath: REAL_FIREFOX,
    firefoxUserPrefs: {
      "dom.webdriver.enabled": false,
      "dom.webdriver.remote.enabled": false,
      "xpinstall.signatures.required": false,
      "extensions.autoDisableScopes": 0,
      "extensions.enabledScopes": 15,
      "toolkit.telemetry.reportingpolicy.firstRun": false,
      "signon.rememberSignons": true,
      "browser.startup.page": 0,
      "browser.shell.checkDefaultBrowser": false,
    },
    args: [],
  });

  let page = browser.pages()[0] || await browser.newPage();
  await page.goto("https://notebooklm.google.com", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);
  console.log("\nURL:", page.url());

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const waitForNotebook = async () => {
    while (true) {
      try {
        if (page.isClosed()) {
          const pages = browser.pages();
          page = pages.find(p => !p.isClosed()) || await browser.newPage();
          await page.goto("https://notebooklm.google.com", { waitUntil: "domcontentloaded", timeout: 60000 });
        }
        const url = page.url();
        const match = url.match(/\/notebook\/([a-f0-9-]{36})/);
        if (match && !url.includes("signin") && !url.includes("accounts") && !url.includes("403") && !url.includes("Error")) {
          return match[1];
        }
        await page.waitForTimeout(2000);
      } catch {
        await sleep(2000);
      }
      await new Promise(resolve => {
        const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl2.question("Нажми ENTER когда откроешь ноутбук... ", () => { rl2.close(); resolve(); });
      });
    }
  };

  const notebookId = await waitForNotebook();
  console.log(`\nNOTebook ID: ${notebookId}`);

  // Save session
  await page.context().storageState({ path: STORAGE_FILE });
  const stats = fs.statSync(STORAGE_FILE);
  console.log(`Session saved: ${STORAGE_FILE} (${(stats.size / 1024).toFixed(1)} KB, ~${(stats.size / 300).toFixed(0)} cookies)`);

  // Validate: check body size is healthy (>5000 chars = real content, not 403/blocked)
  const body = await page.locator("body").textContent().catch(() => "");
  if (body.length < 5000) {
    console.log("\nWARNING: Body too small (" + body.length + " chars) — возможно блокировка 403.");
    console.log("Попробуй перезапустить SandVPN и повторить.");
  } else {
    console.log(`Body validated: ${body.length} chars — session is healthy.`);
  }

  console.log(`\nCopy this to .env:`);
  console.log(`  NOTEBOOK_ID=${notebookId}`);

} catch (e) {
  console.log("\nError:", e.message);
} finally {
  try { await browser.close(); } catch {}
  console.log("\nFirefox closed. Done.");
}
