import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Port must be an integer between 1 and 65535.");
}
mkdirSync(path.join(root, "data"), { recursive: true });
const stdout = openSync(path.join(root, "data", "server-out.log"), "a");
const stderr = openSync(path.join(root, "data", "server-error.log"), "a");
let child;
try {
  child = spawn(process.execPath, [path.join(root, "server.mjs")], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
    detached: true,
    windowsHide: true,
    stdio: ["ignore", stdout, stderr],
  });
} finally {
  closeSync(stdout);
  closeSync(stderr);
}
child.on("error", (error) => {
  console.error(`Could not start the server: ${error.message}`);
  process.exitCode = 1;
});
child.once("spawn", () => {
  child.unref();
  console.log(`Site: http://127.0.0.1:${port}`);
  console.log("Admin: type /admin after the site address");
  console.log(`Process ID: ${child.pid}`);
});
