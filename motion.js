(() => {
  "use strict";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const seen = new WeakSet();
  const pending = new Set();
  const animations = new Set();
  const selector =
    ".section-heading, .portfolio-empty, .author-sidebar, .project-card, .closing-note, .page-heading, .topic-row, .reply-row, .topic-article, .about-photo, .about-content, .about-bottom, .color-comparison, .auth-shell, .admin-heading";
  let scheduled = false;
  let pageAnimation;
  function playClass(element, className) {
    if (!element || reduced.matches) return;
    element.classList.remove(className);
    cancelAnimationFrame(pageAnimation);
    pageAnimation = requestAnimationFrame(() => {
      element.classList.add(className);
      element.addEventListener(
        "animationend",
        () => element.classList.remove(className),
        { once: true },
      );
    });
  }
  const observer =
    "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              observer.unobserve(entry.target);
              pending.delete(entry.target);
              if (reduced.matches) continue;
              const repeated = entry.target.matches(
                ".project-card, .topic-row, .reply-row",
              );
              const index = repeated
                ? [...entry.target.parentElement.children].indexOf(entry.target)
                : 0;
              const animation = entry.target.animate(
                [
                  { opacity: 0, transform: "translateY(10px)" },
                  { opacity: 1, transform: "translateY(0)" },
                ],
                {
                  duration: 510,
                  delay: Math.min(index * 42, 126),
                  easing: "cubic-bezier(0.22, 1, 0.36, 1)",
                  fill: "both",
                },
              );
              animations.add(animation);
              animation.finished
                .catch(() => {})
                .finally(() => animations.delete(animation));
            }
          },
          { threshold: 0.08, rootMargin: "0px 0px -12px 0px" },
        )
      : null;
  function scan() {
    scheduled = false;
    for (const element of pending) {
      if (!element.isConnected) {
        observer.unobserve(element);
        pending.delete(element);
      }
    }
    document.querySelectorAll(selector).forEach((element) => {
      if (seen.has(element)) return;
      seen.add(element);
      if (!observer || reduced.matches) return;
      pending.add(element);
      observer.observe(element);
    });
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(scan);
  }
  window.PortfolioMotion = {
    page(element = document.querySelector("main")) {
      playClass(element, "motion-page-enter");
    },
    content(element) {
      playClass(element, "motion-content-enter");
    },
  };
  document.documentElement.classList.add("motion-ready");
  new MutationObserver(schedule).observe(document.body, {
    childList: true,
    subtree: true,
  });
  reduced.addEventListener("change", () => {
    if (reduced.matches) {
      for (const animation of animations) animation.cancel();
      for (const element of pending) observer.unobserve(element);
      pending.clear();
      return;
    }
    scan();
  });
  scan();
})();
