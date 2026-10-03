import { DatabaseSync } from "node:sqlite";
import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const derive = promisify(scrypt);

// Provisioning is intentionally offline; no HTTP route calls this function.
export async function initializeAdmin(
  password,
  dataDir = process.env.DATA_DIR || path.join(ROOT, "data"),
) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  )
    throw new Error("管理员密码请使用 12 到 128 个字符");
  await fs.mkdir(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "portfolio.sqlite"));
  try {
    db.exec(
      "CREATE TABLE IF NOT EXISTS admin(id INTEGER PRIMARY KEY CHECK(id=1),salt TEXT NOT NULL,hash TEXT NOT NULL)",
    );
    if (db.prepare("SELECT id FROM admin WHERE id=1").get())
      throw new Error("管理员已存在，初始化命令不会覆盖已有账号");
    const salt = randomBytes(24).toString("hex");
    const hash = (await derive(password, salt, 64)).toString("hex");
    db.prepare("INSERT INTO admin VALUES(1,?,?)").run(salt, hash);
  } finally {
    db.close();
  }
}
