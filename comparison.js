(() => {
  "use strict";
  const instances = new Map();
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

  function markup(pair) {
    if (!pair?.before || !pair.after) return "";
    const video = pair.before.kind === "video";
    const asset = (side, label) =>
      video
        ? `<video class="compare-media compare-${side}" src="/${esc(pair[side].src)}" preload="metadata" playsinline muted aria-label="${label}"></video>`
        : `<img class="compare-media compare-${side}" src="/${esc(pair[side].src)}" alt="${label}" draggable="false">`;
    return `<section class="color-comparison" data-comparison="${video ? "video" : "image"}" aria-label="调色前后对比"><div class="comparison-heading"><h2>${icon("sliders-horizontal")}调色对比</h2><div><button type="button" class="icon-button" data-compare-reset aria-label="分界线回到中间" title="分界线回到中间">${icon("split-square-horizontal")}</button><button type="button" class="icon-button" data-compare-fullscreen aria-label="全屏查看对比" title="全屏查看对比">${icon("maximize")}</button></div></div><div class="compare-stage">${asset("after", "调色后")}${asset("before", "调色前")}<div class="compare-labels" aria-hidden="true"><span>调色前</span><span>调色后</span></div><div class="compare-divider" aria-hidden="true"><span>${icon("chevrons-left-right")}</span></div><input class="compare-range" type="range" min="0" max="100" step="1" value="50" aria-label="调色前后对比分界位置" aria-valuetext="调色前 50%，调色后 50%"><div class="compare-status" role="status">正在加载素材</div></div>${video ? `<div class="compare-controls"><button type="button" class="icon-button" data-compare-play disabled aria-label="播放对比视频" title="播放对比视频">${icon("play")}</button><input class="compare-timeline" type="range" min="0" max="1" step="0.01" value="0" disabled aria-label="对比视频播放进度"><output class="compare-time">00:00 / 00:00</output><button type="button" class="icon-button" data-compare-mute aria-label="开启视频声音" title="开启视频声音">${icon("volume-x")}</button></div>` : ""}</section>`;
  }

  function create(element) {
    const stage = element.querySelector(".compare-stage");
    const range = element.querySelector(".compare-range");
    const before = element.querySelector(".compare-before");
    const after = element.querySelector(".compare-after");
    const status = element.querySelector(".compare-status");
    const video = element.dataset.comparison === "video";
    const controller = new AbortController();
    const { signal } = controller;
    const on = (target, type, handler, options = {}) =>
      target.addEventListener(type, handler, { ...options, signal });
    let alive = true;
    let ready = false;
    let playing = false;
    let starting = false;
    let buffering = false;
    let playVersion = 0;
    let dragging = null;
    let syncing = false;
    let resumeSeek = false;
    let frame = null;
    let frameKind;
    const playButton = element.querySelector("[data-compare-play]");
    const timeline = element.querySelector(".compare-timeline");
    const time = element.querySelector(".compare-time");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");

    function position(value) {
      const percent = Math.max(
        0,
        Math.min(100, Math.round(Number(value) || 0)),
      );
      range.value = String(percent);
      stage.style.setProperty("--compare-position", `${percent}%`);
      range.setAttribute(
        "aria-valuetext",
        `调色前 ${percent}%，调色后 ${100 - percent}%`,
      );
    }
    function drag(event) {
      const bounds = stage.getBoundingClientRect();
      position(((event.clientX - bounds.left) / bounds.width) * 100);
    }
    on(range, "input", () => position(range.value));
    on(stage, "pointerdown", (event) => {
      if (!ready || (event.pointerType === "mouse" && event.button !== 0))
        return;
      if (event.pointerType === "mouse") event.preventDefault();
      range.focus({ preventScroll: true });
      dragging = event.pointerId;
      stage.setPointerCapture(dragging);
      stage.classList.add("is-dragging");
      drag(event);
    });
    on(stage, "pointermove", (event) => {
      if (event.pointerId === dragging) drag(event);
    });
    const endDrag = () => {
      dragging = null;
      stage.classList.remove("is-dragging");
    };
    on(stage, "pointerup", endDrag);
    on(stage, "pointercancel", endDrag);
    on(stage, "lostpointercapture", endDrag);
    on(element.querySelector("[data-compare-reset]"), "click", () => {
      position(50);
      if (!reduced.matches)
        stage
          .querySelector(".compare-divider span")
          .animate([{ transform: "scale(0.92)" }, { transform: "scale(1)" }], {
            duration: 220,
          });
      range.focus({ preventScroll: true });
    });
    const fullscreenButton = element.querySelector("[data-compare-fullscreen]");
    if (!document.fullscreenEnabled || !element.requestFullscreen)
      fullscreenButton.hidden = true;
    on(fullscreenButton, "click", async () => {
      try {
        if (document.fullscreenElement === element)
          await document.exitFullscreen();
        else await element.requestFullscreen();
      } catch {
        showStatus("当前浏览器无法进入全屏");
      }
    });
    on(document, "fullscreenchange", () => {
      const fullscreen = document.fullscreenElement === element;
      fullscreenButton.title = fullscreen ? "退出全屏" : "全屏查看对比";
      fullscreenButton.setAttribute("aria-label", fullscreenButton.title);
      fullscreenButton.innerHTML = icon(fullscreen ? "minimize" : "maximize");
      window.lucide?.createIcons({ attrs: { "aria-hidden": "true" } });
    });
    function showStatus(message, failed = false) {
      status.textContent = message;
      status.hidden = false;
      element.classList.toggle("compare-failed", failed);
    }
    function checkReady() {
      if (!alive) return;
      const dimensions = (media) =>
        video
          ? [media.videoWidth, media.videoHeight]
          : [media.naturalWidth, media.naturalHeight];
      const [width, height] = dimensions(before);
      const [afterWidth, afterHeight] = dimensions(after);
      if (!width || !height || !afterWidth || !afterHeight) return;
      stage.style.aspectRatio = `${width} / ${height}`;
      if (Math.abs(width / height - afterWidth / afterHeight) > 0.01) {
        showStatus("调色前后画幅不一致", true);
        return;
      }
      if (
        video &&
        (!Number.isFinite(before.duration) ||
          !Number.isFinite(after.duration) ||
          Math.abs(before.duration - after.duration) > 0.15)
      ) {
        showStatus("调色前后视频时长不一致", true);
        return;
      }
      ready = true;
      status.hidden = true;
      element.classList.add("is-ready");
      if (video) {
        playButton.disabled = false;
        timeline.disabled = false;
        timeline.max = String(Math.min(before.duration, after.duration));
        updateTime();
      }
    }
    on(before, video ? "loadedmetadata" : "load", checkReady);
    on(after, video ? "loadedmetadata" : "load", checkReady);
    for (const media of [before, after])
      on(media, "error", () => {
        ready = false;
        if (video) {
          pause();
          playButton.disabled = true;
          timeline.disabled = true;
        }
        showStatus(
          video ? "视频无法播放，请检查文件编码" : "对比图片无法加载",
          true,
        );
      });
    checkReady();

    function stamp(seconds) {
      const whole = Math.floor(Number.isFinite(seconds) ? seconds : 0);
      return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
    }
    function updateTime() {
      if (!video) return;
      const duration = Number(timeline.max);
      timeline.value = String(Math.min(before.currentTime || 0, duration));
      timeline.setAttribute(
        "aria-valuetext",
        `${stamp(before.currentTime)} / ${stamp(duration)}`,
      );
      time.textContent = `${stamp(before.currentTime)} / ${stamp(duration)}`;
    }
    function updatePlay() {
      const active = playing || starting || buffering;
      playButton.innerHTML = icon(active ? "pause" : "play");
      playButton.title = active ? "暂停对比视频" : "播放对比视频";
      playButton.setAttribute("aria-label", playButton.title);
      window.lucide?.createIcons({ attrs: { "aria-hidden": "true" } });
    }
    function cancelFrame() {
      if (frame === null) return;
      if (frameKind === "video") before.cancelVideoFrameCallback(frame);
      else cancelAnimationFrame(frame);
      frame = null;
    }
    function syncFrame() {
      if (!alive || !playing) return;
      if (
        Math.abs(after.currentTime - before.currentTime) > 0.08 &&
        !after.seeking
      )
        after.currentTime = before.currentTime;
      if (before.currentTime >= Number(timeline.max) - 0.02) {
        pause();
        updateTime();
        return;
      }
      if (before.requestVideoFrameCallback) {
        frameKind = "video";
        frame = before.requestVideoFrameCallback(syncFrame);
      } else {
        frameKind = "animation";
        frame = requestAnimationFrame(syncFrame);
      }
    }
    function pause() {
      playVersion++;
      starting = false;
      playing = false;
      buffering = false;
      if (!video) return;
      before.pause();
      after.pause();
      cancelFrame();
      updatePlay();
    }
    async function play() {
      if (!ready || !alive || starting || playing) return;
      const version = ++playVersion;
      if (before.currentTime >= Number(timeline.max) - 0.04)
        before.currentTime = 0;
      if (Math.abs(after.currentTime - before.currentTime) > 0.03)
        after.currentTime = before.currentTime;
      before.muted = true;
      starting = true;
      updatePlay();
      try {
        await Promise.all([before.play(), after.play()]);
        if (!alive || version !== playVersion) return;
        starting = false;
        playing = true;
        status.hidden = true;
        syncFrame();
      } catch {
        if (alive && version === playVersion) {
          pause();
          showStatus("播放未能开始，请重试");
        }
      }
    }
    if (video) {
      on(playButton, "click", () => {
        if (playing || starting || buffering) pause();
        else play();
      });
      on(element.querySelector("[data-compare-mute]"), "click", (event) => {
        after.muted = !after.muted;
        const button = event.currentTarget;
        button.innerHTML = icon(after.muted ? "volume-x" : "volume-2");
        button.title = after.muted ? "开启视频声音" : "关闭视频声音";
        button.setAttribute("aria-label", button.title);
        window.lucide?.createIcons({ attrs: { "aria-hidden": "true" } });
      });
      on(timeline, "input", () => {
        const next = Number(timeline.value);
        if (!syncing) {
          resumeSeek = playing || starting || buffering;
          syncing = true;
          pause();
        }
        before.currentTime = next;
        after.currentTime = next;
        updateTime();
      });
      on(timeline, "change", () => {
        syncing = false;
        if (resumeSeek) play();
        resumeSeek = false;
      });
      on(before, "timeupdate", () => {
        if (!syncing) updateTime();
      });
      function resumeBuffer() {
        if (buffering && before.readyState >= 3 && after.readyState >= 3) {
          buffering = false;
          play();
        }
      }
      for (const media of [before, after]) {
        on(media, "ended", () => {
          pause();
          updateTime();
        });
        on(media, "waiting", () => {
          if (!playing && !starting) return;
          pause();
          buffering = true;
          updatePlay();
          showStatus("视频正在缓冲");
          resumeBuffer();
        });
        on(media, "canplay", resumeBuffer);
      }
      on(document, "visibilitychange", () => {
        if (document.hidden) pause();
      });
      const dialog = element.closest("dialog");
      if (dialog) on(dialog, "close", pause);
    }
    return () => {
      alive = false;
      pause();
      controller.abort();
      if (document.fullscreenElement === element)
        document.exitFullscreen().catch(() => {});
      instances.delete(element);
    };
  }
  function mount(root = document) {
    for (const [element, destroy] of instances)
      if (!element.isConnected) destroy();
    root.querySelectorAll("[data-comparison]").forEach((element) => {
      if (!instances.has(element)) instances.set(element, create(element));
    });
  }
  function dispose(root) {
    for (const [element, destroy] of instances)
      if (root === element || root.contains(element)) destroy();
  }
  window.PortfolioComparison = { markup, mount, dispose };
})();
