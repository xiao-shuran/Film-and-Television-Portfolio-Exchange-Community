import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  randomUUID,
  createHash,
  createHmac,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const passwordHash = promisify(scrypt);
const DAY = 86400000;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
};
const digest = (value) => createHash("sha256").update(value).digest("hex");
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const text = (value, max, label, required = false) => {
  if (value !== undefined && typeof value !== "string")
    fail(400, `${label}格式不正确`);
  const result = (value || "").trim();
  if (
    (required && !result) ||
    result.length > max ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(result)
  )
    fail(400, `${label}${required && !result ? "不能为空" : `最多 ${max} 字`}`);
  return result;
};
function externalUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password)
      fail(400, "外部链接必须是 HTTPS 地址");
    return url.href;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    fail(400, "外部链接格式不正确");
  }
}
async function readJson(req, limit = 150000) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    fail(415, "请使用 JSON 提交");
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) fail(413, "提交内容过大");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || Array.isArray(value) || typeof value !== "object")
      fail(400, "提交格式不正确");
    return value;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    fail(400, "JSON 格式不正确");
  }
}
function send(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}
function detectMedia(bytes) {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return [".jpg", "image/jpeg", "image"];
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return [".png", "image/png", "image"];
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString()))
    return [".gif", "image/gif", "image"];
  if (
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP"
  )
    return [".webp", "image/webp", "image"];
  if (bytes.subarray(0, 5).toString() === "%PDF-")
    return [".pdf", "application/pdf", "pdf"];
  if (
    bytes.length > 12 &&
    bytes.subarray(4, 8).toString() === "ftyp" &&
    /^(isom|iso[2-9]|mp4[12]|M4V |avc1|dash)/.test(
      bytes.subarray(8, 12).toString(),
    )
  )
    return [".mp4", "video/mp4", "video"];
  if (
    bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])) &&
    bytes.subarray(0, 256).includes(Buffer.from("webm"))
  )
    return [".webm", "video/webm", "video"];
  fail(415, "只支持 JPG、PNG、WebP、GIF、MP4、WebM 和 PDF 文件");
}

