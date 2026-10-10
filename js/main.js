/* MGS site-wide interactions: navigation, reveal effects and contact email draft. */
document.addEventListener("DOMContentLoaded", () => {
  const header = document.querySelector(".site-header");
  const menuToggle = document.querySelector(".menu-toggle");
  const navLinks = document.querySelector(".nav-links");
  const currentPage = window.location.pathname.split("/").pop() || "index.html";

  /* The header reflects the local demo session: signed-out visitors get a
     Sign in link; only a signed-in local demo profile sees My account. */
  const refreshAccountLink = () => {
    const accountLink = document.querySelector("[data-header-account]");
    if (!accountLink) return;
    let session = null;
    try { session = JSON.parse(localStorage.getItem("mgs-demo-session-v1") || "null"); } catch (_) { session = null; }
    accountLink.textContent = session && session.email ? "My account" : "Sign in";
    accountLink.href = session && session.email ? "account.html" : "login.html";
    accountLink.setAttribute("aria-label", session && session.email ? "My account" : "Sign in to your account");
  };
  refreshAccountLink();
  document.addEventListener("mgs:session-changed", refreshAccountLink);
  window.addEventListener("storage", refreshAccountLink);

  const closeMenu = () => {
    navLinks?.classList.remove("open");
    document.body.classList.remove("menu-open");
    menuToggle?.setAttribute("aria-expanded", "false");
    if (menuToggle) menuToggle.textContent = "☰";
  };

  const updateHeader = () => header?.classList.toggle("scrolled", window.scrollY > 16);
  window.addEventListener("scroll", updateHeader, { passive: true });
  updateHeader();

  menuToggle?.addEventListener("click", () => {
    const isOpen = navLinks?.classList.toggle("open");
    document.body.classList.toggle("menu-open", Boolean(isOpen));
    menuToggle.setAttribute("aria-expanded", String(Boolean(isOpen)));
    menuToggle.textContent = isOpen ? "×" : "☰";
  });

  navLinks?.querySelectorAll("a").forEach((link) => {
    link.classList.toggle("active", link.getAttribute("href") === currentPage);
    link.addEventListener("click", closeMenu);
  });

  /* Reveal sections as they enter the viewport. */
  if ("IntersectionObserver" in window) {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12 });
    document.querySelectorAll(".reveal-section, .card, .solution-card, .sector-card, .metric-card").forEach((element) => {
      element.classList.add("reveal-item");
      revealObserver.observe(element);
    });
  } else {
    document.querySelectorAll(".reveal-section, .card, .solution-card, .sector-card, .metric-card").forEach((element) => element.classList.add("is-visible"));
  }

  /* The contact form prepares an email draft rather than falsely saying
     an inquiry was received by a server that has not been connected yet. */
  const form = document.querySelector("#contact-form");
  const formStatus = form?.querySelector(".form-status");
  form?.querySelectorAll("input, textarea, select").forEach((field) => {
    field.addEventListener("blur", () => field.classList.toggle("invalid", !field.checkValidity()));
    field.addEventListener("input", () => { if (field.checkValidity()) field.classList.remove("invalid"); });
  });

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const fields = [...form.querySelectorAll("input, textarea, select")];
    const valid = fields.every((field) => {
      field.classList.toggle("invalid", !field.checkValidity());
      return field.checkValidity();
    });
    if (!valid) {
      if (formStatus) formStatus.textContent = "Please review the highlighted fields.";
      return;
    }

    const data = Object.fromEntries(new FormData(form).entries());
    const body = [
      `Name: ${data.name || ""}`,
      `Email: ${data.email || ""}`,
      `Subject: ${data.subject || ""}`,
      "",
      String(data.message || "")
    ].join("\n");
    const mailto = `mailto:info@mercuryglobalsystems.com?subject=${encodeURIComponent(data.subject || "MGS website enquiry")}&body=${encodeURIComponent(body)}`;
    if (formStatus) {
      formStatus.innerHTML = `Your email app can send this enquiry to MGS. <a href="${mailto}">Open email draft</a>. This website has not sent it to a server.`;
    }
  });
});
