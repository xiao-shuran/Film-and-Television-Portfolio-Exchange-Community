(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const icon = (name) => `<i data-lucide="${name}"></i>`;
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
  const state = {
    page: "home",
    category: "全部",
    sort: "newest",
    forumCategory: "全部",
    forumQuery: "",
    forumPage: 1,
    replyPage: 1,
    topic: null,
    site: {
      name: "散场之后",
      english: "AFTER THE CREDITS",
      author: "小影",
      tagline: "把想表达的，留在画面里。",
      intro: "这里收录我的影像与创作。第一部作品，正在路上。",
      about: "这是我的个人作品集。\n\n作品尚在准备，完成之后会在这里陆续发布。",
      categories: ["影像作品", "摄影", "视觉设计", "其他创作"],
      hero: "assets/portfolio-hero.jpg",
      heroCredit: "创作之前 · 一束光，一个空镜头",
      email: "",
    },
    projects: [],
    online: false,
  };
  const main = $("#main");
  let routeVersion = 0;
  let requestVersion = 0;
  let toastTimer;
  function hydrate() {
    window.lucide?.createIcons({ attrs: { "aria-hidden": "true" } });
  }
  function title(text) {
    document.title = `${text || "个人作品集"} · ${state.site.name}`;
  }
  function toast(message) {
    clearTimeout(toastTimer);
    $("#toast").textContent = message;
    $("#toast").classList.add("visible");
    toastTimer = setTimeout(
      () => $("#toast").classList.remove("visible"),
      2800,
    );
  }
  function syncDialogs() {
    document.body.classList.toggle(
      "dialog-open",
      Boolean(document.querySelector("dialog[open]")),
    );
  }
  function showDialog(id) {
    const dialog = $(`#${id}`);
    if (!dialog.open) dialog.showModal();
    hydrate();
    syncDialogs();
  }
  function closeDialog(id) {
    if (
      id === "project-dialog" &&
      location.pathname.startsWith("/works/project/")
    ) {
      history.replaceState(
        null,
        "",
        state.page === "home" ? "/" : `/${state.page}`,
      );
      title(
        {
          home: "个人作品集",
          works: "作品集",
          forum: "自由论坛",
          about: "关于我",
        }[state.page],
      );
    }
    $(`#${id}`).close();
    syncDialogs();
  }
  async function api(url, body) {
    if (location.protocol === "file:") throw new Error("服务未启动");
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "请求未完成");
    return data;
  }
  function date(value) {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Shanghai",
    }).format(new Date(value));
  }
  function updateTheme() {
    const dark = document.body.classList.contains("dark");
    $("#theme-toggle").innerHTML = icon(dark ? "sun" : "moon");
    $("#theme-toggle").title = dark ? "切换浅色模式" : "切换深色模式";
    $("#theme-toggle").setAttribute("aria-label", $("#theme-toggle").title);
    hydrate();
  }
  try {
    document.body.classList.toggle(
      "dark",
      localStorage.getItem("after-credits-theme") === '"dark"',
    );
  } catch {}
  function branding() {
    document.querySelector(".brand-name").textContent = state.site.name;
    document.querySelector(".brand-caption").textContent = state.site.english;
    document
      .querySelector(".brand")
      .setAttribute("aria-label", `${state.site.name}，首页`);
    document.querySelector(".footer-brand").innerHTML =
      `${esc(state.site.name)}<span>${esc(state.site.english)}</span>`;
    document.querySelector(".footer-right>span").textContent =
      `© 2026 ${state.site.name}`;
    document.querySelector('meta[name="description"]').content =
      `${state.site.name} · ${state.site.intro}`;
  }
  function errorState(message, action = "retry-forum") {
    return `<div class="empty-state error-state">${icon("wifi-off")}<h2>${esc(message)}</h2><button class="button secondary" data-action="${action}">${icon("refresh-cw")}重新加载</button></div>`;
  }
  function emptyWorks(filtered = false) {
    return `<div class="portfolio-empty"><span class="empty-index">${filtered ? "-" : "00"}</span><div><div class="empty-label"><span class="dot"></span>${filtered ? "这一类作品，尚未发布" : "作品筹备中"}</div><h3>${filtered ? "故事还在继续。" : "第一部作品，正在路上。"}</h3><p>${filtered ? "此刻，还没有这个分类的作品。" : "留一些空白，给尚未完成的画面。"}</p>${filtered ? `<button class="text-link" data-category="全部">全部作品 ${icon("arrow-right")}</button>` : `<a class="text-link" href="/about">关于我 ${icon("arrow-up-right")}</a>`}</div><span class="empty-frame">${icon("clapperboard")}</span></div>`;
  }
  function projectCard(project, index) {
    return `<article class="project-card"><a class="project-cover" href="/works/project/${project.id}" aria-label="查看${esc(project.title)}"><img src="/${esc(project.cover)}" alt="${esc(project.title)}封面" loading="lazy"><span class="project-number">${String(index + 1).padStart(2, "0")}</span></a><div class="project-meta"><span>${esc(project.category)}</span><span>${esc(project.year)}</span></div><h3><a href="/works/project/${project.id}">${esc(project.title)}</a></h3><p>${esc(project.summary)}</p><a class="text-link" href="/works/project/${project.id}">查看作品 ${icon("arrow-up-right")}</a></article>`;
  }
  function home() {
    const featured = state.projects
      .filter((project) => project.featured)
      .slice(0, 4);
    const selected = featured.length ? featured : state.projects.slice(0, 4);
    return `<section class="hero" aria-labelledby="hero-title"><img class="hero-image" src="/${esc(state.site.hero)}" alt="影院里的银幕与座椅，作品集视觉背景" fetchpriority="high"><div class="container hero-inner"><div class="hero-topline"><span class="dot"></span> A PERSONAL CREATIVE PORTFOLIO</div><div class="hero-caption">${icon("clapperboard")} ${state.projects.length ? "SELECTED WORKS" : "IN THE MAKING"}</div><div class="hero-content"><p class="hero-kicker">BEFORE THE NEXT FRAME</p><h1 id="hero-title">${esc(state.site.name)}<span>${esc(state.site.tagline)}</span></h1><p class="hero-description">${esc(state.site.intro)}</p><a class="hero-button" href="/works">我的作品集 ${icon("arrow-up-right")}</a></div><div class="hero-credit"><strong>${esc(state.site.author)} / PERSONAL PORTFOLIO</strong>${esc(state.site.heroCredit)}</div></div></section>
      <section class="intro-strip"><div class="container intro-inner"><div class="intro-copy"><span class="intro-number">${String(state.projects.length).padStart(2, "0")}</span><div><p>${state.projects.length ? "每一件作品，都留下一点自己。" : "故事还未开始，创作已经在路上。"}</p><small>A WORK IN PROGRESS. A STORY TO COME.</small></div></div><span class="eyebrow">IMAGE · SOUND · IDEAS</span></div></section>
      <section class="container works-section"><div class="section-heading"><div><p class="eyebrow">SELECTED WORKS / 01</p><h2>我的作品<span class="accent">.</span></h2></div><a class="text-link" href="/works">全部作品 ${icon("arrow-up-right")}</a></div><div class="home-work-layout"><div>${selected.length ? `<div class="project-grid">${selected.map(projectCard).join("")}</div>` : emptyWorks()}</div><aside class="author-sidebar"><p class="eyebrow">BEHIND THE FRAMES</p><div class="author-top"><img src="/assets/avatar.jpg" alt="个人头像" width="52" height="52"><div><h3>${esc(state.site.author)}</h3><span>PERSONAL PORTFOLIO</span></div></div><p class="author-bio">影像与创作，未完待续。</p><a class="text-link" href="/about">关于我 ${icon("arrow-up-right")}</a><div class="sidebar-note"><span class="dot"></span><p>下一帧，<br>留给新的故事。</p></div></aside></div></section>
      <section class="closing-note">${icon("aperture")}<div><p>下一帧，留给新的故事。</p><span>A STORY STILL IN THE MAKING.</span></div></section>`;
  }
  function filterTabs(values, current, attribute, panel) {
    return `<div class="category-tabs" role="tablist" aria-label="分类">${values.map((value) => `<button class="category-tab ${value === current ? "active" : ""}" role="tab" tabindex="${value === current ? 0 : -1}" aria-selected="${value === current}" aria-controls="${panel}" data-${attribute}="${esc(value)}">${esc(value)}</button>`).join("")}</div>`;
  }
  function workListing() {
    const projects = state.projects.filter(
      (project) =>
        state.category === "全部" || project.category === state.category,
    );
    if (state.sort === "oldest") projects.reverse();
    return `<div class="filter-row">${filterTabs(["全部", ...state.site.categories], state.category, "category", "project-grid")}<select class="sort-select" id="project-sort" aria-label="作品排序"><option value="newest" ${state.sort === "newest" ? "selected" : ""}>最近更新</option><option value="oldest" ${state.sort === "oldest" ? "selected" : ""}>最早更新</option></select></div><div id="project-grid" role="tabpanel" aria-label="${esc(state.category)}">${projects.length ? `<div class="project-grid">${projects.map(projectCard).join("")}</div>` : emptyWorks(state.category !== "全部" && state.projects.length > 0)}</div>`;
  }
  function works() {
    return `<section class="container page-heading"><p class="eyebrow">THE PORTFOLIO / 01</p><h1>作品集<span class="accent">.</span></h1><div class="heading-bottom"><p>影像、摄影，以及那些想表达的。</p><span class="heading-total">${String(state.projects.length).padStart(2, "0")} PUBLISHED WORKS</span></div></section><section class="container works-page"><div id="work-listing">${workListing()}</div></section>`;
  }
  function forum() {
    return `<section class="container page-heading"><p class="eyebrow">AN OPEN CONVERSATION / 02</p><h1>自由论坛<span class="accent">.</span></h1><div class="heading-bottom"><p>不必署名，也可以表达。</p><button class="button" data-action="compose">${icon("square-pen")}发起话题</button></div></section><section class="container forum-page"><div class="filter-row forum-filters">${filterTabs(["全部", "交流", "反馈", "闲聊"], state.forumCategory, "forum-category", "topic-list")}<form id="forum-search" class="compact-search"><input type="search" name="query" value="${esc(state.forumQuery)}" placeholder="搜索话题" maxlength="100" aria-label="搜索话题"><button class="icon-button" type="submit" aria-label="搜索话题" title="搜索话题">${icon("search")}</button></form></div><div id="topic-list" aria-live="polite"><div class="loading-state">${icon("loader-circle")}正在读取话题</div></div></section>`;
  }
  function topicItem(topic) {
    return `<article class="topic-row"><div class="topic-mark">${icon(topic.pinned ? "pin" : "message-circle")}</div><div class="topic-summary"><div class="topic-tags"><span>${esc(topic.category)}</span>${topic.pinned ? '<span class="accent">置顶</span>' : ""}${topic.locked ? "<span>已关闭回复</span>" : ""}</div><h2><a href="/forum/topic/${topic.id}">${esc(topic.title)}</a></h2><p>${esc(topic.preview)}</p><div class="topic-meta">${esc(topic.nickname)}<span>·</span>${date(topic.created)}</div></div><a class="reply-count" href="/forum/topic/${topic.id}" aria-label="${topic.replyCount} 条回复">${icon("message-square")}<span>${topic.replyCount}</span></a></article>`;
  }
  function pagination(page, pages, attribute) {
    return pages > 1
      ? `<div class="pagination"><button class="icon-button" data-${attribute}="${page - 1}" ${page === 1 ? "disabled" : ""} aria-label="上一页" title="上一页">${icon("chevron-left")}</button><span>${page} / ${pages}</span><button class="icon-button" data-${attribute}="${page + 1}" ${page === pages ? "disabled" : ""} aria-label="下一页" title="下一页">${icon("chevron-right")}</button></div>`
      : "";
  }
  async function loadForum() {
    const version = ++requestVersion;
    try {
      const params = new URLSearchParams({
        page: state.forumPage,
        category: state.forumCategory,
        q: state.forumQuery,
      });
      const data = await api(`/api/forum?${params}`);
      if (
        version !== requestVersion ||
        state.page !== "forum" ||
        !$("#topic-list")
      )
        return;
      $("#topic-list").innerHTML = data.topics.length
        ? `<p class="result-count">${data.total} 个话题</p>${data.topics.map(topicItem).join("")}${pagination(data.page, data.pages, "forum-page")}`
        : `<div class="empty-state">${icon("messages-square")}<h2>${state.forumQuery ? "还没有找到这个话题" : "第一句，留给你。"}</h2><p>${state.forumQuery ? "换个关键词，或者开启新的话题。" : "这里暂时没有话题。"}</p><button class="button secondary" data-action="compose">${icon("square-pen")}发起话题</button></div>`;
    } catch (error) {
      if (version === requestVersion && $("#topic-list"))
        $("#topic-list").innerHTML = errorState(error.message);
    }
    hydrate();
  }
  function about() {
    return `<section class="about-page"><div class="about-layout"><div class="about-photo"><img class="about-portrait" src="/assets/avatar.jpg" alt="个人头像"><div class="portrait-caption"><span>BEHIND THE FRAMES.</span><span>01 / 01</span></div></div><div class="about-content"><p class="eyebrow">A PERSONAL CREATIVE SPACE.</p><h1>${esc(state.site.author)}<span>影像与创作，未完待续。</span></h1>${state.site.about
      .split(/\n\s*\n/)
      .map((paragraph) => `<p class="paragraph">${esc(paragraph)}</p>`)
      .join(
        "",
      )}<div class="about-signature">${esc(state.site.name)}<span class="accent"> / </span><small>A STORY STILL IN THE MAKING.</small></div>${state.site.email ? `<a class="text-link contact-link" href="mailto:${esc(state.site.email)}">${icon("mail")}${esc(state.site.email)}</a>` : ""}</div></div><div class="about-bottom"><p>下一帧，留给新的故事。</p><a class="button secondary" href="/works">我的作品集 ${icon("arrow-up-right")}</a></div></section>`;
  }
  function render() {
    main.innerHTML = ({ home, works, forum, about }[state.page] || home)();
    if (!state.online)
      main.insertAdjacentHTML(
        "afterbegin",
        `<div class="service-banner">${icon("wifi-off")}服务未启动。<a href="http://127.0.0.1:4173">打开本地服务</a></div>`,
      );
    document.querySelectorAll("[data-nav]").forEach((link) => {
      const active = link.dataset.nav === state.page;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    hydrate();
    if (state.page === "forum") loadForum();
  }
  function mediaView(media) {
    const caption = media.caption
      ? `<figcaption>${esc(media.caption)}</figcaption>`
      : "";
    if (media.kind === "video")
      return `<figure class="project-media"><video src="/${esc(media.src)}" controls playsinline preload="metadata" aria-label="${esc(media.name || "作品视频")}"></video>${caption}</figure>`;
    if (media.kind === "pdf")
      return `<a class="document-download" href="/${esc(media.src)}" download>${icon("file-text")}<span>${esc(media.name || "作品文档")}</span>${icon("download")}</a>`;
    return `<figure class="project-media"><a href="/${esc(media.src)}" target="_blank" rel="noopener"><img src="/${esc(media.src)}" alt="${esc(media.caption || media.name || "作品图片")}" loading="lazy"></a>${caption}</figure>`;
  }
  function openProject(id) {
    const project = state.projects.find((item) => item.id === id);
    if (!project) {
      navigate("/works", true);
      toast("这件作品尚未发布");
      return;
    }
    if ($("#search-dialog").open) closeDialog("search-dialog");
    $("#project-content").innerHTML =
      `<img class="project-detail-cover" src="/${esc(project.cover)}" alt="${esc(project.title)}封面"><article class="project-detail-body"><p class="eyebrow">${esc(project.category)} / ${esc(project.year)}</p><h1 id="project-title">${esc(project.title)}</h1>${project.role ? `<p class="project-role">创作分工 / ${esc(project.role)}</p>` : ""}<p class="project-intro">${esc(project.summary)}</p>${project.description ? `<div class="project-description paragraph">${esc(project.description)}</div>` : ""}<div class="project-media-list">${project.media.map(mediaView).join("")}</div>${project.externalUrl ? `<a class="button secondary" href="${esc(project.externalUrl)}" target="_blank" rel="noopener noreferrer">${icon("external-link")}查看外部作品</a>` : ""}</article>`;
    $("#project-dialog").scrollTop = 0;
    title(project.title);
    showDialog("project-dialog");
  }
  async function loadTopic(id, version = routeVersion) {
    state.topic = id;
    main.innerHTML = `<section class="container topic-page"><a class="text-link" href="/forum">${icon("arrow-left")}返回论坛</a><div id="topic-detail" aria-live="polite"><div class="loading-state">${icon("loader-circle")}正在读取话题</div></div></section>`;
    hydrate();
    try {
      const data = await api(`/api/forum/${id}?page=${state.replyPage}`);
      if (version !== routeVersion || state.topic !== id) return;
      title(data.topic.title);
      $("#topic-detail").innerHTML =
        `<article class="topic-article"><div class="topic-tags"><span>${esc(data.topic.category)}</span>${data.topic.pinned ? '<span class="accent">置顶</span>' : ""}</div><h1>${esc(data.topic.title)}</h1><div class="topic-meta">${esc(data.topic.nickname)}<span>·</span>${date(data.topic.created)}</div><p class="topic-body paragraph">${esc(data.topic.body)}</p></article><section class="reply-section"><div class="section-heading"><h2>回复<span class="reply-total">${data.topic.replyCount}</span></h2></div>${data.replies.length ? data.replies.map((reply, index) => `<article class="reply-row"><div class="reply-avatar">${icon("user-round")}</div><div><div class="reply-heading"><strong>${esc(reply.nickname)}</strong><span>${date(reply.created)} · #${(data.page - 1) * 30 + index + 1}</span></div><p class="paragraph">${esc(reply.body)}</p></div></article>`).join("") : '<p class="no-replies">还没有回复。</p>'}${pagination(data.page, data.pages, "reply-page")}${data.topic.locked ? '<p class="locked-note">这个话题已关闭回复。</p>' : `<form id="reply-form" class="reply-form"><div class="reply-form-heading"><h3>留一句话</h3><label class="nickname-label"><input name="nickname" maxlength="24" placeholder="昵称（选填）" aria-label="昵称，选填"></label></div><label><span class="sr-only">回复正文</span><textarea name="body" required maxlength="2000" rows="4" placeholder="说说你的想法…"></textarea></label><div class="honeypot" aria-hidden="true"><input name="website" tabindex="-1" autocomplete="off"></div><p class="form-error" role="alert"></p><div class="form-actions"><span class="form-note">不必署名，也可以表达。</span><button class="button" type="submit">${icon("send")}发布回复</button></div></form>`}</section>`;
    } catch (error) {
      if (version === routeVersion && $("#topic-detail"))
        $("#topic-detail").innerHTML = errorState(error.message, "retry-topic");
    }
    hydrate();
  }
  function search(query = "") {
    const normalized = query.trim().toLocaleLowerCase();
    const projects = state.projects.filter(
      (project) =>
        !normalized ||
        [project.title, project.summary, project.category, project.role]
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalized),
    );
    $("#search-results").innerHTML = projects.length
      ? `<p class="search-label">${projects.length} 件作品</p>${projects.map((project) => `<a class="search-result" href="/works/project/${project.id}"><img src="/${esc(project.cover)}" alt=""><span><strong>${esc(project.title)}</strong><small>${esc(project.category)} · ${esc(project.year)}</small></span>${icon("arrow-up-right")}</a>`).join("")}`
      : `<p class="search-empty">${state.projects.length ? `没有找到“${esc(query)}”` : "作品筹备中，暂时没有已发布作品。"}</p>`;
    hydrate();
  }
  function route() {
    const version = ++routeVersion;
    ++requestVersion;
    const parts = location.pathname.split("/").filter(Boolean);
    const page =
      parts[0] === "works" && parts[1] === "project"
        ? "project"
        : parts[0] === "forum" && parts[1] === "topic"
          ? "topic"
          : parts[0] || "home";
    const id = parts[2];
    $("#mobile-nav").hidden = true;
    $("#menu-toggle").setAttribute("aria-expanded", "false");
    $("#menu-toggle").setAttribute("aria-label", "展开导航");
    $("#menu-toggle").title = "展开导航";
    if (page === "project") {
      if (!main.innerHTML) {
        state.page = "works";
        render();
      }
      openProject(id);
      return;
    }
    document
      .querySelectorAll("dialog[open]")
      .forEach((dialog) => dialog.close());
    syncDialogs();
    state.topic = null;
    if (page === "topic") {
      state.page = "forum";
      state.replyPage = 1;
      document.querySelectorAll("[data-nav]").forEach((link) => {
        const active = link.dataset.nav === "forum";
        link.classList.toggle("active", active);
        if (active) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      });
      loadTopic(id, version);
    } else {
      state.page = ["home", "works", "forum", "about"].includes(page)
        ? page
        : "home";
      title(
        {
          home: "个人作品集",
          works: "作品集",
          forum: "自由论坛",
          about: "关于我",
        }[state.page],
      );
      render();
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function navigate(url, replace = false) {
    if (replace) history.replaceState(null, "", url);
    else history.pushState(null, "", url);
    route();
  }
  document.addEventListener("click", (event) => {
    const target = event.target.closest("button,a");
    if (!target) return;
    if (target.classList.contains("skip-link")) {
      event.preventDefault();
      main.focus();
      main.scrollIntoView();
      return;
    }
    if (
      target.tagName === "A" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      !event.altKey &&
      event.button === 0 &&
      !target.target
    ) {
      const link = new URL(target.href, location.href);
      if (
        link.origin === location.origin &&
        /^\/(works(?:\/project\/[a-f0-9-]+)?|forum(?:\/topic\/[a-f0-9-]+)?|about)?$/.test(
          link.pathname,
        )
      ) {
        event.preventDefault();
        navigate(link.pathname);
        return;
      }
    }
    if (target.dataset.close) closeDialog(target.dataset.close);
    if (target.dataset.category) {
      state.category = target.dataset.category;
      $("#work-listing").innerHTML = workListing();
      hydrate();
    }
    if (target.dataset.forumCategory) {
      state.forumCategory = target.dataset.forumCategory;
      state.forumPage = 1;
      render();
    }
    if (target.dataset.forumPage) {
      state.forumPage = Number(target.dataset.forumPage);
      loadForum();
      $("#topic-list").scrollIntoView({ block: "start" });
    }
    if (target.dataset.replyPage) {
      state.replyPage = Number(target.dataset.replyPage);
      loadTopic(state.topic);
    }
    if (target.dataset.action === "compose") {
      if (!state.online) {
        toast("请先启动服务");
        return;
      }
      $("#compose-form").reset();
      $("#compose-form .form-error").textContent = "";
      showDialog("compose-dialog");
    }
    if (target.dataset.action === "retry-forum") loadForum();
    if (target.dataset.action === "retry-topic") loadTopic(state.topic);
    if (target.id === "search-open") {
      $("#search-input").value = "";
      search();
      showDialog("search-dialog");
      $("#search-input").focus();
    }
    if (target.id === "theme-toggle") {
      document.body.classList.toggle("dark");
      try {
        localStorage.setItem(
          "after-credits-theme",
          JSON.stringify(
            document.body.classList.contains("dark") ? "dark" : "light",
          ),
        );
      } catch {}
      updateTheme();
    }
    if (target.id === "menu-toggle") {
      const open = $("#mobile-nav").hidden;
      $("#mobile-nav").hidden = !open;
      target.setAttribute("aria-expanded", String(open));
      target.setAttribute("aria-label", open ? "收起导航" : "展开导航");
      target.title = open ? "收起导航" : "展开导航";
    }
    if (target.id === "back-top")
      window.scrollTo({
        top: 0,
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
  });
  document.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!["compose-form", "reply-form", "forum-search"].includes(form.id))
      return;
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (form.id === "forum-search") {
      state.forumQuery = data.query.trim();
      state.forumPage = 1;
      loadForum();
      return;
    }
    const button = form.querySelector('[type="submit"]');
    const error = form.querySelector(".form-error");
    button.disabled = true;
    error.textContent = "";
    try {
      if (form.id === "compose-form") {
        const result = await api("/api/forum", data);
        closeDialog("compose-dialog");
        navigate(`/forum/topic/${result.topic.id}`);
        toast("话题已发布");
      } else {
        await api(`/api/forum/${state.topic}/replies`, data);
        const topic = await api(`/api/forum/${state.topic}`);
        state.replyPage = topic.pages;
        await loadTopic(state.topic);
        toast("回复已发布");
      }
    } catch (failure) {
      error.textContent = failure.message;
    } finally {
      button.disabled = false;
    }
  });
  main.addEventListener("change", (event) => {
    if (event.target.id === "project-sort") {
      state.sort = event.target.value;
      $("#work-listing").innerHTML = workListing();
      hydrate();
    }
  });
  main.addEventListener("keydown", (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
      return;
    event.preventDefault();
    const tabs = [...tab.parentElement.querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(tab);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
            tabs.length;
    const attribute = tabs[next].dataset.category
      ? "category"
      : "forum-category";
    const value =
      tabs[next].dataset.category || tabs[next].dataset.forumCategory;
    tabs[next].click();
    document
      .querySelector(`[data-${attribute}="${CSS.escape(value)}"]`)
      ?.focus();
  });
  $("#search-input").addEventListener("input", (event) =>
    search(event.target.value),
  );
  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      const bounds = dialog.getBoundingClientRect();
      if (
        event.target === dialog &&
        (event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom)
      )
        closeDialog(dialog.id);
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeDialog(dialog.id);
    });
    dialog.addEventListener("close", () => {
      dialog.querySelectorAll("video").forEach((video) => video.pause());
      syncDialogs();
    });
  });
  async function start() {
    try {
      const [site, projects] = await Promise.all([
        api("/api/site"),
        api("/api/projects"),
      ]);
      state.site = site;
      state.projects = projects.projects;
      state.online = true;
    } catch {}
    branding();
    route();
    updateTheme();
    window.addEventListener("popstate", route);
  }
  start();
})();
