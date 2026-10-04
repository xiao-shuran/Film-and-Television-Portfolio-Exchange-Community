import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApplication } from "../server.mjs";
import { initializeAdmin } from "../admin-account.mjs";

async function fixture(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "portfolio-test-"));
  const app = await createApplication({
    dataDir: path.join(root, "data"),
    uploadDir: path.join(root, "uploads"),
    ...options,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function request(url, method = "GET", data, headers = {}) {
    const response = await fetch(base + url, {
      method,
      headers: {
        ...(data ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body, headers: response.headers };
  }
  return {
    ...app,
    root,
    base,
    request,
    async close() {
      await new Promise((resolve) => {
        app.server.close(resolve);
        app.server.closeAllConnections();
      });
    },
  };
}
async function setup(f) {
  await initializeAdmin("test-password-2026!", f.dataDir);
  const result = await f.request("/api/admin/login", "POST", {
    password: "test-password-2026!",
  });
  assert.equal(result.status, 200);
  return {
    Cookie: result.headers.get("set-cookie").split(";")[0],
    "X-CSRF-Token": result.body.csrf,
  };
}
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
function readStoredZip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from("PK\x05\x06"));
  assert.ok(end >= 0, "backup must end with a ZIP directory");
  const count = buffer.readUInt16LE(end + 10);
  const centralOffset = buffer.readUInt32LE(end + 16);
  const files = new Map();
  let offset = centralOffset;
  for (let index = 0; index < count; index++) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    assert.equal(
      buffer.readUInt16LE(offset + 10),
      0,
      "backup uses stored files",
    );
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8");
    const localOffset = buffer.readUInt32LE(offset + 42);
    assert.equal(buffer.readUInt32LE(localOffset), 0x04034b50);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    files.set(name, buffer.subarray(start, start + compressedSize));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

test("Anonymous forum, moderation, SQL-safe search and persistent storage", async () => {
  const f = await fixture({ rateLimits: false });
  try {
    assert.equal((await f.request("/api/forum")).body.total, 0);
    assert.equal(
      (await f.request("/api/forum", "POST", { title: "", body: "hello" }))
        .status,
      400,
    );
    const posted = await f.request("/api/forum", "POST", {
      title: "<script>alert(1)</script>",
      body: "Hello\n第二行",
      nickname: "",
      category: "反馈",
    });
    assert.equal(posted.status, 201);
    const id = posted.body.topic.id;
    assert.equal(posted.body.topic.nickname, "匿名访客");
    const reply = await f.request(`/api/forum/${id}/replies`, "POST", {
      body: "Anonymous reply",
    });
    assert.equal(reply.status, 201);
    assert.equal((await f.request(`/api/forum/${id}`)).body.replies.length, 1);
    assert.equal(
      (await f.request("/api/forum?q=%27%20OR%201%3D1")).body.total,
      0,
    );
    assert.equal((await f.request("/api/forum?q=%25")).body.total, 0);
    assert.equal((await f.request("/api/forum?category=反馈")).body.total, 1);
    assert.equal((await f.request("/api/admin/topics")).status, 401);
    const auth = await setup(f);
    assert.equal(
      (
        await f.request(
          `/api/admin/topics/${id}`,
          "PATCH",
          { pinned: true, locked: true },
          auth,
        )
      ).status,
      200,
    );
    assert.equal(
      (await f.request(`/api/forum/${id}/replies`, "POST", { body: "blocked" }))
        .status,
      403,
    );
    await f.request(
      `/api/admin/topics/${id}`,
      "PATCH",
      { locked: false, hidden: true },
      auth,
    );
    assert.equal((await f.request("/api/forum")).body.total, 0);
    assert.equal((await f.request(`/api/forum/${id}`)).status, 404);
    assert.equal(
      (await f.request("/api/admin/topics", "GET", undefined, auth)).body.total,
      1,
    );
    await f.request(
      `/api/admin/topics/${id}`,
      "PATCH",
      { hidden: false },
      auth,
    );
    await f.request(
      `/api/admin/replies/${reply.body.reply.id}`,
      "PATCH",
      { hidden: true },
      auth,
    );
    assert.equal((await f.request(`/api/forum/${id}`)).body.replies.length, 0);
    await f.request(
      `/api/admin/replies/${reply.body.reply.id}`,
      "PATCH",
      { hidden: false },
      auth,
    );
    assert.equal((await f.request(`/api/forum/${id}`)).body.replies.length, 1);
    await f.close();
    const restarted = await createApplication({
      dataDir: f.dataDir,
      uploadDir: f.uploadDir,
      rateLimits: false,
    });
    await new Promise((resolve) =>
      restarted.server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const response = await fetch(
        `http://127.0.0.1:${restarted.server.address().port}/api/forum/${id}`,
      );
      assert.equal(
        (await response.json()).topic.title,
        posted.body.topic.title,
      );
    } finally {
      await new Promise((resolve) => {
        restarted.server.close(resolve);
        restarted.server.closeAllConnections();
      });
    }
  } finally {
    if (f.server.listening) await f.close();
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("Offline admin, no registration, authentication, CSRF and private files", async () => {
  const f = await fixture({ rateLimits: false });
  try {
    assert.equal(
      (await f.request("/api/admin/session")).body.configured,
      false,
    );
    for (const endpoint of [
      "/api/register",
      "/api/signup",
      "/api/admin/register",
      "/api/admin/setup",
      "/api/users",
    ])
      assert.equal(
        (await f.request(endpoint, "POST", { password: "any-password-2026!" }))
          .status,
        404,
        endpoint,
      );
    for (const page of ["/", "/works", "/forum", "/about", "/admin"])
      assert.equal((await f.request(page)).status, 200, page);
    for (const asset of [
      "/theme.js",
      "/theme.css",
      "/comparison.js",
      "/comparison.css",
      "/motion.js",
      "/motion.css",
    ])
      assert.equal((await f.request(asset)).status, 200, asset);
    for (const page of [
      "/admin.html",
      "/admin/",
      "/register",
      "/signup",
      "/login",
    ])
      assert.equal((await f.request(page)).status, 404, page);
    await assert.rejects(initializeAdmin("short", f.dataDir), /12/);
    const auth = await setup(f);
    await assert.rejects(
      initializeAdmin("other-password-2026!", f.dataDir),
      /已存在/,
    );
    for (const endpoint of [
      "/api/register",
      "/api/signup",
      "/api/admin/register",
      "/api/admin/setup",
      "/api/users",
    ])
      assert.equal(
        (
          await f.request(
            endpoint,
            "POST",
            { password: "any-password-2026!" },
            auth,
          )
        ).status,
        404,
        endpoint,
      );
    assert.equal(
      (await f.request("/api/admin/session", "GET", undefined, auth)).body
        .authenticated,
      true,
    );
    assert.equal(
      (
        await f.request(
          "/api/admin/projects",
          "POST",
          { title: "New", category: "影像作品" },
          { Cookie: auth.Cookie },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request(
          "/api/forum",
          "POST",
          { title: "No", body: "No" },
          { Origin: "https://evil.example" },
        )
      ).status,
      403,
    );
    assert.equal(
      (await f.request("/api/admin/login", "POST", { password: "incorrect" }))
        .status,
      401,
    );
    assert.equal(
      (await f.request("/api/admin/logout", "POST", {}, auth)).status,
      200,
    );
    assert.equal(
      (await f.request("/api/admin/projects", "GET", undefined, auth)).status,
      401,
    );
    const logged = await f.request("/api/admin/login", "POST", {
      password: "test-password-2026!",
    });
    assert.equal(logged.status, 200);
    const newAuth = {
      Cookie: logged.headers.get("set-cookie").split(";")[0],
      "X-CSRF-Token": logged.body.csrf,
    };
    assert.equal(
      (
        await f.request(
          "/api/admin/password",
          "POST",
          { current: "test-password-2026!", password: "new-password-2026!" },
          newAuth,
        )
      ).status,
      200,
    );
    assert.equal(
      (await f.request("/api/admin/projects", "GET", undefined, newAuth))
        .status,
      401,
    );
    const backupLogin = await f.request("/api/admin/login", "POST", {
      password: "new-password-2026!",
    });
    assert.equal(backupLogin.status, 200);
    const backupAuth = {
      Cookie: backupLogin.headers.get("set-cookie").split(";")[0],
      "X-CSRF-Token": backupLogin.body.csrf,
    };
    const uploadedForBackup = await fetch(f.base + "/api/admin/uploads", {
      method: "POST",
      headers: {
        ...backupAuth,
        "X-File-Name": encodeURIComponent("backup.png"),
      },
      body: png,
    });
    assert.equal(uploadedForBackup.status, 201);
    const backupAssetPath = (await uploadedForBackup.json()).src;
    const ticketResponse = await f.request(
      "/api/admin/backup-ticket",
      "POST",
      {},
      backupAuth,
    );
    assert.equal(ticketResponse.status, 200);
    const backupResponse = await fetch(f.base + ticketResponse.body.url, {
      headers: { Cookie: backupAuth.Cookie },
    });
    assert.equal(backupResponse.status, 200);
    assert.match(
      backupResponse.headers.get("content-type"),
      /application\/zip/,
    );
    assert.match(
      backupResponse.headers.get("content-disposition"),
      /after-the-credits-backup-.*\.zip/,
    );
    const backupBytes = Buffer.from(await backupResponse.arrayBuffer());
    const backupFiles = readStoredZip(backupBytes);
    assert.ok(backupFiles.has("BACKUP-README.txt"));
    assert.ok(backupFiles.has("backup-manifest.json"));
    assert.ok(backupFiles.has("data/portfolio.sqlite"));
    assert.deepEqual(backupFiles.get(backupAssetPath), png);
    assert.ok(
      backupFiles
        .get("data/portfolio.sqlite")
        .subarray(0, 16)
        .equals(Buffer.from("SQLite format 3\0")),
    );
    assert.equal(
      (
        await f.request("/api/admin/backup", "GET", undefined, {
          Cookie: backupAuth.Cookie,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request(
          "/api/admin/backup-ticket",
          "POST",
          {},
          { Cookie: backupAuth.Cookie },
        )
      ).status,
      403,
    );
    for (const file of [
      "/server.mjs",
      "/site.json",
      "/data/portfolio.sqlite",
      "/assets/../data/setup-key",
      "/package.json",
      "/tests/server.test.mjs",
      "/admin-account.mjs",
      "/init-admin.mjs",
    ])
      assert.equal((await f.request(file)).status, 404, file);
  } finally {
    await f.close();
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("Real uploads, draft isolation, publishing, ranges and site validation", async () => {
  const f = await fixture({ rateLimits: false });
  try {
    const auth = await setup(f);
    const uploaded = await fetch(f.base + "/api/admin/uploads", {
      method: "POST",
      headers: { ...auth, "X-File-Name": encodeURIComponent("封面.png") },
      body: png,
    });
    assert.equal(uploaded.status, 201);
    const asset = await uploaded.json();
    assert.equal(asset.kind, "image");
    const payload = {
      title: "测试作品",
      category: "影像作品",
      summary: "作品简介",
      cover: asset.src,
      status: "draft",
      media: [{ kind: "image", src: asset.src, name: "图片", caption: "画面" }],
    };
    const project = await f.request(
      "/api/admin/projects",
      "POST",
      payload,
      auth,
    );
    assert.equal(project.status, 201);
    assert.equal((await f.request("/api/projects")).body.projects.length, 0);
    assert.equal((await f.request("/" + asset.src)).status, 404);
    assert.equal(
      (await fetch(f.base + "/" + asset.src, { headers: auth })).status,
      200,
    );
    await f.request(
      `/api/admin/projects/${project.body.project.id}`,
      "PUT",
      { ...payload, status: "published" },
      auth,
    );
    assert.equal((await f.request("/api/projects")).body.projects.length, 1);
    const range = await fetch(f.base + "/" + asset.src, {
      headers: { Range: "bytes=0-3" },
    });
    assert.equal(range.status, 206);
    assert.equal((await range.arrayBuffer()).byteLength, 4);
    assert.equal(
      (
        await fetch(f.base + "/" + asset.src, {
          headers: { Range: "bytes=999999-1000000" },
        })
      ).status,
      416,
    );
    assert.equal(
      (
        await f.request(
          "/api/admin/projects",
          "POST",
          { ...payload, status: "published", cover: "" },
          auth,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request(
          "/api/admin/projects",
          "POST",
          { ...payload, externalUrl: "javascript:alert(1)" },
          auth,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request(
          "/api/admin/projects",
          "POST",
          { ...payload, category: "invented" },
          auth,
        )
      ).status,
      400,
    );
    const invalid = await fetch(f.base + "/api/admin/uploads", {
      method: "POST",
      headers: { ...auth, "X-File-Name": "fake.jpg" },
      body: "<html>fake</html>",
    });
    assert.equal(invalid.status, 415);
    const config = (await f.request("/api/site")).body;
    assert.equal(
      (
        await f.request(
          "/api/admin/site",
          "PUT",
          { ...config, categories: ["摄影"] },
          auth,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request(
          "/api/admin/site",
          "PUT",
          { ...config, name: "新站名" },
          auth,
        )
      ).status,
      200,
    );
    assert.equal((await f.request("/api/site")).body.name, "新站名");
    await f.request(
      `/api/admin/projects/${project.body.project.id}`,
      "PUT",
      { ...payload, status: "archived" },
      auth,
    );
    assert.equal((await f.request("/api/projects")).body.projects.length, 0);
    assert.equal((await f.request("/" + asset.src)).status, 404);
    await f.request(
      `/api/admin/projects/${project.body.project.id}`,
      "DELETE",
      undefined,
      auth,
    );
    assert.equal(
      (await f.request("/api/admin/projects", "GET", undefined, auth)).body
        .projects.length,
      0,
    );
  } finally {
    await f.close();
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("Anonymous posts are rate limited without requiring login", async () => {
  const f = await fixture();
  try {
    const payload = { title: "first", body: "visitor" };
    assert.equal((await f.request("/api/forum", "POST", payload)).status, 201);
    assert.equal((await f.request("/api/forum", "POST", payload)).status, 429);
    assert.equal(
      (await f.request("/api/admin/session")).body.authenticated,
      false,
    );
  } finally {
    await f.close();
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("Comparison pairs validate, persist and follow project publication permissions", async () => {
  const f = await fixture({ rateLimits: false });
  try {
    const auth = await setup(f);
    async function upload(name, bytes) {
      const response = await fetch(f.base + "/api/admin/uploads", {
        method: "POST",
        headers: { ...auth, "X-File-Name": encodeURIComponent(name) },
        body: bytes,
      });
      assert.equal(response.status, 201);
      const asset = await response.json();
      return {
        kind: asset.kind,
        src: asset.src,
        name: asset.name,
        width: 1920,
        height: 1080,
      };
    }
    const before = await upload("before.png", png);
    const after = await upload("after.png", png);
    const payload = {
      title: "调色作品",
      category: "影像作品",
      summary: "调色对比简介",
      cover: before.src,
      status: "draft",
      comparison: { before, after: null },
    };
    const draft = await f.request("/api/admin/projects", "POST", payload, auth);
    assert.equal(draft.status, 201);
    const id = draft.body.project.id;
    assert.deepEqual(draft.body.project.comparison, { before, after: null });
    assert.equal((await f.request("/" + before.src)).status, 404);
    assert.equal((await f.request("/api/projects")).body.projects.length, 0);
    assert.equal(
      (
        await f.request(
          `/api/admin/projects/${id}`,
          "PUT",
          { ...payload, status: "published" },
          auth,
        )
      ).status,
      400,
    );
    const complete = {
      ...payload,
      cover: before.src,
      comparison: { before, after },
      status: "published",
    };
    assert.equal(
      (await f.request(`/api/admin/projects/${id}`, "PUT", complete, auth))
        .status,
      200,
    );
    assert.deepEqual(
      (await f.request("/api/projects")).body.projects[0].comparison,
      { before, after },
    );
    assert.equal((await f.request("/" + after.src)).status, 200);
    const videoBytes = Buffer.from(
      "000000186674797069736f6d0000020069736f6d6d703432",
      "hex",
    );
    const videoBefore = {
      ...(await upload("before.mp4", videoBytes)),
      duration: 5,
    };
    const videoAfter = {
      ...(await upload("after.mp4", videoBytes)),
      duration: 5,
    };
    for (const pair of [
      [],
      { before: { ...before, src: "uploads/nonexistent.jpg" }, after },
      { before, after: videoAfter },
      { before, after: { ...after, width: 1000, height: 1000 } },
      { before: videoBefore, after: { ...videoAfter, duration: 7 } },
      { before: { ...before, width: -1 }, after },
      { before: { ...before, kind: "pdf" }, after },
    ]) {
      assert.equal(
        (
          await f.request(
            `/api/admin/projects/${id}`,
            "PUT",
            { ...complete, comparison: pair },
            auth,
          )
        ).status,
        400,
      );
    }
    assert.equal(
      (
        await f.request(
          `/api/admin/projects/${id}`,
          "PUT",
          {
            ...complete,
            comparison: { before: videoBefore, after: videoAfter },
          },
          auth,
        )
      ).status,
      200,
    );
    assert.equal((await f.request("/" + before.src)).status, 200);
    assert.equal((await f.request("/" + after.src)).status, 404);
    const range = await fetch(f.base + "/" + videoAfter.src, {
      headers: { Range: "bytes=0-3" },
    });
    assert.equal(range.status, 206);
    assert.equal((await range.arrayBuffer()).byteLength, 4);
    await f.request(
      `/api/admin/projects/${id}`,
      "PUT",
      {
        ...complete,
        comparison: { before: videoBefore, after: videoAfter },
        status: "archived",
      },
      auth,
    );
    assert.equal((await f.request("/" + videoAfter.src)).status, 404);
    assert.equal(
      (await f.request("/" + videoAfter.src, "GET", undefined, auth)).status,
      200,
    );
    assert.equal((await f.request("/api/forum")).body.total, 0);
    await f.request(
      `/api/admin/projects/${id}`,
      "PUT",
      { ...complete, comparison: null },
      auth,
    );
    assert.equal(
      (await f.request("/api/projects")).body.projects[0].comparison,
      null,
    );
  } finally {
    await f.close();
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("HTTPS reverse-proxy origin and secure admin cookies work without allowing cross-site writes", async () => {
  const f = await fixture({
    rateLimits: false,
    origin: "https://portfolio.example/",
  });
  try {
    await initializeAdmin("proxy-password-2026!", f.dataDir);
    const sameOrigin = {
      Origin: "https://portfolio.example",
      Host: "portfolio.example",
    };
    const login = await f.request(
      "/api/admin/login",
      "POST",
      { password: "proxy-password-2026!" },
      sameOrigin,
    );
    assert.equal(login.status, 200);
    assert.match(login.headers.get("set-cookie"), /Secure/);
    const auth = {
      Cookie: login.headers.get("set-cookie").split(";")[0],
      "X-CSRF-Token": login.body.csrf,
      ...sameOrigin,
    };
    assert.equal(
      (await f.request("/api/admin/session", "GET", undefined, auth)).body
        .authenticated,
      true,
    );
    assert.equal(
      (
        await f.request(
          "/api/admin/projects",
          "POST",
          { title: "x" },
          { ...auth, Origin: "https://evil.example" },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request(
          "/api/forum",
          "POST",
          { title: "x", body: "x" },
          { Origin: "https://evil.example" },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request("/api/admin/projects", "GET", undefined, {
          ...auth,
          Host: "other.example",
          Origin: "https://portfolio.example",
        })
      ).status,
      200,
    );
  } finally {
    await f.close();
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("Trusted proxy protocol allows HTTPS origin when APP_ORIGIN is omitted", async () => {
  const previous = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = "1";
  const f = await fixture({ rateLimits: false });
  try {
    await initializeAdmin("forwarded-password-2026!", f.dataDir);
    const headers = {
      Origin: "https://portfolio.example",
      "X-Forwarded-Host": "portfolio.example",
      "X-Forwarded-Proto": "https",
    };
    const login = await f.request(
      "/api/admin/login",
      "POST",
      { password: "forwarded-password-2026!" },
      headers,
    );
    assert.equal(login.status, 200);
    assert.match(login.headers.get("set-cookie"), /Secure/);
  } finally {
    if (previous === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previous;
    await f.close();
    await fs.rm(f.root, { recursive: true, force: true });
  }
});