export async function createApplication(options = {}) {
  const dataDir =
    options.dataDir || process.env.DATA_DIR || path.join(ROOT, "data");
  const uploadDir =
    options.uploadDir || process.env.UPLOAD_DIR || path.join(ROOT, "uploads");
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.mkdir(uploadDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "portfolio.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS admin(id INTEGER PRIMARY KEY CHECK(id=1),salt TEXT NOT NULL,hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,content TEXT NOT NULL,status TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS uploads(id TEXT PRIMARY KEY,path TEXT UNIQUE NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS topics(id TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,nickname TEXT NOT NULL,category TEXT NOT NULL,hidden INTEGER NOT NULL DEFAULT 0,deleted INTEGER NOT NULL DEFAULT 0,pinned INTEGER NOT NULL DEFAULT 0,locked INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL,updated TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS replies(id TEXT PRIMARY KEY,topic TEXT NOT NULL REFERENCES topics(id),body TEXT NOT NULL,nickname TEXT NOT NULL,hidden INTEGER NOT NULL DEFAULT 0,deleted INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rate_events(scope TEXT NOT NULL,key TEXT NOT NULL,time INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS rate_lookup ON rate_events(scope,key,time);
    CREATE INDEX IF NOT EXISTS reply_topic ON replies(topic,created);
    CREATE INDEX IF NOT EXISTS topic_visibility ON topics(deleted,hidden,pinned,updated);`);
  const getSetting = (key) =>
    db.prepare("SELECT value FROM settings WHERE key=?").get(key)?.value;
  const setSetting = (key, value) =>
    db
      .prepare(
        "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, value);
  if (!getSetting("site"))
    setSetting(
      "site",
      await fsp.readFile(path.join(ROOT, "site.json"), "utf8"),
    );
  if (!getSetting("ip-key"))
    setSetting("ip-key", randomBytes(32).toString("hex"));
  const configured = () =>
    Boolean(db.prepare("SELECT id FROM admin WHERE id=1").get());
  const site = () => JSON.parse(getSetting("site"));
  const projectRows = (includeDrafts) =>
    db
      .prepare(
        `SELECT * FROM projects ${includeDrafts ? "" : "WHERE status='published'"} ORDER BY updated DESC`,
      )
      .all()
      .map((row) => ({
        ...JSON.parse(row.content),
        id: row.id,
        status: row.status,
        created: row.created,
        updated: row.updated,
      }));
  const topicRow = (id, admin = false) =>
    db
      .prepare(
        `SELECT t.*,(SELECT count(*) FROM replies r WHERE r.topic=t.id AND r.deleted=0 ${admin ? "" : "AND r.hidden=0"}) AS replyCount FROM topics t WHERE t.id=? AND t.deleted=0 ${admin ? "" : "AND t.hidden=0"}`,
      )
      .get(id);
  const ipKey = (req) =>
    createHmac("sha256", getSetting("ip-key"))
      .update(
        process.env.TRUST_PROXY === "1"
          ? String(req.headers["x-forwarded-for"] || req.socket.remoteAddress)
              .split(",")[0]
              .trim()
          : req.socket.remoteAddress || "local",
      )
      .digest("hex");
  function rate(req, scope, limit, windowMs, cooldown = 0) {
    if (options.rateLimits === false) return;
    const now = Date.now();
    db.prepare("DELETE FROM rate_events WHERE time<?").run(now - DAY);
    const key = ipKey(req);
    const result = db
      .prepare(
        "SELECT count(*) count,max(time) latest FROM rate_events WHERE scope=? AND key=? AND time>?",
      )
      .get(scope, key, now - windowMs);
    if (
      result.count >= limit ||
      (result.latest && now - result.latest < cooldown)
    )
      fail(429, "发言或请求过于频繁，请稍后再试");
    db.prepare("INSERT INTO rate_events VALUES(?,?,?)").run(scope, key, now);
  }
  function session(req) {
    const token = req.headers.cookie
      ?.split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith("portfolio_session="))
      ?.slice(18);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return (
      db
        .prepare("SELECT * FROM sessions WHERE token=? AND expires>?")
        .get(digest(token), Date.now()) || null
    );
  }
  function admin(req, write = false) {
    const current = session(req);
    if (!current) fail(401, "请先登录管理后台");
    if (write && !equal(req.headers["x-csrf-token"], current.csrf))
      fail(403, "登录已失效，请刷新后重试");
    return current;
  }
  function checkOrigin(req) {
    const host = req.headers.host;
    if (!host || !/^[a-z0-9.\-:[\]]+$/i.test(host)) fail(400, "无效的访问地址");
    const expected =
      options.origin ||
      process.env.APP_ORIGIN ||
      `${req.socket.encrypted ? "https" : "http"}://${host}`;
    if (
      (req.headers.origin && req.headers.origin !== expected) ||
      req.headers["sec-fetch-site"] === "cross-site"
    )
      fail(403, "不允许跨站提交");
  }
  async function newSession(req, res) {
    const token = randomBytes(32).toString("hex");
    const csrf = randomBytes(24).toString("hex");
    db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      digest(token),
      csrf,
      Date.now() + DAY / 2,
    );
    const secure =
      (options.origin || process.env.APP_ORIGIN || "").startsWith("https:") ||
      req.socket.encrypted;
    res.setHeader(
      "Set-Cookie",
      `portfolio_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure ? "; Secure" : ""}`,
    );
    return { authenticated: true, configured: true, csrf };
  }
  function localAsset(value, kind) {
    if (!value) return "";
    if (typeof value !== "string") fail(400, "素材地址格式不正确");
    const file = db.prepare("SELECT * FROM uploads WHERE path=?").get(value);
    if (
      !file ||
      (kind === "image" && !file.mime.startsWith("image/")) ||
      (kind === "video" && !file.mime.startsWith("video/")) ||
      (kind === "pdf" && file.mime !== "application/pdf")
    )
      fail(400, "素材不存在或文件类型不匹配，请重新上传");
    return value;
  }
  function cleanProject(data) {
    const config = site();
    const category = text(data.category, 24, "作品分类", true);
    if (!config.categories.includes(category)) fail(400, "请选择已有作品分类");
    const status = ["draft", "published", "archived"].includes(data.status)
      ? data.status
      : "draft";
    const result = {
      title: text(data.title, 100, "作品名称", true),
      category,
      year: text(data.year, 12, "年份"),
      role: text(data.role, 100, "创作分工"),
      summary: text(data.summary, 300, "作品简介"),
      description: text(data.description, 12000, "作品介绍"),
      cover: localAsset(data.cover, "image"),
      featured: Boolean(data.featured),
      externalUrl: externalUrl(text(data.externalUrl, 2000, "外部链接")),
      media: [],
    };
    if (
      data.media !== undefined &&
      (!Array.isArray(data.media) || data.media.length > 24)
    )
      fail(400, "每个作品最多添加 24 个素材");
    result.media = (data.media || []).map((item) => {
      if (!item || !["image", "video", "pdf"].includes(item.kind))
        fail(400, "素材类型不正确");
      return {
        kind: item.kind,
        src: localAsset(item.src, item.kind),
        name: text(item.name, 160, "文件名称"),
        caption: text(item.caption, 300, "素材说明"),
      };
    });
    if (status === "published" && (!result.cover || !result.summary))
      fail(400, "发布作品需要封面和简介");
    return { result, status };
  }
  function validateSite(data) {
    const current = site();
    const categories = Array.isArray(data.categories)
      ? data.categories.map((value) => text(value, 24, "分类名称", true))
      : current.categories;
    if (
      !categories.length ||
      categories.length > 8 ||
      new Set(categories).size !== categories.length
    )
      fail(400, "请设置 1 到 8 个不重复的作品分类");
    const usedCategories = projectRows(true).map((project) => project.category);
    if (usedCategories.some((value) => !categories.includes(value)))
      fail(400, "仍有作品使用被删除的分类，请先修改这些作品");
    const email = text(data.email, 150, "联系邮箱");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      fail(400, "邮箱格式不正确");
    return {
      ...current,
      name: text(data.name, 16, "站点名称", true),
      english: text(data.english, 50, "英文名"),
      author: text(data.author, 20, "署名", true),
      tagline: text(data.tagline, 60, "首页寄语", true),
      intro: text(data.intro, 200, "首页介绍"),
      about: text(data.about, 4000, "关于我"),
      email,
      categories,
    };
  }
  function topicList(url, includeHidden = false) {
    const page = Math.max(
      1,
      Math.min(
        100000,
        Number.parseInt(url.searchParams.get("page") || "1") || 1,
      ),
    );
    const query = (url.searchParams.get("q") || "")
      .slice(0, 100)
      .replace(/[\\%_]/g, "\\$&");
    const category = url.searchParams.get("category") || "全部";
    const where = `deleted=0 ${includeHidden ? "" : "AND hidden=0"} AND (title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\') ${category === "全部" ? "" : "AND category=?"}`;
    const params = [
      `%${query}%`,
      `%${query}%`,
      ...(category === "全部" ? [] : [category]),
    ];
    const total = db
      .prepare(`SELECT count(*) total FROM topics WHERE ${where}`)
      .get(...params).total;
    const rows = db
      .prepare(
        `SELECT id,title,substr(body,1,140) preview,nickname,category,hidden,pinned,locked,created,updated,(SELECT count(*) FROM replies r WHERE r.topic=topics.id AND r.deleted=0 ${includeHidden ? "" : "AND r.hidden=0"}) replyCount FROM topics WHERE ${where} ORDER BY pinned DESC,updated DESC LIMIT 12 OFFSET ?`,
      )
      .all(...params, (page - 1) * 12);
    return {
      topics: rows,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / 12)),
    };
  }
  async function upload(req) {
    const max = 256 * 1024 * 1024;
    if (Number(req.headers["content-length"]) > max)
      fail(413, "单个素材最大 256 MB");
    let name;
    try {
      name = decodeURIComponent(req.headers["x-file-name"] || "素材");
    } catch {
      fail(400, "文件名称格式不正确");
    }
    name = text(name, 160, "文件名称", true);
    const id = randomUUID();
    const temp = path.join(uploadDir, `${id}.tmp`);
    let size = 0;
    let head = Buffer.alloc(0);
    const counter = new Transform({
      transform(chunk, encoding, callback) {
        size += chunk.length;
        if (size > max)
          return callback(new HttpError(413, "单个素材最大 256 MB"));
        if (head.length < 512)
          head = Buffer.concat([head, chunk.subarray(0, 512 - head.length)]);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(req, counter, fs.createWriteStream(temp, { flags: "wx" }));
      const [extension, mime, kind] = detectMedia(head);
      const assetPath = `uploads/${id}${extension}`;
      await fsp.rename(temp, path.join(uploadDir, `${id}${extension}`));
      db.prepare("INSERT INTO uploads VALUES(?,?,?,?,?,?)").run(
        id,
        assetPath,
        name,
        mime,
        size,
        new Date().toISOString(),
      );
      return { id, src: assetPath, name, mime, kind, size };
    } finally {
      await fsp.rm(temp, { force: true });
    }
  }
  async function serveFile(req, res, filename, mime, attachment = false) {
    let stat;
    try {
      stat = await fsp.stat(filename);
      if (!stat.isFile()) fail(404, "文件不存在");
    } catch {
      fail(404, "文件不存在");
    }
    const headers = {
      "Content-Type": mime,
      "Cache-Control": "no-cache",
      "Accept-Ranges": "bytes",
    };
    if (attachment) headers["Content-Disposition"] = "attachment";
    let start = 0;
    let end = stat.size - 1;
    let status = 200;
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!match || (!match[1] && !match[2])) {
        res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
        res.end();
        return;
      }
      if (!match[1]) start = Math.max(0, stat.size - Number(match[2]));
      else {
        start = Number(match[1]);
        if (match[2]) end = Math.min(end, Number(match[2]));
      }
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= stat.size ||
        start < 0
      ) {
        res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
        res.end();
        return;
      }
      status = 206;
      headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
    }
    headers["Content-Length"] = Math.max(0, end - start + 1);
    res.writeHead(status, headers);
    if (req.method === "HEAD" || stat.size === 0) {
      res.end();
      return;
    }
    await pipeline(fs.createReadStream(filename, { start, end }), res);
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    try {
      if (
        !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(req.method)
      )
        fail(405, "请求方法不支持");
      if (!["GET", "HEAD"].includes(req.method)) checkOrigin(req);
      const url = new URL(req.url, "http://localhost");
      const route = decodeURIComponent(url.pathname);
      const method = req.method;
      if (route.startsWith("/api/")) {
        if (method === "GET" && route === "/api/site")
          return send(res, 200, {
            ...site(),
            projectCount: projectRows(false).length,
          });
        if (method === "GET" && route === "/api/projects")
          return send(res, 200, { projects: projectRows(false) });
        if (method === "GET" && route === "/api/admin/session") {
          const current = session(req);
          return send(res, 200, {
            configured: configured(),
            authenticated: Boolean(current),
            csrf: current?.csrf || null,
          });
        }
        if (method === "POST" && route === "/api/admin/login") {
          rate(req, "login", 8, 900000);
          const data = await readJson(req);
          const account = db.prepare("SELECT * FROM admin WHERE id=1").get();
          if (
            !account ||
            typeof data.password !== "string" ||
            data.password.length > 128
          )
            fail(401, "密码不正确");
          const hash = (
            await passwordHash(data.password, account.salt, 64)
          ).toString("hex");
          if (!equal(hash, account.hash)) fail(401, "密码不正确");
          return send(res, 200, await newSession(req, res));
        }
        if (route.startsWith("/api/admin/")) {
          const known =
            /^\/api\/admin\/(logout|password|projects|uploads|site|topics)$/.test(
              route,
            ) ||
            /^\/api\/admin\/(projects|topics|replies)\/[a-f0-9-]+$/.test(route);
          if (!known) fail(404, "接口不存在");
          const current = admin(req, !["GET", "HEAD"].includes(method));
          if (method === "POST" && route === "/api/admin/logout") {
            db.prepare("DELETE FROM sessions WHERE token=?").run(current.token);
            res.setHeader(
              "Set-Cookie",
              "portfolio_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
            );
            return send(res, 200, { ok: true });
          }
          if (method === "POST" && route === "/api/admin/password") {
            const data = await readJson(req);
            const account = db.prepare("SELECT * FROM admin WHERE id=1").get();
            if (
              typeof data.current !== "string" ||
              data.current.length > 128 ||
              !equal(
                (await passwordHash(data.current, account.salt, 64)).toString(
                  "hex",
                ),
                account.hash,
              )
            )
              fail(400, "当前密码不正确");
            if (
              typeof data.password !== "string" ||
              data.password.length < 12 ||
              data.password.length > 128
            )
              fail(400, "新密码请使用 12 到 128 个字符");
            const salt = randomBytes(24).toString("hex");
            db.prepare("UPDATE admin SET salt=?,hash=? WHERE id=1").run(
              salt,
              (await passwordHash(data.password, salt, 64)).toString("hex"),
            );
            db.prepare("DELETE FROM sessions").run();
            return send(res, 200, await newSession(req, res));
          }
          if (method === "GET" && route === "/api/admin/projects")
            return send(res, 200, { projects: projectRows(true) });
          if (method === "POST" && route === "/api/admin/projects") {
            const { result, status } = cleanProject(await readJson(req));
            const id = randomUUID();
            const now = new Date().toISOString();
            db.prepare("INSERT INTO projects VALUES(?,?,?,?,?)").run(
              id,
              JSON.stringify(result),
              status,
              now,
              now,
            );
            return send(res, 201, {
              project: { ...result, id, status, created: now, updated: now },
            });
          }
          const projectMatch = /^\/api\/admin\/projects\/([a-f0-9-]+)$/.exec(
            route,
          );
          if (projectMatch && ["PUT", "DELETE"].includes(method)) {
            const row = db
              .prepare("SELECT * FROM projects WHERE id=?")
              .get(projectMatch[1]);
            if (!row) fail(404, "作品不存在");
            if (method === "DELETE") {
              db.prepare("DELETE FROM projects WHERE id=?").run(row.id);
              return send(res, 200, { ok: true });
            }
            const { result, status } = cleanProject(await readJson(req));
            db.prepare(
              "UPDATE projects SET content=?,status=?,updated=? WHERE id=?",
            ).run(
              JSON.stringify(result),
              status,
              new Date().toISOString(),
              row.id,
            );
            return send(res, 200, { ok: true });
          }
          if (method === "POST" && route === "/api/admin/uploads")
            return send(res, 201, await upload(req));
          if (method === "GET" && route === "/api/admin/site")
            return send(res, 200, site());
          if (method === "PUT" && route === "/api/admin/site") {
            const config = validateSite(await readJson(req));
            setSetting("site", JSON.stringify(config));
            return send(res, 200, config);
          }
          if (method === "GET" && route === "/api/admin/topics")
            return send(res, 200, topicList(url, true));
          const adminTopic = /^\/api\/admin\/topics\/([a-f0-9-]+)$/.exec(route);
          if (adminTopic) {
            const topic = topicRow(adminTopic[1], true);
            if (!topic) fail(404, "帖子不存在");
            if (method === "GET")
              return send(res, 200, {
                topic,
                replies: db
                  .prepare(
                    "SELECT * FROM replies WHERE topic=? AND deleted=0 ORDER BY created",
                  )
                  .all(topic.id),
              });
            if (method === "DELETE") {
              db.prepare("UPDATE topics SET deleted=1 WHERE id=?").run(
                topic.id,
              );
              return send(res, 200, { ok: true });
            }
            if (method === "PATCH") {
              const data = await readJson(req);
              const fields = ["hidden", "pinned", "locked"].filter(
                (key) => typeof data[key] === "boolean",
              );
              if (!fields.length) fail(400, "请选择管理操作");
              db.prepare(
                `UPDATE topics SET ${fields.map((key) => `${key}=?`).join(",")} WHERE id=?`,
              ).run(...fields.map((key) => Number(data[key])), topic.id);
              return send(res, 200, { ok: true });
            }
          }
          const adminReply = /^\/api\/admin\/replies\/([a-f0-9-]+)$/.exec(
            route,
          );
          if (adminReply && ["PATCH", "DELETE"].includes(method)) {
            if (
              !db
                .prepare("SELECT id FROM replies WHERE id=? AND deleted=0")
                .get(adminReply[1])
            )
              fail(404, "回复不存在");
            if (method === "DELETE")
              db.prepare("UPDATE replies SET deleted=1 WHERE id=?").run(
                adminReply[1],
              );
            else {
              const data = await readJson(req);
              if (typeof data.hidden !== "boolean") fail(400, "请选择管理操作");
              db.prepare("UPDATE replies SET hidden=? WHERE id=?").run(
                Number(data.hidden),
                adminReply[1],
              );
            }
            return send(res, 200, { ok: true });
          }
          fail(404, "管理接口不存在");
        }
        if (method === "GET" && route === "/api/forum")
          return send(res, 200, topicList(url));
        if (method === "POST" && route === "/api/forum") {
          const data = await readJson(req);
          if (data.website) fail(400, "提交失败");
          const title = text(data.title, 80, "标题", true);
          const body = text(data.body, 5000, "正文", true);
          const nickname = text(data.nickname, 24, "昵称") || "匿名访客";
          const category = ["交流", "反馈", "闲聊"].includes(data.category)
            ? data.category
            : "交流";
          rate(req, "post", 15, 3600000, 20000);
          const id = randomUUID();
          const now = new Date().toISOString();
          db.prepare(
            "INSERT INTO topics(id,title,body,nickname,category,created,updated) VALUES(?,?,?,?,?,?,?)",
          ).run(id, title, body, nickname, category, now, now);
          return send(res, 201, { topic: topicRow(id) });
        }
        const publicTopic = /^\/api\/forum\/([a-f0-9-]+)$/.exec(route);
        if (method === "GET" && publicTopic) {
          const topic = topicRow(publicTopic[1]);
          if (!topic) fail(404, "帖子不存在或已被隐藏");
          const page = Math.max(
            1,
            Number.parseInt(url.searchParams.get("page") || "1") || 1,
          );
          const replies = db
            .prepare(
              "SELECT id,body,nickname,created FROM replies WHERE topic=? AND hidden=0 AND deleted=0 ORDER BY created LIMIT 30 OFFSET ?",
            )
            .all(topic.id, Math.min(page - 1, 100000) * 30);
          return send(res, 200, {
            topic,
            replies,
            page,
            pages: Math.max(1, Math.ceil(topic.replyCount / 30)),
          });
        }
        const replyMatch = /^\/api\/forum\/([a-f0-9-]+)\/replies$/.exec(route);
        if (method === "POST" && replyMatch) {
          const topic = topicRow(replyMatch[1]);
          if (!topic) fail(404, "帖子不存在或已被隐藏");
          if (topic.locked) fail(403, "这个帖子已关闭回复");
          const data = await readJson(req);
          if (data.website) fail(400, "提交失败");
          const body = text(data.body, 2000, "回复", true);
          const nickname = text(data.nickname, 24, "昵称") || "匿名访客";
          rate(req, "reply", 40, 3600000, 10000);
          const id = randomUUID();
          const now = new Date().toISOString();
          db.exec("BEGIN");
          try {
            db.prepare(
              "INSERT INTO replies(id,topic,body,nickname,created) VALUES(?,?,?,?,?)",
            ).run(id, topic.id, body, nickname, now);
            db.prepare("UPDATE topics SET updated=? WHERE id=?").run(
              now,
              topic.id,
            );
            db.exec("COMMIT");
          } catch (error) {
            db.exec("ROLLBACK");
            throw error;
          }
          return send(res, 201, {
            reply: { id, body, nickname, created: now },
          });
        }
        fail(404, "接口不存在");
      }
      if (!["GET", "HEAD"].includes(method)) fail(405, "请求方法不支持");
      if (route === "/admin") {
        return await serveFile(
          req,
          res,
          path.join(ROOT, "admin.html"),
          MIME[".html"],
        );
      }
      if (route.startsWith("/uploads/")) {
        const assetPath = route.slice(1);
        const file = db
          .prepare("SELECT * FROM uploads WHERE path=?")
          .get(assetPath);
        const publicAsset = projectRows(false).some(
          (project) =>
            project.cover === assetPath ||
            project.media.some((media) => media.src === assetPath),
        );
        if (!file || (!publicAsset && !session(req))) fail(404, "文件不存在");
        return await serveFile(
          req,
          res,
          path.join(uploadDir, path.basename(assetPath)),
          file.mime,
          file.mime === "application/pdf",
        );
      }
      const publicPage =
        ["/", "/works", "/forum", "/about"].includes(route) ||
        /^\/works\/project\/[a-f0-9-]+$/.test(route) ||
        /^\/forum\/topic\/[a-f0-9-]+$/.test(route);
      const requested = publicPage ? "index.html" : route.slice(1);
      const allowed =
        [
          "index.html",
          "styles.css",
          "portfolio.css",
          "app.js",
          "admin.js",
          "admin.css",
        ].includes(requested) ||
        /^assets\/[a-zA-Z0-9_-]+\.(jpg|png|webp|gif)$/.test(requested) ||
        requested === "vendor/lucide.min.js";
      if (!allowed) fail(404, "页面不存在");
      return await serveFile(
        req,
        res,
        path.join(ROOT, requested),
        MIME[path.extname(requested)] || "application/octet-stream",
      );
    } catch (error) {
      if (res.headersSent || res.destroyed) {
        if (!res.writableEnded) res.destroy();
        return;
      }
      if (!(error instanceof HttpError)) console.error(error);
      send(res, error.status || 500, {
        error:
          error instanceof HttpError
            ? error.message
            : "服务暂时不可用，请稍后重试",
      });
    }
  });
  server.requestTimeout = 10 * 60000;
  server.headersTimeout = 30000;
  server.on("close", () => db.close());
  return { server, dataDir, uploadDir };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const app = await createApplication();
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || "127.0.0.1";
  app.server.listen(port, host, () => {
    const base =
      process.env.APP_ORIGIN ||
      `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`;
    console.log(`作品集: ${base}`);
    console.log(`论坛: ${base}/forum`);
    console.log(`后台（仅手动输入地址）: ${base}/admin`);
  });
  app.server.on("error", (error) => {
    console.error(
      `启动失败: ${error.code === "EADDRINUSE" ? "端口已被占用，请设置其他 PORT" : error.message}`,
    );
    process.exitCode = 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => app.server.close(() => process.exit(0)));
}
