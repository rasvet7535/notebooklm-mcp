import { firefox } from "playwright";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import fs from "fs";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const profileDir = resolve(__dirname, process.env.USER_DATA_DIR || "./firefox-profile");
if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

console.log("============================================================");
console.log("  Setup: NotebookLM Firefox Profile");
console.log("============================================================");
console.log("Profile:", profileDir);
console.log("");
console.log("Firefox will open VISIBLE.");
console.log("1. LOG IN to Google (notebooklm.google.com)");
console.log("2. Script waits until you're on NotebookLM");
console.log("============================================================");

const browser = await firefox.launchPersistentContext(profileDir, {
  headless: false, args: ["--no-sandbox", "--disable-gpu"],
});

const page = browser.pages()[0] || await browser.newPage();

await page.goto("https://notebooklm.google.com", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(3000);
console.log("URL:", page.url());

let ok = false;
for (let i = 0; i < 120; i++) {
  const url = page.url();
  if (url.includes("notebooklm.google.com") && !url.includes("signin") && !url.includes("accounts") && !url.includes("403")) {
    console.log(`OK! NotebookLM loaded (attempt ${i + 1})`);
    ok = true;
    break;
  }
  process.stdout.write(".");
  await page.waitForTimeout(5000);
}

console.log(ok ? "\nSession saved to profile!" : "\nTimeout. Run again.");
await browser.close();
