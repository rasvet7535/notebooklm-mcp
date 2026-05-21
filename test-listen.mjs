import { firefox } from "playwright";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import path from "path";
import fs from "fs";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const USER_DATA_DIR = resolve(__dirname, process.env.USER_DATA_DIR || "./firefox-profile");
const profileDir = resolve(USER_DATA_DIR);
if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

// Copy cookies from real Firefox profile
const userProfilesDir = "C:\\Users\\RASVE\\AppData\\Roaming\\Mozilla\\Firefox\\Profiles";
const dirs = fs.readdirSync(userProfilesDir);
const release = dirs.find(e => e.includes("default-release"));
if (release) {
  const src = path.join(userProfilesDir, release, "cookies.sqlite");
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(profileDir, "cookies.sqlite"));
}

const browser = await firefox.launchPersistentContext(profileDir, {
  headless: false, args: ["--no-sandbox", "--disable-gpu"],
});

const page = browser.pages()[0] || await browser.newPage();

await page.goto("https://notebooklm.google.com", { waitUntil: "networkidle", timeout: 30000 });
console.log("Main URL:", page.url());
await page.waitForTimeout(5000);

const bodyText = await page.locator("body").textContent().catch(() => "");
console.log("Body length:", bodyText.length);
console.log("--- PAGE ---");
console.log(bodyText.substring(0, 5000));
console.log("--- END ---");

const links = await page.locator("a").all();
console.log(`\nLinks (${links.length}):`);
for (const link of links) {
  const href = await link.getAttribute("href").catch(() => "");
  const text = await link.textContent().catch(() => "");
  if (href) console.log(`  "${text.trim().substring(0, 40)}" -> ${href.substring(0, 100)}`);
}

const buttons = await page.locator('[role="button"], button, [tabindex]').all();
console.log(`\nButtons/clickable (${Math.min(buttons.length, 30)} shown):`);
let count = 0;
for (const btn of buttons) {
  if (count++ > 30) break;
  const text = await btn.textContent().catch(() => "");
  const tag = await btn.evaluate(el => el.tagName + (el.className ? "." + el.className.substring(0, 20) : "")).catch(() => "");
  const visible = await btn.isVisible().catch(() => false);
  if (visible && text.trim()) console.log(`  ${tag}: "${text.trim().substring(0, 80)}"`);
}

const uuids = bodyText.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi);
if (uuids) console.log("\nUUIDs:", [...new Set(uuids)]);

await page.screenshot({ path: "notebooklm-live.png", fullPage: true });
console.log("\nScreenshot saved to notebooklm-live.png");

await page.waitForTimeout(15000);
await browser.close();
