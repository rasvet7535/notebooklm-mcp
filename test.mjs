import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(__dirname, "server.js");

const srv = spawn("node", [serverPath], {
  cwd: __dirname,
  stdio: ["pipe", "pipe", "inherit"],
});

let buf = "";
srv.stdout.on("data", (d) => {
  buf += d.toString();
  while (buf.includes("\n")) {
    const nl = buf.indexOf("\n");
    const line = buf.substring(0, nl);
    buf = buf.substring(nl + 1);
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      const content = msg?.result?.content?.[0]?.text || JSON.stringify(msg.message || msg.error || msg);
      console.log("=== RESPONSE ===");
      console.log(content);
      console.log("=== END ===");
      srv.kill();
    } catch {}
  }
});

const query = 'Что говорится в "Черной бумаге" о пределе эмиссии У.Е.?';
const req = JSON.stringify({
  jsonrpc: "2.0", id: 1, method: "tools/call",
  params: { name: "ask_notebooklm", arguments: { query } },
});
srv.stdin.write(req + "\n");

setTimeout(() => { console.log("TIMEOUT"); srv.kill(); }, 600000);
