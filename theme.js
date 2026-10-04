(() => {
  "use strict";
  const root = document.documentElement;
  const key = "after-credits-theme";
  const systemTheme = matchMedia("(prefers-color-scheme: dark)");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let preference = null;
  let transition = null;
  let fadeTimer;

  function parsePreference(value) {
    try {
      value = JSON.parse(value);
    } catch {}
    return ["dark", "light"].includes(value) ? value : null;
  }
  try {
    preference = parsePreference(localStorage.getItem(key));
  } catch {}
  let theme = preference || (systemTheme.matches ? "dark" : "light");

  function renderTheme() {
    root.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "dark" ? "#141517" : "#f8f8f6";
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      const label = theme === "dark" ? "切换日间模式" : "切换夜间模式";
      button.title = label;
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-pressed", String(theme === "dark"));
    });
  }

  function setTheme(next, animate = false) {
    theme = next;
    transition?.skipTransition();
    transition = null;
    clearTimeout(fadeTimer);
    root.classList.remove("theme-fading");
    if (!animate || reducedMotion.matches) {
      renderTheme();
      return;
    }
    if (typeof document.startViewTransition === "function") {
      const active = document.startViewTransition(renderTheme);
      transition = active;
      active.ready.catch(() => {});
      active.finished
        .catch(() => {})
        .finally(() => {
          if (transition === active) transition = null;
        });
    } else {
      root.classList.add("theme-fading");
      // Establish the fallback transition before changing the color variables.
      getComputedStyle(root).backgroundColor;
      renderTheme();
      fadeTimer = setTimeout(() => root.classList.remove("theme-fading"), 500);
    }
  }

  renderTheme();
  document.addEventListener("DOMContentLoaded", renderTheme, { once: true });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-theme-toggle]")) return;
    preference = theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(key, JSON.stringify(preference));
    } catch {}
    setTheme(preference, true);
  });
  systemTheme.addEventListener("change", () => {
    if (!preference) setTheme(systemTheme.matches ? "dark" : "light", true);
  });
  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) setTheme(theme);
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== key && event.key !== null) return;
    preference = parsePreference(event.newValue);
    setTheme(preference || (systemTheme.matches ? "dark" : "light"), true);
  });
})();
