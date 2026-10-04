import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { Writable } from "node:stream";
import { initializeAdmin } from "./admin-account.mjs";

const args = process.argv.slice(2);
let password;
if (args.includes("--generate")) {
  password = randomBytes(24).toString("base64url");
} else {
  if (!process.stdin.isTTY)
    throw new Error("请在本机终端运行，或使用 --generate 自动生成密码");
  const output = new Writable({
    write(chunk, encoding, callback) {
      callback();
    },
  });
  const terminal = readline.createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });
  try {
    process.stdout.write("设置管理员密码（至少 12 个字符，输入不回显）: ");
    password = await terminal.question("");
    process.stdout.write("\n确认密码: ");
    const confirm = await terminal.question("");
    process.stdout.write("\n");
    if (password !== confirm) throw new Error("两次密码不一致");
  } finally {
    terminal.close();
  }
}
const fileIndex = args.indexOf("--credential-file");
const credentialFile = fileIndex >= 0 ? args[fileIndex + 1] : "";
if (fileIndex >= 0 && !credentialFile) throw new Error("请指定凭据文件路径");
if (credentialFile) {
  await fs.access(path.dirname(path.resolve(credentialFile)));
  try {
    await fs.access(credentialFile);
    throw new Error("凭据文件已存在，请使用其他路径");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
await initializeAdmin(password);
if (credentialFile) {
  await fs.writeFile(
    credentialFile,
    `私人管理资料，请勿公开\n\n后台地址：在网站地址后输入 /admin\n管理员密码：${password}\n\n只有一个管理员账号；网站没有注册功能。登录后可在站点设置中修改密码。\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log(`管理员已初始化，凭据保存在 ${path.resolve(credentialFile)}`);
} else {
  console.log(
    "管理员已初始化。只可通过 /admin 登录，没有公开注册或初始化入口。",
  );
  if (args.includes("--generate"))
    console.log(`管理密码（请保密）：${password}`);
}
