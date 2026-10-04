(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character],
    );
  const icon = (name) => `<i data-lucide="${name}"></i>`;
  const state = {
    auth: false,
    csrf: "",
    configured: false,
    site: null,
    projects: [],
    projectFilter: "all",
    topicPage: 1,
    topicQuery: "",
    topicData: null,
    editor: null,
    uploading: false,
    dirty: false,
  };
  let routeVersion = 0;
  let confirmAction = null;
  let toastTimer;
  function hydrate() {
    window.lucide?.createIcons({ attrs: { "aria-hidden": "true" } });
  }
  function toast(message) {
    clearTimeout(toastTimer);
    $("#toast").textContent = message;
    $("#toast").classList.add("visible");
    toastTimer = setTimeout(
      () => $("#toast").classList.remove("visible"),
      3000,
    );
  }
  function statusLabel(status) {
    return { draft: "草稿", published: "已发布", archived: "已下架" }[status];
  }
  function date(value) {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      timeZone: "Asia/Shanghai",
    }).format(new Date(value));
  }
  async function api(url, method = "GET", data) {
    if (location.protocol === "file:")
      throw new Error("请通过已启动的本地服务访问后台");
    const response = await fetch(url, {
      method,
      headers: {
        ...(data ? { "Content-Type": "application/json" } : {}),
        ...(state.csrf ? { "X-CSRF-Token": state.csrf } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401 && !url.endsWith("/login")) {
        state.auth = false;
        authView();
      }
      throw new Error(result.error || "请求失败");
    }
    return result;
  }
  async function downloadBackup() {
    const result = await api("/api/admin/backup-ticket", "POST", {});
    const link = document.createElement("a");
    link.href = result.url;
    link.download = "";
    link.rel = "nofollow";
    document.body.append(link);
    link.click();
    link.remove();
  }
  function authView(message = "") {
    window.PortfolioComparison.dispose($("#admin-main"));
    $("#admin-logout").hidden = true;
    $("#admin-main").innerHTML =
      `<section class="auth-shell"><div class="auth-discovery" aria-hidden="true"><div class="discovery-frame"><span></span><span></span><span></span><span></span><i data-lucide="aperture"></i><b></b></div><div class="discovery-copy"><strong>ENTRY LOCATED</strong><span>PRIVATE STUDIO / ADMIN</span></div></div><h1>回到创作室。</h1><p>管理作品，整理留言。</p><form id="auth-form" class="auth-form"><label>管理密码<input type="password" name="password" required maxlength="128" autocomplete="current-password"></label><p class="form-error" role="alert">${esc(message || (!state.configured ? "管理员尚未在服务器初始化。" : ""))}</p><button class="button" type="submit" ${state.configured ? "" : "disabled"}>${icon("lock-keyhole")}登录后台</button></form></section>`;
    hydrate();
    window.PortfolioMotion?.content($("#admin-main .auth-shell"));
  }
  function shell(page) {
    $("#admin-logout").hidden = false;
    $("#admin-main").innerHTML =
      `<div class="admin-layout"><nav class="admin-nav" aria-label="后台导航">${[
        ["projects", "作品管理", "clapperboard"],
        ["forum", "论坛管理", "messages-square"],
        ["settings", "站点设置", "settings-2"],
      ]
        .map(
          ([id, label, image]) =>
            `<a class="${page === id ? "active" : ""}" href="#${id}" ${page === id ? 'aria-current="page"' : ""}>${icon(image)}${label}</a>`,
        )
        .join(
          "",
        )}</nav><section class="admin-content" id="admin-content"><div class="loading-state">${icon("loader-circle")}正在读取数据</div></section></div>`;
    hydrate();
    window.PortfolioMotion?.page($("#admin-main"));
  }
  function heading(title, description, action = "") {
    return `<div class="admin-heading"><div><h1>${esc(title)}</h1><p>${esc(description)}</p></div>${action}</div><p class="form-error admin-form-error" id="admin-error" role="alert"></p>`;
  }
  function projectList() {
    const projects = state.projects.filter(
      (project) =>
        state.projectFilter === "all" || project.status === state.projectFilter,
    );
    $("#admin-content").innerHTML =
      `${heading("作品管理", "先存草稿，准备好后再发布。", `<a class="button" href="#edit/new">${icon("plus")}新建作品</a>`)}<div class="admin-filters"><select id="project-status-filter" aria-label="作品状态">${[
        ["all", "全部状态"],
        ["draft", "草稿"],
        ["published", "已发布"],
        ["archived", "已下架"],
      ]
        .map(
          ([value, label]) =>
            `<option value="${value}" ${state.projectFilter === value ? "selected" : ""}>${label}</option>`,
        )
        .join(
          "",
        )}</select><span class="admin-count">${projects.length} 件作品</span></div>${projects.length ? `<table class="admin-table"><thead><tr><th>作品</th><th>状态</th><th>更新</th><th>操作</th></tr></thead><tbody>${projects.map((project) => `<tr><td><div class="table-project">${project.cover ? `<img src="/${esc(project.cover)}" alt="">` : `<span class="cover-placeholder">${icon("image")}</span>`}<div><strong>${esc(project.title)}</strong><small>${esc(project.category)} · ${esc(project.year)}</small></div></div></td><td><span class="status ${project.status}">${statusLabel(project.status)}</span></td><td>${date(project.updated)}</td><td><div class="table-actions"><a class="icon-button" href="#edit/${project.id}" aria-label="编辑${esc(project.title)}" title="编辑作品">${icon("pencil")}</a><button class="icon-button" data-project-status="${project.id}" aria-label="${project.status === "published" ? "下架" : "发布"}${esc(project.title)}" title="${project.status === "published" ? "下架作品" : "发布作品"}">${icon(project.status === "published" ? "eye-off" : "send")}</button><button class="icon-button" data-project-delete="${project.id}" aria-label="删除${esc(project.title)}" title="删除作品">${icon("trash-2")}</button></div></td></tr>`).join("")}</tbody></table>` : `<div class="empty-state">${icon("clapperboard")}<h2>${state.projects.length ? "这个状态下还没有作品" : "还没有作品，慢慢来。"}</h2><a class="button secondary" href="#edit/new">${icon("plus")}新建作品</a></div>`}`;
    hydrate();
  }
  function editor(project) {
    state.editor = structuredClone(
      project || {
        title: "",
        year: "",
        role: "",
        category: state.site.categories[0],
        summary: "",
        description: "",
        externalUrl: "",
        cover: "",
        media: [],
        comparison: null,
        status: "draft",
        featured: false,
      },
    );
    state.dirty = false;
    const p = state.editor;
    const comparisonEnabled = Boolean(p.comparison);
    p.comparison ||= { before: null, after: null };
    $("#admin-content").innerHTML =
      `${heading(project ? "编辑作品" : "新建作品", project ? `${statusLabel(project.status)} · ${project.title}` : "从一个名字、一张封面开始。", '<a class="text-link" href="#projects">返回作品管理</a>')}<form id="project-form" class="editor-form"><div class="editor-grid"><div class="editor-fields"><label>作品名称<input name="title" value="${esc(p.title)}" required maxlength="100"></label><div class="form-pair"><label>分类<select name="category">${state.site.categories.map((category) => `<option ${category === p.category ? "selected" : ""}>${esc(category)}</option>`).join("")}</select></label><label>年份<input name="year" value="${esc(p.year)}" maxlength="12" placeholder="2026"></label></div><label>创作分工<input name="role" value="${esc(p.role)}" maxlength="100" placeholder="例如：导演 / 摄影 / 剪辑"></label><label>简介<textarea name="summary" maxlength="300" rows="3">${esc(p.summary)}</textarea></label><label>作品介绍<textarea name="description" maxlength="12000" rows="7">${esc(p.description)}</textarea></label><label>外部作品链接<input name="externalUrl" type="url" value="${esc(p.externalUrl)}" placeholder="https://…"></label></div><aside class="cover-editor"><label>作品封面</label><div id="cover-preview"></div><label class="upload-control">${icon("image-up")}上传封面<input id="cover-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label><label class="checkbox-label"><input type="checkbox" name="featured" ${p.featured ? "checked" : ""}>首页精选</label></aside></div><section class="media-editor"><div class="media-editor-head"><h2>作品素材 <span class="admin-count">视频 / 图片 / PDF</span></h2><label class="upload-control">${icon("upload")}添加素材<input id="media-input" type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,application/pdf"></label></div><div id="media-list"></div><p class="upload-status" id="upload-status" aria-live="polite"></p></section><p class="form-error" id="project-error" role="alert"></p><div class="editor-footer"><select name="status" aria-label="作品发布状态">${["draft", "published", "archived"].map((status) => `<option value="${status}" ${p.status === status ? "selected" : ""}>${statusLabel(status)}</option>`).join("")}</select><div><a class="button secondary" href="#projects">取消</a><button class="button" type="submit">${icon("save")}保存作品</button></div></div></form>`;
    renderCover();
    renderMedia();
    document.querySelector(".media-editor").insertAdjacentHTML(
      "beforebegin",
      `<section class="comparison-editor"><div class="media-editor-head"><h2>${icon("sliders-horizontal")}调色对比</h2><label class="comparison-switch"><input type="checkbox" id="comparison-enabled" ${comparisonEnabled ? "checked" : ""} role="switch"><span>启用对比</span></label></div><div id="comparison-fields" ${comparisonEnabled ? "" : "hidden"}><div class="comparison-upload-grid">${[
        ["before", "调色前"],
        ["after", "调色后"],
      ]
        .map(
          ([side, label]) =>
            `<div class="comparison-upload"><h3>${label}</h3><div id="comparison-${side}-preview"></div><label class="upload-control">${icon("upload")}上传${label}文件<input id="comparison-${side}-input" data-comparison-side="${side}" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" aria-label="上传${label}文件"></label></div>`,
        )
        .join(
          "",
        )}</div><div id="comparison-preview"></div><p class="form-error" id="comparison-error" role="alert"></p></div></section>`,
    );
    renderComparison();
    hydrate();
  }
  function renderCover() {
    $("#cover-preview").innerHTML = state.editor.cover
      ? `<img class="cover-preview" src="/${esc(state.editor.cover)}" alt="封面预览"><button class="text-link" type="button" data-action="remove-cover">${icon("x")}移除封面</button>`
      : `<div class="cover-empty">${icon("image")}</div>`;
    hydrate();
  }
  function renderMedia() {
    $("#media-list").innerHTML = state.editor.media.length
      ? state.editor.media
          .map(
            (media, index) =>
              `<div class="asset-row">${icon({ image: "image", video: "film", pdf: "file-text" }[media.kind])}<div class="asset-meta"><a href="/${esc(media.src)}" target="_blank" rel="noopener">${esc(media.name)}</a><input type="text" value="${esc(media.caption)}" maxlength="300" data-caption="${index}" placeholder="素材说明（选填）" aria-label="${esc(media.name)}素材说明"></div><button class="icon-button" type="button" data-media-up="${index}" ${index === 0 ? "disabled" : ""} aria-label="向上移动素材" title="向上移动">${icon("arrow-up")}</button><button class="icon-button" type="button" data-media-down="${index}" ${index === state.editor.media.length - 1 ? "disabled" : ""} aria-label="向下移动素材" title="向下移动">${icon("arrow-down")}</button><button class="icon-button" type="button" data-media-remove="${index}" aria-label="移除素材" title="移除素材">${icon("x")}</button></div>`,
          )
          .join("")
      : '<p class="no-replies">还没有添加素材。</p>';
    hydrate();
  }
  function renderComparison() {
    const pair = state.editor.comparison;
    const preview = $("#comparison-preview");
    window.PortfolioComparison.dispose(preview);
    for (const side of ["before", "after"]) {
      const asset = pair[side];
      $(`#comparison-${side}-preview`).innerHTML = asset
        ? `${asset.kind === "image" ? `<img class="comparison-upload-preview" src="/${esc(asset.src)}" alt="${side === "before" ? "调色前" : "调色后"}预览">` : `<video class="comparison-upload-preview" src="/${esc(asset.src)}" preload="metadata" playsinline muted></video>`}<div class="comparison-file"><span>${esc(asset.name)}</span><button class="icon-button" type="button" data-comparison-remove="${side}" aria-label="移除${side === "before" ? "调色前" : "调色后"}文件" title="移除文件">${icon("x")}</button></div>`
        : `<div class="comparison-upload-empty">${icon("image-plus")}</div>`;
    }
    preview.innerHTML = window.PortfolioComparison.markup(pair);
    if (pair.before && pair.after) window.PortfolioComparison.mount(preview);
    hydrate();
  }
  async function inspectComparison(file) {
    const kind = file.type.startsWith("image/")
      ? "image"
      : file.type.startsWith("video/")
        ? "video"
        : "";
    if (!kind || (kind === "image" && file.type === "image/gif"))
      throw new Error("对比文件需要 JPG、PNG、WebP 图片或 MP4、WebM 视频");
    const src = URL.createObjectURL(file);
    const element = document.createElement(kind === "image" ? "img" : "video");
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("无法读取对比素材，请检查文件格式")),
          12000,
        );
        const done = () => {
          clearTimeout(timer);
          const width =
            kind === "image" ? element.naturalWidth : element.videoWidth;
          const height =
            kind === "image" ? element.naturalHeight : element.videoHeight;
          if (
            !width ||
            !height ||
            (kind === "video" &&
              (!Number.isFinite(element.duration) || element.duration <= 0))
          ) {
            reject(new Error("无法读取对比素材，请检查文件编码"));
            return;
          }
          resolve({
            kind,
            width,
            height,
            ...(kind === "video" ? { duration: element.duration } : {}),
          });
        };
        element.addEventListener(
          kind === "image" ? "load" : "loadedmetadata",
          done,
          { once: true },
        );
        element.addEventListener(
          "error",
          () => {
            clearTimeout(timer);
            reject(new Error("素材无法打开，请使用浏览器支持的图片或视频"));
          },
          { once: true },
        );
        if (kind === "video") {
          element.preload = "metadata";
          element.muted = true;
        }
        element.src = src;
      });
    } finally {
      element.removeAttribute("src");
      if (kind === "video") element.load();
      URL.revokeObjectURL(src);
    }
  }
  async function uploadFile(file, message) {
    if (file.size > 256 * 1024 * 1024) throw new Error("单个文件最大 256 MB");
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/admin/uploads");
      xhr.setRequestHeader("X-CSRF-Token", state.csrf);
      xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.upload.onprogress = (event) => {
        if ($("#upload-status"))
          $("#upload-status").textContent =
            `${message} · ${event.lengthComputable ? Math.round((event.loaded / event.total) * 100) + "%" : "上传中"}`;
      };
      xhr.onload = () => {
        try {
          const result = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) resolve(result);
          else reject(new Error(result.error || "上传失败"));
        } catch {
          reject(new Error("上传失败"));
        }
      };
      xhr.onerror = () => reject(new Error("上传中断，请重试"));
      xhr.send(file);
    });
  }
  async function uploadFiles(input) {
    if (state.uploading || !input.files.length) return;
    state.uploading = true;
    $('#project-form [type="submit"]').disabled = true;
    $("#project-error").textContent = "";
    $("#comparison-error").textContent = "";
    $("#project-form")
      .querySelectorAll(
        'input[type="file"], #comparison-enabled, [data-comparison-remove]',
      )
      .forEach((control) => {
        control.disabled = true;
      });
    try {
      const files = [...input.files];
      if (
        input.id === "media-input" &&
        state.editor.media.length + files.length > 24
      )
        throw new Error("每件作品最多添加 24 个素材");
      for (const [index, file] of files.entries()) {
        if (file.size > 256 * 1024 * 1024)
          throw new Error("单个文件最大 256 MB");
        const side = input.dataset.comparisonSide;
        let metadata;
        if (side) {
          metadata = await inspectComparison(file);
          const other =
            state.editor.comparison[side === "before" ? "after" : "before"];
          if (other) {
            if (other.kind !== metadata.kind)
              throw new Error("调色前后必须同时为图片或同时为视频");
            if (
              other.width &&
              other.height &&
              Math.abs(
                other.width / other.height - metadata.width / metadata.height,
              ) > 0.01
            )
              throw new Error("调色前后的画幅比例必须一致");
            if (
              other.duration &&
              metadata.duration &&
              Math.abs(other.duration - metadata.duration) > 0.15
            )
              throw new Error("调色前后的视频时长必须一致");
          }
        }
        if (input.id === "cover-input" && !file.type.startsWith("image/"))
          throw new Error("封面需要上传图片");
        const result = await uploadFile(
          file,
          `${file.name} (${index + 1}/${files.length})`,
        );
        if (side) {
          if (result.kind !== metadata.kind)
            throw new Error("对比素材文件类型不匹配");
          state.editor.comparison[side] = {
            ...metadata,
            src: result.src,
            name: result.name,
          };
          renderComparison();
        } else if (input.id === "cover-input") {
          if (result.kind !== "image") throw new Error("封面需要上传图片");
          state.editor.cover = result.src;
          renderCover();
        } else {
          state.editor.media.push({
            kind: result.kind,
            src: result.src,
            name: result.name,
            caption: "",
          });
          renderMedia();
        }
        state.dirty = true;
      }
      $("#upload-status").textContent = "上传完成";
    } catch (error) {
      $("#project-error").textContent = error.message;
      if (input.dataset.comparisonSide)
        $("#comparison-error").textContent = error.message;
      $("#upload-status").textContent = "";
    } finally {
      state.uploading = false;
      input.value = "";
      if ($("#project-form"))
        $('#project-form [type="submit"]').disabled = false;
      $("#project-form")
        ?.querySelectorAll(
          'input[type="file"], #comparison-enabled, [data-comparison-remove]',
        )
        .forEach((control) => {
          control.disabled = false;
        });
    }
  }
  async function forumList() {
    const version = routeVersion;
    const data = await api(
      `/api/admin/topics?${new URLSearchParams({ page: state.topicPage, q: state.topicQuery })}`,
    );
    if (version !== routeVersion) return;
    state.topicData = data;
    $("#admin-content").innerHTML =
      `${heading("论坛管理", "整理话题与回复，保持交流的空间。")}<div class="admin-filters"><form id="admin-forum-search" class="compact-search"><input name="query" type="search" maxlength="100" value="${esc(state.topicQuery)}" placeholder="搜索帖子" aria-label="搜索帖子"><button class="icon-button" type="submit" aria-label="搜索帖子" title="搜索帖子">${icon("search")}</button></form><span class="admin-count">${data.total} 个话题</span></div>${data.topics.length ? `<table class="admin-table"><thead><tr><th>话题</th><th>状态</th><th>回复</th><th>操作</th></tr></thead><tbody>${data.topics.map((topic) => `<tr><td><a class="admin-topic-title" href="#topic/${topic.id}">${esc(topic.title)}</a><div class="topic-meta">${esc(topic.nickname)} · ${esc(topic.category)}</div></td><td><span class="status ${topic.hidden ? "archived" : "published"}">${topic.hidden ? "已隐藏" : "公开"}</span></td><td>${topic.replyCount}</td><td><div class="table-actions"><a class="icon-button" href="#topic/${topic.id}" aria-label="管理帖子" title="管理帖子">${icon("pencil")}</a><button class="icon-button" data-topic-toggle="${topic.id}" data-hidden="${Boolean(topic.hidden)}" aria-label="${topic.hidden ? "恢复" : "隐藏"}帖子" title="${topic.hidden ? "恢复公开" : "隐藏帖子"}">${icon(topic.hidden ? "eye" : "eye-off")}</button><button class="icon-button" data-topic-delete="${topic.id}" aria-label="删除帖子" title="删除帖子">${icon("trash-2")}</button></div></td></tr>`).join("")}</tbody></table>` : `<div class="empty-state">${icon("messages-square")}<h2>暂时没有话题。</h2></div>`}${data.pages > 1 ? `<div class="pagination admin-pagination"><button class="icon-button" data-topic-page="${data.page - 1}" ${data.page === 1 ? "disabled" : ""} aria-label="上一页" title="上一页">${icon("chevron-left")}</button><span>${data.page} / ${data.pages}</span><button class="icon-button" data-topic-page="${data.page + 1}" ${data.page === data.pages ? "disabled" : ""} aria-label="下一页" title="下一页">${icon("chevron-right")}</button></div>` : ""}`;
    hydrate();
  }
  async function moderation(id) {
    const version = routeVersion;
    const data = await api(`/api/admin/topics/${id}`);
    if (version !== routeVersion) return;
    const topic = data.topic;
    $("#admin-content").innerHTML =
      `${heading("管理话题", `${data.replies.length} 条回复`, '<a class="text-link" href="#forum">返回论坛管理</a>')}<article class="moderation-topic"><div class="topic-meta">${esc(topic.nickname)} · ${esc(topic.category)} · ${date(topic.created)}</div><h2>${esc(topic.title)}</h2><p class="topic-body paragraph">${esc(topic.body)}</p><div class="moderation-actions">${[
        ["hidden", "eye-off", "eye", "隐藏", "恢复公开"],
        ["pinned", "pin", "pin-off", "置顶", "取消置顶"],
        ["locked", "lock-keyhole", "lock-open", "关闭回复", "开放回复"],
      ]
        .map(
          ([field, off, on, label, inverse]) =>
            `<button class="button secondary" data-moderate="${id}" data-field="${field}" data-value="${!topic[field]}">${icon(topic[field] ? on : off)}${topic[field] ? inverse : label}</button>`,
        )
        .join(
          "",
        )}<button class="button secondary" data-topic-delete="${id}">${icon("trash-2")}删除话题</button><a class="text-link" href="/forum/topic/${id}" target="_blank" rel="noopener">前台查看 ${icon("arrow-up-right")}</a></div></article><section>${data.replies.map((reply) => `<article class="moderation-reply ${reply.hidden ? "is-hidden" : ""}"><div class="topic-meta"><span>${esc(reply.nickname)} · ${date(reply.created)} ${reply.hidden ? "· 已隐藏" : ""}</span><div class="table-actions"><button class="icon-button" data-reply-toggle="${reply.id}" data-topic="${id}" data-hidden="${Boolean(reply.hidden)}" aria-label="${reply.hidden ? "恢复" : "隐藏"}回复" title="${reply.hidden ? "恢复回复" : "隐藏回复"}">${icon(reply.hidden ? "eye" : "eye-off")}</button><button class="icon-button" data-reply-delete="${reply.id}" data-topic="${id}" aria-label="删除回复" title="删除回复">${icon("trash-2")}</button></div></div><p class="paragraph">${esc(reply.body)}</p></article>`).join("")}</section>`;
    hydrate();
  }
  function settings() {
    const config = state.site;
    $("#admin-content").innerHTML =
      `${heading("站点设置", "更新署名、介绍与作品分类。", `<button class="button secondary" type="button" data-action="download-backup">${icon("download")}下载完整备份</button>`)}<p class="admin-backup-note">备份包含作品、论坛、站点设置、管理员数据和已上传素材，请妥善保管。</p><form id="settings-form" class="admin-settings"><div class="form-pair"><label>站点名称<input name="name" value="${esc(config.name)}" required maxlength="16"></label><label>署名<input name="author" value="${esc(config.author)}" required maxlength="20"></label></div><label>英文名<input name="english" value="${esc(config.english)}" maxlength="50"></label><label>首页寄语<input name="tagline" value="${esc(config.tagline)}" required maxlength="60"></label><label>首页介绍<textarea name="intro" rows="3" maxlength="200">${esc(config.intro)}</textarea></label><label>关于我<textarea name="about" rows="7" maxlength="4000">${esc(config.about)}</textarea></label><label>联系邮箱 <span>选填</span><input name="email" type="email" value="${esc(config.email)}" maxlength="150"></label><label>作品分类<input name="categories" value="${esc(config.categories.join("，"))}" required><span class="form-note">用逗号分隔，最多 8 个分类。</span></label><p class="form-error" role="alert"></p><button class="button" type="submit">${icon("save")}保存设置</button></form><form id="password-form" class="admin-settings"><h2>修改管理密码</h2><label>当前密码<input type="password" name="current" required maxlength="128" autocomplete="current-password"></label><label>新密码<input type="password" name="password" required minlength="12" maxlength="128" autocomplete="new-password"></label><label>确认新密码<input type="password" name="confirm" required minlength="12" maxlength="128" autocomplete="new-password"></label><p class="form-error" role="alert"></p><button class="button secondary" type="submit">${icon("key-round")}更新密码</button></form>`;
    hydrate();
  }
  function confirm(message, action) {
    $("#confirm-message").textContent = message;
    confirmAction = action;
    $("#confirm-dialog").showModal();
    hydrate();
  }
  async function route() {
    if (!state.auth) return;
    const version = ++routeVersion;
    const [rawPage, id] = location.hash.slice(1).split("/");
    const page = rawPage || "projects";
    const section = ["projects", "edit"].includes(page)
      ? "projects"
      : ["forum", "topic"].includes(page)
        ? "forum"
        : "settings";
    window.PortfolioComparison.dispose($("#admin-main"));
    shell(section);
    try {
      if (!state.site) state.site = await api("/api/admin/site");
      if (section === "projects") {
        const data = await api("/api/admin/projects");
        if (version !== routeVersion) return;
        state.projects = data.projects;
        if (page === "edit") {
          const project = state.projects.find((project) => project.id === id);
          if (id !== "new" && !project) throw new Error("作品不存在");
          editor(project);
        } else projectList();
      } else if (page === "topic") await moderation(id);
      else if (section === "forum") await forumList();
      else settings();
    } catch (error) {
      if (state.auth && version === routeVersion && $("#admin-content")) {
        $("#admin-content").innerHTML =
          `<div class="empty-state"><h2>${esc(error.message)}</h2><button class="button secondary" data-action="retry-route">${icon("refresh-cw")}重试</button></div>`;
        hydrate();
      }
    }
  }
  async function connect() {
    try {
      const data = await api("/api/admin/session");
      Object.assign(state, {
        auth: data.authenticated,
        configured: data.configured,
        csrf: data.csrf || "",
      });
      if (state.auth) route();
      else authView();
    } catch (error) {
      authView(error.message);
    }
  }
  document.addEventListener("submit", async (event) => {
    const form = event.target;
    event.preventDefault();
    if (form.id === "admin-forum-search") {
      state.topicQuery = new FormData(form).get("query").trim();
      state.topicPage = 1;
      await forumList();
      return;
    }
    const data = Object.fromEntries(new FormData(form));
    const button = form.querySelector('[type="submit"]');
    const error = form.querySelector(".form-error");
    if (!button) return;
    button.disabled = true;
    if (error) error.textContent = "";
    try {
      if (form.id === "auth-form") {
        const result = await api("/api/admin/login", "POST", {
          password: data.password,
        });
        state.auth = true;
        state.configured = true;
        state.csrf = result.csrf;
        history.replaceState(null, "", `${location.pathname}#projects`);
        await route();
      } else if (form.id === "project-form") {
        if (state.uploading) throw new Error("请等待素材上传完成");
        const project = {
          ...state.editor,
          ...data,
          featured: form.elements.featured.checked,
          media: state.editor.media,
          comparison: $("#comparison-enabled").checked
            ? state.editor.comparison
            : null,
        };
        await api(
          `/api/admin/projects${project.id ? "/" + project.id : ""}`,
          project.id ? "PUT" : "POST",
          project,
        );
        state.dirty = false;
        location.hash = "projects";
        toast("作品已保存");
      } else if (form.id === "settings-form") {
        data.categories = data.categories
          .split(/[,，]/)
          .map((value) => value.trim())
          .filter(Boolean);
        state.site = await api("/api/admin/site", "PUT", data);
        document.querySelector(".admin-header strong").textContent =
          state.site.name;
        toast("站点设置已更新");
      } else if (form.id === "password-form") {
        if (data.password !== data.confirm) throw new Error("两次密码不一致");
        const result = await api("/api/admin/password", "POST", data);
        state.csrf = result.csrf;
        form.reset();
        toast("密码已更新，其他登录已退出");
      }
    } catch (failure) {
      if (error) error.textContent = failure.message;
      if (form.id === "project-form" && /调色|对比|画幅/.test(failure.message))
        $("#comparison-error").textContent = failure.message;
    } finally {
      button.disabled = false;
    }
  });
  document.addEventListener("change", (event) => {
    if (event.target.id === "project-status-filter") {
      state.projectFilter = event.target.value;
      projectList();
    }
    if (event.target.id === "comparison-enabled") {
      $("#comparison-fields").hidden = !event.target.checked;
      state.dirty = true;
      if (!event.target.checked)
        window.PortfolioComparison.dispose($("#comparison-preview"));
      else window.PortfolioComparison.mount($("#comparison-preview"));
    }
    if (
      ["cover-input", "media-input"].includes(event.target.id) ||
      event.target.dataset.comparisonSide
    )
      uploadFiles(event.target);
  });
  document.addEventListener("input", (event) => {
    if (
      event.target.closest("#project-form") &&
      !event.target.closest("[data-comparison]")
    ) {
      state.dirty = true;
      if (event.target.dataset.caption !== undefined)
        state.editor.media[Number(event.target.dataset.caption)].caption =
          event.target.value;
    }
  });
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("button,a");
    if (!button) return;
    if (
      button.tagName === "A" &&
      button.getAttribute("href")?.startsWith("#") &&
      state.uploading
    ) {
      event.preventDefault();
      toast("请等待素材上传完成");
      return;
    }
    if (
      button.tagName === "A" &&
      button.getAttribute("href")?.startsWith("#") &&
      state.dirty
    ) {
      if (!window.confirm("作品尚未保存，要离开编辑页吗？")) {
        event.preventDefault();
        return;
      }
      state.dirty = false;
    }
    try {
      if (button.dataset.close) $(`#${button.dataset.close}`).close();
      if (button.id === "confirm-action" && confirmAction) {
        button.disabled = true;
        await confirmAction();
        $("#confirm-dialog").close();
        confirmAction = null;
      }
      if (button.id === "admin-logout") {
        await api("/api/admin/logout", "POST", {});
        state.auth = false;
        state.dirty = false;
        window.PortfolioComparison.dispose($("#admin-main"));
        authView();
      }
      if (button.dataset.action === "retry-auth") connect();
      if (button.dataset.action === "retry-route") route();
      if (button.dataset.action === "download-backup") {
        button.disabled = true;
        try {
          await downloadBackup();
          toast("完整备份已开始下载");
        } finally {
          button.disabled = false;
        }
      }
      if (button.dataset.action === "remove-cover") {
        state.editor.cover = "";
        state.dirty = true;
        renderCover();
      }
      if (button.dataset.comparisonRemove && !state.uploading) {
        state.editor.comparison[button.dataset.comparisonRemove] = null;
        state.dirty = true;
        renderComparison();
        $("#comparison-error").textContent = "";
      }
      if (button.dataset.mediaRemove !== undefined) {
        state.editor.media.splice(Number(button.dataset.mediaRemove), 1);
        state.dirty = true;
        renderMedia();
      }
      if (
        button.dataset.mediaUp !== undefined ||
        button.dataset.mediaDown !== undefined
      ) {
        const index = Number(
          button.dataset.mediaUp ?? button.dataset.mediaDown,
        );
        const next = index + (button.dataset.mediaUp !== undefined ? -1 : 1);
        [state.editor.media[index], state.editor.media[next]] = [
          state.editor.media[next],
          state.editor.media[index],
        ];
        state.dirty = true;
        renderMedia();
      }
      if (button.dataset.projectStatus) {
        const project = state.projects.find(
          (p) => p.id === button.dataset.projectStatus,
        );
        await api(`/api/admin/projects/${project.id}`, "PUT", {
          ...project,
          status: project.status === "published" ? "archived" : "published",
        });
        await route();
        toast(project.status === "published" ? "作品已下架" : "作品已发布");
      }
      if (button.dataset.projectDelete)
        confirm("删除后这件作品将不再展示。确认删除吗？", async () => {
          await api(
            `/api/admin/projects/${button.dataset.projectDelete}`,
            "DELETE",
          );
          await route();
          toast("作品已删除");
        });
      if (button.dataset.topicPage) {
        state.topicPage = Number(button.dataset.topicPage);
        await forumList();
      }
      if (button.dataset.topicToggle) {
        await api(`/api/admin/topics/${button.dataset.topicToggle}`, "PATCH", {
          hidden: button.dataset.hidden !== "true",
        });
        await forumList();
        toast("话题状态已更新");
      }
      if (button.dataset.topicDelete)
        confirm(
          "删除后访客将无法访问这个话题及其回复。确认删除吗？",
          async () => {
            await api(
              `/api/admin/topics/${button.dataset.topicDelete}`,
              "DELETE",
            );
            if (location.hash.startsWith("#topic/")) location.hash = "forum";
            else await forumList();
            toast("话题已删除");
          },
        );
      if (button.dataset.moderate) {
        await api(`/api/admin/topics/${button.dataset.moderate}`, "PATCH", {
          [button.dataset.field]: button.dataset.value === "true",
        });
        await moderation(button.dataset.moderate);
        toast("管理操作已保存");
      }
      if (button.dataset.replyToggle) {
        await api(`/api/admin/replies/${button.dataset.replyToggle}`, "PATCH", {
          hidden: button.dataset.hidden !== "true",
        });
        await moderation(button.dataset.topic);
        toast("回复状态已更新");
      }
      if (button.dataset.replyDelete)
        confirm("确认删除这条回复吗？", async () => {
          await api(
            `/api/admin/replies/${button.dataset.replyDelete}`,
            "DELETE",
          );
          await moderation(button.dataset.topic);
          toast("回复已删除");
        });
    } catch (error) {
      if ($("#admin-error")) $("#admin-error").textContent = error.message;
      toast(error.message);
    } finally {
      if (button.id === "confirm-action") button.disabled = false;
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (state.dirty || state.uploading) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  window.addEventListener("hashchange", route);
  hydrate();
  connect();
})();
