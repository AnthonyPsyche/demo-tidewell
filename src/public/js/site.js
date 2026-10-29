// Progressive enhancement only: the site is fully readable and usable without this file.
(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Mobile nav
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.getElementById("site-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      nav.classList.toggle("open", !open);
    });
    addEventListener("keydown", (e) => { if (e.key === "Escape") { toggle.setAttribute("aria-expanded", "false"); nav.classList.remove("open"); } });
  }

  // Reveal on scroll (+ SVG line-draw)
  const items = document.querySelectorAll(".reveal, .draw");
  if (!("IntersectionObserver" in window) || reduce) { items.forEach((el) => el.classList.add("in")); }
  else {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });
    items.forEach((el) => io.observe(el));
  }

  // Count-up: the final value is already in the HTML, so no-JS and reduced-motion users see it directly
  if (!reduce && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      const end = Number(e.target.dataset.count), t0 = performance.now(), dur = 1200;
      const tick = (t) => { const p = Math.min(1, (t - t0) / dur); e.target.textContent = Math.round(end * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }), { threshold: 0.6 });
    document.querySelectorAll("[data-count]").forEach((el) => io.observe(el));
  }
})();
