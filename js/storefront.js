/* ================================================================
   MGS STOREFRONT INTERACTIONS
   ----------------------------------------------------------------
   This is intentionally plain JavaScript so the MGS team can edit it.
   All localStorage behaviour is for browser testing only. It is not a
   replacement for secure server-side accounts, orders or payment APIs.
   ================================================================ */
(() => {
  "use strict";

  let backendOnline = false;
  let backendUser = null;
  let backendCsrfToken = "";
  let backendOrders = [];
  let backendCustomers = [];
  let backendInitPromise = Promise.resolve();

  const apiRequest = async (action, options = {}) => {
    const method = options.method || "GET";
    const headers = { "Accept": "application/json" };
    const request = { method, headers, credentials: "same-origin" };
    if (method !== "GET") {
      headers["Content-Type"] = "application/json";
      if (backendCsrfToken) headers["X-CSRF-Token"] = backendCsrfToken;
      request.body = JSON.stringify(options.body || {});
    }
    const response = await fetch(`api/index.php?action=${encodeURIComponent(action)}`, request);
    let data;
    try { data = await response.json(); }
    catch (_) { throw new Error("The MGS API response was not valid JSON."); }
    if (data.csrfToken) backendCsrfToken = data.csrfToken;
    if (!response.ok || data.ok === false) throw new Error(data.error || "The MGS server could not complete this request.");
    return data;
  };

  async function initializeBackend() {
    try {
      const currentPage = window.location.pathname.split("/").pop() || "index.html";
      const protectedAdminPage = ["admin.html", "admin-product.html"].includes(currentPage);
      const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
      const bootstrap = await apiRequest("bootstrap");
      if (!bootstrap.backendReady) {
        if (!isLocalHost) {
          /* Never present browser-only accounts as real customer accounts on a public website. */
          localStorage.removeItem(KEYS.session);
          document.dispatchEvent(new CustomEvent("mgs:session-changed"));
          document.querySelectorAll("[data-auth-mode-note]").forEach((el) => {
            el.textContent = "Secure customer accounts are not enabled on this website yet. No account details will be saved until the MGS server is configured.";
          });
          document.querySelectorAll("[data-account-mode-notice]").forEach((el) => {
            el.textContent = "Customer accounts and order history will be available when MGS enables the server database.";
          });
          if (protectedAdminPage) { window.location.href = "login.html?next=admin.html"; return false; }
        }
        return true;
      }
      backendOnline = true;
      backendUser = bootstrap.user || null;
      if (backendUser) safeWrite("mgs-demo-session-v1", { name: backendUser.name, email: backendUser.email, role: backendUser.role, since: new Date().toISOString() });
      else localStorage.removeItem("mgs-demo-session-v1");
      document.dispatchEvent(new CustomEvent("mgs:session-changed"));

      if (protectedAdminPage && (!backendUser || backendUser.role !== "admin")) {
        window.location.href = "login.html?next=admin.html";
        return false;
      }
      const catalogue = await apiRequest(protectedAdminPage ? "admin-products" : "products");
      window.MGS_CATALOG = catalogue.products || [];
      const settings = await apiRequest("site-settings");
      if (settings.settings) safeWrite(KEYS.settings, settings.settings);
      document.querySelectorAll("[data-auth-mode-note]").forEach((el) => { el.textContent = "Your account is stored on the MGS server. Keep your password private."; });
      document.querySelectorAll("[data-account-mode-notice]").forEach((el) => { el.textContent = "Account and order data are loaded from the MGS server when you sign in."; });
      const adminNotice = document.querySelector("[data-admin-security-notice]");
      if (adminNotice) adminNotice.textContent = "Administrator access is verified by the MGS server. Product and settings edits are saved to the connected database.";
      return true;
    } catch (error) {
      /* Missing PHP/config/database means use local preview only on localhost.
         On a public host, do not expose the browser-only admin surface. */
      backendOnline = false;
      const currentPage = window.location.pathname.split("/").pop() || "index.html";
      const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
      if (!isLocalHost) {
        localStorage.removeItem(KEYS.session);
        document.dispatchEvent(new CustomEvent("mgs:session-changed"));
        document.querySelectorAll("[data-auth-mode-note]").forEach((el) => {
          el.textContent = "Secure customer accounts are not enabled on this website yet. No account details will be saved until the MGS server is configured.";
        });
        document.querySelectorAll("[data-account-mode-notice]").forEach((el) => {
          el.textContent = "Customer accounts and order history will be available when MGS enables the server database.";
        });
        if (["admin.html", "admin-product.html"].includes(currentPage)) {
          window.location.href = "login.html?next=admin.html";
          return false;
        }
      }
      return true;
    }
  }

  const KEYS = {
    catalogue: "mgs-catalogue-overrides-v1",
    cart: "mgs-basket-v1",
    orders: "mgs-local-orders-v1",
    users: "mgs-demo-users-v1",
    session: "mgs-demo-session-v1",
    currency: "mgs-display-currency-v1",
    newProducts: "mgs-new-products-v1",
    settings: "mgs-site-settings-v1"
  };

  const safeRead = (key, fallback) => {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      return fallback;
    }
  };
  const safeWrite = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  };
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));

  const catalogueOverrides = () => safeRead(KEYS.catalogue, {});
  const productYear = (product) => {
    const title = String(product.title || "");
    const year = title.match(/20\d{2}/);
    if (year) return Number(year[0]);
    if (/\bwin(?:dows)?\s*11\b/i.test(title)) return 2021;
    if (/\b(?:office\s*24|24hb)\b/i.test(title)) return 2024;
    return 9999;
  };
  const productCapacityGB = (product) => {
    const text = `${product.id || ""} ${product.title || ""}`;
    const match = text.match(/(\d+(?:\.\d+)?)\s*(TB|GB)\b/i);
    if (!match) return Number.MAX_SAFE_INTEGER;
    return Number(match[1]) * (match[2].toUpperCase() === "TB" ? 1024 : 1);
  };
  const sortProducts = (items) => [...items].sort((a, b) => {
    const catA = a.category === "software" ? 0 : 1;
    const catB = b.category === "software" ? 0 : 1;
    if (catA !== catB) return catA - catB;
    if (catA === 0) {
      const yearA = productYear(a), yearB = productYear(b);
      if (yearA !== yearB) return yearA - yearB;
      return String(a.title || "").localeCompare(String(b.title || ""), undefined, { numeric: true, sensitivity: "base" });
    }
    const family = (p) => /sata|2\.5.?inch/i.test(`${p.id} ${p.title} ${p.group || ""}`) ? 0 : /nvme|m\.2|2280/i.test(`${p.id} ${p.title} ${p.group || ""}`) ? 1 : 2;
    const familyA = family(a), familyB = family(b);
    if (familyA !== familyB) return familyA - familyB;
    const sizeA = productCapacityGB(a), sizeB = productCapacityGB(b);
    if (sizeA !== sizeB) return sizeA - sizeB;
    return String(a.title || "").localeCompare(String(b.title || ""), undefined, { numeric: true, sensitivity: "base" });
  });
  const getProducts = () => {
    const overrides = backendOnline ? {} : catalogueOverrides();
    const addedProducts = backendOnline ? [] : safeRead(KEYS.newProducts, []);
    /* Original catalogue + items added in local preview; sort years and capacities ascending by default. */
    const merged = [...(window.MGS_CATALOG || []), ...addedProducts].map((product) => {
      const override = overrides[product.id] || {};
      return {
        ...product,
        ...override,
        baseTitle: product.title,
        priceEUR: Object.prototype.hasOwnProperty.call(override, "priceEUR") ? override.priceEUR : (product.priceEUR ?? null),
        priceINR: Object.prototype.hasOwnProperty.call(override, "priceINR") ? override.priceINR : (product.priceINR ?? null),
        active: Object.prototype.hasOwnProperty.call(override, "active") ? override.active : product.active
      };
    });
    return sortProducts(merged);
  };
  const findProduct = (id) => getProducts().find((product) => product.id === id);
  const getCurrency = () => localStorage.getItem(KEYS.currency) || "EUR";
  const priceFor = (product, currency = getCurrency()) => {
    const raw = currency === "INR" ? product?.priceINR : product?.priceEUR;
    return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null;
  };
  const money = (amount, currency = getCurrency()) => {
    if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) return "Price on request";
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-IE", {
      style: "currency", currency, maximumFractionDigits: 2
    }).format(Number(amount));
  };
  const currentCart = () => safeRead(KEYS.cart, []);
  const saveCart = (cart) => {
    safeWrite(KEYS.cart, cart.filter((item) => Number(item.quantity) > 0));
    updateCartCounts();
    document.dispatchEvent(new CustomEvent("mgs:cart-updated"));
  };
  const cartProducts = () => currentCart().map((line) => {
    const product = findProduct(line.id);
    return product ? { ...product, quantity: Math.max(1, Number(line.quantity) || 1) } : null;
  }).filter(Boolean);
  const getOrders = () => safeRead(KEYS.orders, []);
  const saveOrders = (orders) => safeWrite(KEYS.orders, orders);
  const getSession = () => safeRead(KEYS.session, null);

  function priceLabel(product, currency = getCurrency()) {
    const amount = priceFor(product, currency);
    return amount === null ? "Price on request" : money(amount, currency);
  }
  function basketQuantity() {
    return currentCart().reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0), 0);
  }
  function updateCartCounts() {
    document.querySelectorAll("[data-cart-count]").forEach((badge) => {
      badge.textContent = String(basketQuantity());
    });
  }

  function addToCart(id) {
    const product = findProduct(id);
    if (!product || product.active === false) return;
    const cart = currentCart();
    const line = cart.find((item) => item.id === id);
    if (line) line.quantity = Math.min(99, Math.max(1, Number(line.quantity) || 1) + 1);
    else cart.push({ id, quantity: 1 });
    saveCart(cart);
    const notice = document.querySelector("[data-live-notice]");
    if (notice) notice.textContent = `${product.title} added to your basket.`;
    const button = document.querySelector(`[data-add-cart="${CSS.escape(id)}"]`);
    if (button) {
      const oldText = button.textContent;
      button.textContent = "Added ✓";
      button.classList.add("is-added");
      window.setTimeout(() => { button.textContent = oldText; button.classList.remove("is-added"); }, 1200);
    }
  }

  function fallbackImage(product) {
    const title = String(product.title || "");
    if (product.category === "software" && /office/i.test(title)) return "assets/images/products/office-professional-plus-2024.jpg";
    if (product.category === "software") return "assets/images/products/windows-11-pro-usb-kit.jpg";
    if (/sata|2\.5.?inch/i.test(`${product.id} ${title}`)) return "assets/images/products/sata-ssd-studio.jpg";
    return "assets/images/products/mgs-m2-studio.jpg";
  }
  function productCard(product) {
    return `<article class="product-card" data-product data-product-id="${escapeHtml(product.id)}" data-category="${escapeHtml(product.category)}">
      <a class="product-card-open" href="product.html?id=${encodeURIComponent(product.id)}" aria-label="View ${escapeHtml(product.title)} details">
        <div class="product-visual"><img src="${escapeHtml(product.image)}" data-image-fallback="${escapeHtml(fallbackImage(product))}" alt="Product image for ${escapeHtml(product.title)}" loading="lazy"><span class="product-badge">${escapeHtml(product.badge || product.group)}</span></div>
        <div class="product-copy"><span class="product-kicker">${escapeHtml(product.group)}</span><span class="product-title-button">${escapeHtml(product.title)}</span><p class="product-short">${escapeHtml(product.short)}</p><strong class="product-price ${priceFor(product) === null ? 'product-price--quote' : ''}" data-price-for="${escapeHtml(product.id)}">${escapeHtml(priceLabel(product))}</strong></div>
      </a><div class="product-card-actions"><a class="btn btn-light" href="product.html?id=${encodeURIComponent(product.id)}">View product</a><button class="btn btn-blue" type="button" data-add-cart="${escapeHtml(product.id)}">Add to basket</button></div>
    </article>`;
  }

  function renderShop() {
    if (!document.querySelector("[data-grid]")) return;
    const pageCategory = document.body.dataset.shopCategory || "all";
    const products = getProducts().filter((product) => product.active !== false);
    const query = (document.querySelector("[data-shop-search]")?.value || "").trim().toLowerCase();
    const matches = products.filter((product) => (pageCategory === "all" || product.category === pageCategory) && [product.title, product.short, product.description, product.category, product.badge].join(" ").toLowerCase().includes(query));
    const licenses = matches.filter((product) => product.category === "software");
    const storage = matches.filter((product) => product.category !== "software");
    const sata = storage.filter((product) => /sata|2\.5.?inch/i.test(`${product.id} ${product.title} ${product.group}`));
    const nvme = storage.filter((product) => /nvme|m\.2|2280/i.test(`${product.id} ${product.title} ${product.group}`) && !sata.includes(product));
    const classified = new Set([...sata, ...nvme].map((product) => product.id));
    const otherStorage = storage.filter((product) => !classified.has(product.id));
    const softwareGrid = document.getElementById("software-grid");
    const sataGrid = document.getElementById("sata-grid");
    const nvmeGrid = document.getElementById("nvme-grid");
    const otherGrid = document.getElementById("other-storage-grid");
    const otherHeading = document.getElementById("other-storage-heading");
    if (softwareGrid) softwareGrid.innerHTML = licenses.length ? licenses.map(productCard).join("") : emptyMarkup("No matching licences", "Try a different search term.");
    if (sataGrid) sataGrid.innerHTML = sata.length ? sata.map(productCard).join("") : emptyMarkup("No matching SATA SSDs", "Try another capacity or search term.");
    if (nvmeGrid) nvmeGrid.innerHTML = nvme.length ? nvme.map(productCard).join("") : emptyMarkup("No matching M.2 NVMe SSDs", "Try another capacity or search term.");
    if (otherGrid) otherGrid.innerHTML = otherStorage.length ? otherStorage.map(productCard).join("") : "";
    if (otherHeading) otherHeading.hidden = otherStorage.length === 0;
    const sc = document.querySelector("[data-count-software]");
    const st = document.querySelector("[data-count-storage]");
    if (sc) sc.textContent = `${licenses.length} products`;
    if (st) st.textContent = `${storage.length} options`;
  }

  function emptyMarkup(title, copy) {
    return `<div class="empty-state"><div class="empty-icon">⌕</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(copy)}</p></div>`;
  }

  function openProductModal(id) {
    const product = findProduct(id);
    const wrapper = document.querySelector("[data-product-modal]");
    const target = document.querySelector("[data-modal-content]");
    if (!product || !wrapper || !target) return;
    const details = (product.highlights || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    target.innerHTML = `<div class="modal-product-layout"><div class="modal-product-image"><img src="${escapeHtml(product.image)}" data-image-fallback="${escapeHtml(fallbackImage(product))}" alt="Product image for ${escapeHtml(product.title)}"></div><div class="modal-product-content"><span class="eyebrow">${escapeHtml(product.group)} · ${escapeHtml(product.badge || "Product")}</span><h2 id="modal-title">${escapeHtml(product.title)}</h2><strong class="product-price ${priceFor(product) === null ? 'product-price--quote' : ''}">${escapeHtml(priceLabel(product))}</strong><p>${escapeHtml(product.description)}</p><ul class="detail-list">${details}</ul><div class="license-note"><strong>${product.category === 'software' ? 'Licence / activation note: ' : 'Compatibility / specification note: '}</strong>${escapeHtml(product.licenseNote)}</div><p class="muted-small">The image is representative and may not show the exact brand packaging or model. Exact SKU, product contents and applicable terms should be confirmed before order acceptance.</p><button class="btn btn-blue btn-block" type="button" data-modal-add="${escapeHtml(product.id)}">Add to basket</button></div></div>`;
    wrapper.hidden = false;
    document.body.classList.add("modal-open");
    wrapper.querySelector("[data-modal-close]")?.focus();
  }

  function renderProductDetailPage() {
    const target = document.querySelector("[data-product-detail]");
    if (!target) return;
    const id = new URLSearchParams(window.location.search).get("id");
    const product = findProduct(id);
    if (!product || product.active === false) {
      target.innerHTML = `<div class="product-not-found"><span class="eyebrow">Product not found</span><h1>This product is unavailable.</h1><p>Please return to the catalogue to browse available products.</p><a class="btn btn-blue" href="shop.html">Back to shop</a></div>`;
      return;
    }
    document.title = `${product.title} | Mercury Global Systems`;
    const details = (product.highlights || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    const eligibleRelated = sortProducts(getProducts().filter((item) => item.active !== false && item.id !== product.id && item.category === product.category));
    const familyKey = (item) => /sata|2\.5.?inch/i.test(`${item.id} ${item.title} ${item.group || ""}`) ? "sata" : /nvme|m\.2|2280/i.test(`${item.id} ${item.title} ${item.group || ""}`) ? "nvme" : item.category;
    const sameFamily = eligibleRelated.filter((item) => familyKey(item) === familyKey(product));
    const related = [...sameFamily, ...eligibleRelated.filter((item) => familyKey(item) !== familyKey(product))].slice(0, 4);
    const relatedMarkup = related.length ? `<section class="related-products" aria-labelledby="related-products-title"><div class="related-products-heading"><div><span class="eyebrow">Keep exploring</span><h2 id="related-products-title">Related products</h2></div><a href="${product.category === 'software' ? 'licenses.html' : 'storage.html'}">View all ${product.category === 'software' ? 'licenses' : 'storage'} <span aria-hidden="true">↗</span></a></div><div class="related-product-grid">${related.map(productCard).join("")}</div></section>` : "";
    target.innerHTML = `<div class="product-detail-layout"><div class="product-detail-visual"><img src="${escapeHtml(product.image)}" data-image-fallback="${escapeHtml(fallbackImage(product))}" alt="${escapeHtml(product.title)} product image"><span class="product-detail-caption">${escapeHtml(product.group)}</span></div><div class="product-detail-copy"><div class="breadcrumb"><a href="index.html">Home</a><span>/</span><a href="shop.html">Shop</a><span>/</span><span>${escapeHtml(product.title)}</span></div><span class="eyebrow">${escapeHtml(product.group)} · ${escapeHtml(product.badge || "Product")}</span><h1>${escapeHtml(product.title)}</h1><p class="product-detail-short">${escapeHtml(product.short)}</p><strong class="product-detail-price ${priceFor(product) === null ? 'product-price--quote' : ''}">${escapeHtml(priceLabel(product))}</strong><p class="product-detail-description">${escapeHtml(product.description)}</p><h2>Product highlights</h2><ul class="detail-list">${details}</ul><div class="license-note"><strong>${product.category === 'software' ? 'Licence / activation note: ' : 'Compatibility / specification note: '}</strong>${escapeHtml(product.licenseNote || 'Confirm exact specifications and supplied terms before purchase.')}</div><p class="muted-small">Product imagery is representative. Confirm the exact SKU, package contents and applicable terms before order acceptance.</p><div class="product-detail-actions"><button class="btn btn-blue" type="button" data-add-cart="${escapeHtml(product.id)}">Add to basket</button><a class="btn btn-light" href="contact.html">Request a quote</a></div><a class="back-to-shop" href="${product.category === 'software' ? 'licenses.html' : 'storage.html'}">← Browse ${product.category === 'software' ? 'Microsoft Licenses' : 'Storage'}</a></div></div>${relatedMarkup}`;
  }

  function closeProductModal() {
    const wrapper = document.querySelector("[data-product-modal]");
    if (!wrapper) return;
    wrapper.hidden = true;
    document.body.classList.remove("modal-open");
  }

  function cartTotal(items = cartProducts(), currency = getCurrency()) {
    let total = 0;
    let missingPrice = false;
    items.forEach((item) => {
      const amount = priceFor(item, currency);
      if (amount === null) missingPrice = true;
      else total += amount * item.quantity;
    });
    return { total, missingPrice };
  }

  function renderSummary(target) {
    if (!target) return;
    const items = cartProducts();
    if (!items.length) {
      target.innerHTML = '<div class="empty-state"><div class="empty-icon">▢</div><h3>Your basket is empty</h3><p>Browse the catalogue and add the products you want to enquire about.</p><a class="btn btn-blue btn-block" href="shop.html">Browse the shop</a></div>';
      return;
    }
    const result = cartTotal(items);
    const count = items.reduce((sum, item) => sum + item.quantity, 0);
    target.innerHTML = `<div class="summary-line"><span>Items</span><strong>${count}</strong></div><div class="summary-line"><span>Price status</span><strong>${result.missingPrice ? 'Quote required' : 'Prices configured'}</strong></div><div class="summary-line summary-total"><span>Subtotal</span><strong>${result.missingPrice ? 'Confirmed quote required' : escapeHtml(money(result.total))}</strong></div><p class="muted-small">Shipping, taxes and final payment details are confirmed by MGS on the written offer.</p>`;
  }

  function renderCart() {
    const target = document.querySelector("[data-cart-items]");
    if (!target) return;
    const items = cartProducts();
    if (!items.length) {
      target.innerHTML = emptyMarkup("Your basket is empty", "Choose software or storage products from the catalogue.") + '<p><a class="btn btn-blue" href="shop.html">Browse products</a></p>';
      renderSummary(document.querySelector("[data-cart-summary]"));
      const checkoutLink = document.querySelector("[data-checkout-link]");
      if (checkoutLink) { checkoutLink.classList.add("is-disabled"); checkoutLink.setAttribute("aria-disabled", "true"); checkoutLink.href = "shop.html"; checkoutLink.textContent = "Browse products"; }
      return;
    }
    target.innerHTML = items.map((item) => `<article class="cart-row"><div class="cart-row-image"><img src="${escapeHtml(item.image)}" alt="" loading="lazy"></div><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.badge || item.group)}</p><div class="cart-row-price">${escapeHtml(priceLabel(item))}</div><button class="remove-button" type="button" data-cart-remove="${escapeHtml(item.id)}">Remove</button></div><div class="cart-controls"><button class="qty-button" type="button" data-qty-change="-1" data-qty-id="${escapeHtml(item.id)}" aria-label="Reduce quantity">−</button><span class="qty-value">${item.quantity}</span><button class="qty-button" type="button" data-qty-change="1" data-qty-id="${escapeHtml(item.id)}" aria-label="Increase quantity">+</button></div></article>`).join("");
    renderSummary(document.querySelector("[data-cart-summary]"));
    const checkoutLink = document.querySelector("[data-checkout-link]");
    if (checkoutLink) { checkoutLink.classList.remove("is-disabled"); checkoutLink.removeAttribute("aria-disabled"); checkoutLink.href = "checkout.html"; checkoutLink.textContent = "Continue to checkout"; }
  }

  function renderCheckoutSummary() {
    const target = document.querySelector("[data-checkout-summary]");
    if (!target) return;
    const items = cartProducts();
    if (!items.length) {
      target.innerHTML = emptyMarkup("Your basket is empty", "Add products before sending an enquiry.") + '<a class="btn btn-blue btn-block" href="shop.html">Browse products</a>';
      const form = document.querySelector("[data-checkout-form]");
      if (form) form.querySelector("button[type=submit]").disabled = true;
      return;
    }
    const result = cartTotal(items);
    target.innerHTML = items.map((item) => `<div class="summary-line"><span>${escapeHtml(item.title)} × ${item.quantity}</span><strong>${escapeHtml(priceFor(item) === null ? 'Quote required' : money(priceFor(item) * item.quantity))}</strong></div>`).join("") + `<div class="summary-line summary-total"><span>Subtotal</span><strong>${result.missingPrice ? 'Confirmed quote required' : escapeHtml(money(result.total))}</strong></div><p class="muted-small">${result.missingPrice ? 'At least one item has no confirmed price yet.' : 'Prices shown are local catalogue values only until confirmed by MGS.'}</p>`;
  }

  function buildMailto(order) {
    const lines = [
      `Hello MGS,`, ``, `Please review my product enquiry ${order.id}.`, ``,
      `Name: ${order.customer.name}`, `Email: ${order.customer.email}`,
      `Company: ${order.customer.company || 'Not supplied'}`, `Telephone: ${order.customer.phone || 'Not supplied'}`,
      `Delivery/billing address or country: ${order.customer.address}`, `Preferred payment arrangement: ${order.customer.paymentPreference || 'Discuss with MGS'}`, ``, `Products:`,
      ...order.items.map((item) => `- ${item.title} x ${item.quantity} — ${item.priceLabel}`),
      ``, `Subtotal: ${order.subtotalLabel}`, `Order notes: ${order.customer.notes || 'None'}`, ``,
      `Please confirm the exact SKU, licence/specification, final price, applicable taxes, delivery and payment terms.`, ``, `Regards,`, order.customer.name
    ];
    return `mailto:info@mercuryglobalsystems.com?subject=${encodeURIComponent('MGS Product Enquiry ' + order.id)}&body=${encodeURIComponent(lines.join('\n'))}`;
  }

  async function handleCheckout(event) {
    event.preventDefault();
    await backendInitPromise;
    const form = event.currentTarget;
    const status = form.querySelector("[data-checkout-status]");
    const items = cartProducts();
    if (!items.length) { status.textContent = "Your basket is empty. Add products before submitting an enquiry."; return; }
    if (!form.reportValidity()) return;
    const fields = Object.fromEntries(new FormData(form).entries());
    const isLocalPreview = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
    if (!backendOnline && !isLocalPreview) {
      status.innerHTML = 'Online quote submission is not enabled on this website yet. Your details were not sent or saved. Please <a href="mailto:info@mercuryglobalsystems.com?subject=MGS%20product%20quote%20request">email MGS to request a quote</a>.';
      return;
    }
    if (backendOnline) {
      try {
        const result = await apiRequest("checkout", {
          method: "POST",
          body: { currency: getCurrency(), items: items.map((item) => ({ id: item.id, quantity: item.quantity })), customer: fields }
        });
        saveCart([]); form.reset(); renderCheckoutSummary(); renderCart(); renderOrders();
        status.innerHTML = `Enquiry <strong>${escapeHtml(result.orderCode)}</strong> has been saved by the MGS server. No payment was taken. MGS will need to confirm the final price, licence/specification, tax and payment arrangements.`;
      } catch (error) { status.textContent = error.message; }
      return;
    }
    const result = cartTotal(items);
    const orderCode = `MGS-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
    const order = {
      id: orderCode,
      date: new Date().toISOString(),
      status: "Enquiry saved in this browser",
      currency: getCurrency(),
      items: items.map((item) => ({ id: item.id, title: item.title, quantity: item.quantity, priceEUR: priceFor(item, 'EUR'), priceINR: priceFor(item, 'INR'), priceLabel: priceFor(item) === null ? 'Price on request' : money(priceFor(item)) })),
      subtotal: result.total,
      subtotalLabel: result.missingPrice ? 'Price on request / quote required' : money(result.total),
      customer: { name: fields.name, email: fields.email, company: fields.company, phone: fields.phone, address: fields.address, paymentPreference: fields.paymentPreference, notes: fields.notes }
    };
    const orders = getOrders();
    orders.unshift(order);
    if (!saveOrders(orders)) { status.textContent = "Your browser could not save the enquiry. Check local browser storage and try again."; return; }
    saveCart([]);
    status.innerHTML = `Enquiry <strong>${escapeHtml(orderCode)}</strong> has been saved in this browser. No payment was taken. <a href="${escapeHtml(buildMailto(order))}">Open an email draft to send it to MGS</a>.`;
    form.reset();
    renderCheckoutSummary();
  }

  async function derivePasswordHash(password, salt) {
    if (!window.crypto?.subtle) throw new Error("Browser cryptography is unavailable. Please open the site through VS Code Live Server or HTTPS.");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 120000, hash: "SHA-256" }, key, 256);
    return Array.from(new Uint8Array(bits)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function handleAuth(event) {
    event.preventDefault();
    await backendInitPromise;
    const form = event.currentTarget;
    const status = form.querySelector("[data-auth-status]");
    const type = form.dataset.authForm;
    const fields = Object.fromEntries(new FormData(form).entries());
    try {
      const email = String(fields.email || "").trim().toLowerCase();
      if (type === "signup" && fields.password !== fields.passwordConfirm) { status.textContent = "The passwords do not match."; return; }
      if (type === "signup" && String(fields.password || "").length < 12) { status.textContent = "Use a password with at least 12 characters."; return; }
      const isLocalPreview = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
      if (!backendOnline && !isLocalPreview) {
        status.textContent = "Secure account services are not enabled on this website yet. Your details were not saved. Please contact MGS for assistance.";
        return;
      }
      if (backendOnline) {
        const result = await apiRequest(type, { method: "POST", body: { name: fields.name || "", email, password: String(fields.password || "") } });
        backendUser = result.user || null;
        if (result.csrfToken) backendCsrfToken = result.csrfToken;
        if (backendUser) safeWrite(KEYS.session, { name: backendUser.name, email: backendUser.email, role: backendUser.role, since: new Date().toISOString() });
        document.dispatchEvent(new CustomEvent("mgs:session-changed"));
        status.textContent = "Signed in securely with the MGS server. Opening your account…";
        const next = new URLSearchParams(window.location.search).get("next");
        window.location.href = backendUser?.role === "admin" ? "admin.html" : (next === "checkout.html" ? "checkout.html" : "account.html");
        return;
      }
      const users = safeRead(KEYS.users, []);
      if (type === "signup") {
        if (fields.password !== fields.passwordConfirm) { status.textContent = "The passwords do not match."; return; }
        if (users.some((user) => user.email === email)) { status.textContent = "A local demo profile already exists for this email. Sign in instead."; return; }
        const salt = `${Date.now()}-${crypto.getRandomValues(new Uint32Array(2)).join('-')}`;
        const passwordHash = await derivePasswordHash(fields.password, salt);
        const user = { name: String(fields.name).trim(), email, salt, passwordHash, createdAt: new Date().toISOString() };
        users.push(user);
        if (!safeWrite(KEYS.users, users)) throw new Error("This browser could not save the profile.");
        safeWrite(KEYS.session, { name: user.name, email: user.email, since: new Date().toISOString() });
        document.dispatchEvent(new CustomEvent("mgs:session-changed"));
        status.textContent = "Local demo profile created. Opening your account…";
        window.location.href = "account.html";
        return;
      }
      const user = users.find((entry) => entry.email === email);
      if (!user) { status.textContent = "No local demo profile was found for that email. Create an account on this browser first."; return; }
      const hash = await derivePasswordHash(fields.password, user.salt);
      if (hash !== user.passwordHash) { status.textContent = "Email or password is incorrect for this local demo profile."; return; }
      safeWrite(KEYS.session, { name: user.name, email: user.email, since: new Date().toISOString() });
      document.dispatchEvent(new CustomEvent("mgs:session-changed"));
      status.textContent = "Signed in to the local demo profile. Opening your account…";
      window.location.href = "account.html";
    } catch (error) {
      status.textContent = error.message || "Could not complete the local demo account action.";
    }
  }

  function renderAccount() {
    const greeting = document.querySelector("[data-account-greeting]");
    if (!greeting) return;
    const session = getSession();
    const email = document.querySelector("[data-account-email]");
    const login = document.querySelector("[data-account-login]");
    const logout = document.querySelector("[data-account-logout]");
    if (session) {
      greeting.textContent = `Welcome, ${session.name}`;
      if (email) email.textContent = session.email;
      if (login) login.hidden = true;
      if (logout) logout.hidden = false;
    } else {
      greeting.textContent = "Welcome to MGS";
      if (email) email.textContent = "Sign in or create a local demo profile to try the account screens.";
      if (login) { login.hidden = false; login.textContent = "Sign in"; }
      if (logout) logout.hidden = true;
    }
  }

  async function renderOrders() {
    const target = document.querySelector("[data-orders-list]");
    if (!target) return;
    const session = getSession();
    if (!session || !session.email) { target.innerHTML = emptyMarkup("Sign in to view your enquiries", "Customer enquiries are shown under the matching account.") + '<p><a class="btn btn-blue" href="login.html">Sign in</a> <a class="text-link" href="signup.html">Create an account →</a></p>'; return; }
    let orders = [];
    if (backendOnline) {
      try { orders = (await apiRequest("my-orders")).orders || []; }
      catch (error) { target.innerHTML = emptyMarkup("Orders could not be loaded", error.message); return; }
    } else {
      orders = getOrders().filter((order) => String(order.customer?.email || "").toLowerCase() === String(session.email).toLowerCase());
    }
    if (!orders.length) { target.innerHTML = emptyMarkup("No enquiries yet", "When you submit an enquiry from checkout, it will appear here for this account."); return; }
    target.innerHTML = orders.map((order) => `<article class="order-card"><div class="order-card-header"><div><h3>${escapeHtml(order.id)}</h3><p class="muted-small">${escapeHtml(new Date(order.date).toLocaleString())}</p></div><span class="order-status">${escapeHtml(order.status)}</span></div><ul class="order-product-list">${(order.items || []).map((item) => `<li><span>${escapeHtml(item.title)} × ${item.quantity}</span><strong>${escapeHtml(item.priceLabel)}</strong></li>`).join("")}</ul><div class="order-card-footer"><span>Contact: ${escapeHtml(order.customer?.email || session.email)}</span><strong>${escapeHtml(order.subtotalLabel)}</strong></div><p class="muted-small">An enquiry is not a paid order confirmation. MGS must confirm the final quotation and payment terms.</p></article>`).join("");
  }

  function renderAdmin() {
    const target = document.querySelector("[data-admin-products]");
    if (!target) return;
    const query = (document.querySelector("[data-admin-search]")?.value || "").trim().toLowerCase();
    const products = getProducts().filter((product) => [product.title, product.id, product.group, product.category].join(" ").toLowerCase().includes(query));
    if (!products.length) { target.innerHTML = emptyMarkup("No products found", "Try another search term or add a new product."); return; }
    target.innerHTML = products.map((product) => `<article class="admin-product-card">
      <a class="admin-product-card-main" href="admin-product.html?id=${encodeURIComponent(product.id)}" aria-label="Edit ${escapeHtml(product.title)}">
        <span class="admin-product-card-image"><img src="${escapeHtml(product.image || 'assets/images/products/windows-license.jpg')}" data-image-fallback="${escapeHtml(fallbackImage(product))}" alt="" loading="lazy"></span>
        <span class="admin-product-card-info"><span class="admin-product-kind">${escapeHtml(product.group || product.category)} · ${escapeHtml(product.id)}</span><strong>${escapeHtml(product.title)}</strong><span class="admin-product-price-line">EUR: ${escapeHtml(priceFor(product, 'EUR') === null ? 'Not set' : money(priceFor(product, 'EUR'), 'EUR'))} <span>·</span> INR: ${escapeHtml(priceFor(product, 'INR') === null ? 'Not set' : money(priceFor(product, 'INR'), 'INR'))}</span><span class="admin-product-status ${product.active === false ? 'is-hidden' : ''}">${product.active === false ? 'Hidden from shop' : 'Visible in shop'}</span></span>
        <span class="admin-edit-arrow" aria-hidden="true">↗</span>
      </a><a class="admin-product-edit-link" href="admin-product.html?id=${encodeURIComponent(product.id)}">Edit all product information →</a>
    </article>`).join("");
  }

  async function createAdminProduct() {
    await backendInitPromise;
    const all = getProducts();
    const base = "new-product";
    let index = all.length + 1;
    let id = `${base}-${index}`;
    while (all.some((product) => product.id === id)) { index += 1; id = `${base}-${index}`; }
    const product = {
      id, title: "New product", category: "software", group: "Microsoft Licenses", badge: "New listing",
      image: "assets/images/products/windows-license.jpg", short: "Enter the verified product summary before publishing.",
      description: "Enter accurate product information and verify the exact SKU before publishing.", highlights: [],
      licenseNote: "Confirm the applicable licence or specification terms before accepting orders.",
      sourceUrl: "", sourceLabel: "", priceEUR: null, priceINR: null, active: false
    };
    if (backendOnline) {
      try {
        await apiRequest("admin-product-save", { method: "POST", body: { ...product, highlights: [], active: false } });
        const refreshed = await apiRequest("admin-products"); window.MGS_CATALOG = refreshed.products || [];
        window.location.href = `admin-product.html?id=${encodeURIComponent(id)}`;
      } catch (error) {
        const status = document.querySelector("[data-admin-status]"); if (status) status.textContent = error.message;
      }
      return;
    }
    const added = safeRead(KEYS.newProducts, []); added.push(product);
    if (!safeWrite(KEYS.newProducts, added)) {
      const status = document.querySelector("[data-admin-status]");
      if (status) status.textContent = "Could not add the product because browser storage is unavailable.";
      return;
    }
    window.location.href = `admin-product.html?id=${encodeURIComponent(id)}`;
  }

  function renderProductEditor() {
    const form = document.querySelector("[data-admin-product-form]");
    if (!form) return;
    const id = new URLSearchParams(window.location.search).get("id");
    const product = getProducts().find((item) => item.id === id);
    const status = form.querySelector("[data-product-editor-status]");
    if (!product) {
      if (status) status.textContent = "Product not found. Return to Store management and open a product from the list.";
      form.querySelectorAll("input, textarea, select, button").forEach((field) => { field.disabled = true; });
      return;
    }
    const values = {
      id: product.id, title: product.title, category: product.category, group: product.group,
      badge: product.badge, image: product.image, short: product.short, description: product.description,
      highlights: (product.highlights || []).join("\n"), licenseNote: product.licenseNote,
      sourceUrl: product.sourceUrl, sourceLabel: product.sourceLabel,
      priceEUR: priceFor(product, "EUR") ?? "", priceINR: priceFor(product, "INR") ?? "", active: product.active !== false
    };
    Object.entries(values).forEach(([name, value]) => {
      const field = form.elements.namedItem(name);
      if (!field) return;
      if (field.type === "checkbox") field.checked = Boolean(value);
      else field.value = value ?? "";
    });
    const heading = document.querySelector("[data-editor-heading]");
    const breadcrumb = document.querySelector("[data-editor-breadcrumb]");
    if (heading) heading.textContent = `Edit ${product.title}`;
    if (breadcrumb) breadcrumb.textContent = product.title;
    const preview = document.querySelector("[data-editor-image]");
    if (preview) preview.src = product.image || "assets/images/products/windows-license.jpg";
  }

  async function saveProductEditor(event) {
    event.preventDefault();
    await backendInitPromise;
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form).entries());
    const id = String(data.id || "");
    const product = getProducts().find((item) => item.id === id);
    if (!product) return;
    const parsePrice = (raw) => String(raw ?? "").trim() !== "" && Number.isFinite(Number(raw)) && Number(raw) >= 0 ? Number(raw) : null;
    const next = {
      ...(catalogueOverrides()[id] || {}),
      title: String(data.title).trim(), category: data.category,
      group: String(data.group || "").trim(), badge: String(data.badge || "").trim(),
      image: String(data.image || "").trim(), short: String(data.short || "").trim(),
      description: String(data.description || "").trim(),
      highlights: String(data.highlights || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
      licenseNote: String(data.licenseNote || "").trim(), sourceUrl: String(data.sourceUrl || "").trim(),
      sourceLabel: String(data.sourceLabel || "").trim(), priceEUR: parsePrice(data.priceEUR),
      priceINR: parsePrice(data.priceINR), active: form.elements.namedItem("active").checked
    };
    const status = form.querySelector("[data-product-editor-status]");
    if (backendOnline) {
      try {
        await apiRequest("admin-product-save", { method: "POST", body: { ...next, id } });
        const refreshed = await apiRequest("admin-products"); window.MGS_CATALOG = refreshed.products || [];
        if (status) status.textContent = "Product saved to the MGS catalogue database.";
      } catch (error) {
        if (status) status.textContent = error.message;
        return;
      }
    } else {
      if (!safeWrite(KEYS.catalogue, { ...catalogueOverrides(), [id]: next })) {
        if (status) status.textContent = "Could not save this product in browser storage.";
        return;
      }
      if (status) status.textContent = "Product changes saved in this browser preview. They will not publish to other visitors until a backend is connected.";
    }
    renderShop(); renderAdmin(); renderAdminStats();
  }

  const getSettings = () => ({
    brandName: "Mercury Global Systems", brandLogoPath: "assets/images/mgs-logo.svg", supportEmail: "info@mercuryglobalsystems.com",
    footerTagline: "Enterprise technology built for the real world.", defaultCurrency: "EUR",
    shopIntro: "Compare Microsoft licence options and storage capacities. Select a product to review details.",
    heroTitle: "Enterprise Infrastructure & Global Tech Ventures.",
    heroSubtitle: "A sharp, practical platform for European market access, resilient IT infrastructure, and critical data recovery.",
    heroImageUrl: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?q=85&w=1600",
    ...safeRead(KEYS.settings, {})
  });

  function applySiteSettings() {
    const settings = getSettings();
    /* Keep the M/G/S brand initials styled consistently; do not flatten them to plain text. */
    document.querySelectorAll(".site-header .brand-name, .site-footer .brand-name").forEach((el) => {
      el.innerHTML = '<span class="brand-initial">M</span>ercury <span class="brand-initial">G</span>lobal <span class="brand-initial">S</span>ystems';
    });
    document.querySelectorAll(".site-header .logo-image, .site-footer .logo-image").forEach((el) => { el.src = settings.brandLogoPath || "assets/images/mgs-logo.svg"; });
    document.querySelectorAll("[data-footer-tagline]").forEach((el) => { el.textContent = settings.footerTagline; });
    const shopIntro = document.querySelector("[data-shop-intro]"); if (shopIntro) shopIntro.textContent = settings.shopIntro;
    const heroTitle = document.querySelector("[data-home-title]"); if (heroTitle) heroTitle.textContent = settings.heroTitle;
    const heroCopy = document.querySelector("[data-home-copy]"); if (heroCopy) heroCopy.textContent = settings.heroSubtitle;
    const heroImage = document.querySelector(".hero-photo img"); if (heroImage && settings.heroImageUrl) heroImage.src = settings.heroImageUrl;
    const heroBackground = document.querySelector(".hero"); if (heroBackground && settings.heroImageUrl) heroBackground.style.backgroundImage = `linear-gradient(108deg, rgba(10,22,40,.84), rgba(10,22,40,.56) 55%, rgba(10,22,40,.44)), url("${String(settings.heroImageUrl).replace(/["\\]/g, "")}")`;
    document.querySelectorAll('.footer-links a[href^="mailto:"]').forEach((link) => { link.href = `mailto:${settings.supportEmail}`; link.textContent = settings.supportEmail; });
    const form = document.querySelector("[data-site-settings-form]");
    if (form) Object.entries(settings).forEach(([name, value]) => { const field = form.elements.namedItem(name); if (field) field.value = value; });
  }

  async function saveSiteSettings(event) {
    event.preventDefault();
    await backendInitPromise;
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const status = form.querySelector("[data-settings-status]");
    if (backendOnline) {
      try {
        const saved = await apiRequest("admin-settings-save", { method: "POST", body: data });
        safeWrite(KEYS.settings, saved.settings || data);
        if (status) status.textContent = "Website settings saved to the MGS database.";
      } catch (error) { if (status) status.textContent = error.message; return; }
    } else {
      if (!safeWrite(KEYS.settings, data)) {
        if (status) status.textContent = "Could not save settings in browser storage.";
        return;
      }
      if (status) status.textContent = "Website settings saved for this browser preview only.";
    }
    localStorage.setItem(KEYS.currency, data.defaultCurrency || "EUR");
    applySiteSettings(); setCurrency(data.defaultCurrency || "EUR");
  }

  function saveAdminProduct(id) {
    const originals = (window.MGS_CATALOG || []).find((item) => item.id === id);
    if (!originals) return;
    const overrides = catalogueOverrides();
    const euroInput = document.querySelector(`[data-admin-eur="${CSS.escape(id)}"]`);
    const inrInput = document.querySelector(`[data-admin-inr="${CSS.escape(id)}"]`);
    const activeInput = document.querySelector(`[data-admin-active="${CSS.escape(id)}"]`);
    const titleInput = document.querySelector(`[data-admin-title="${CSS.escape(id)}"]`);
    const shortInput = document.querySelector(`[data-admin-short="${CSS.escape(id)}"]`);
    const descriptionInput = document.querySelector(`[data-admin-description="${CSS.escape(id)}"]`);
    const parsePrice = (input) => input && input.value.trim() !== "" && Number.isFinite(Number(input.value)) && Number(input.value) >= 0 ? Number(input.value) : null;
    overrides[id] = {
      ...(overrides[id] || {}),
      title: titleInput?.value.trim() || originals.title,
      short: shortInput?.value.trim() || originals.short,
      description: descriptionInput?.value.trim() || originals.description,
      priceEUR: parsePrice(euroInput),
      priceINR: parsePrice(inrInput),
      active: Boolean(activeInput?.checked)
    };
    if (!safeWrite(KEYS.catalogue, overrides)) {
      const status = document.querySelector("[data-admin-status]");
      if (status) status.textContent = "This browser could not save the catalogue change.";
      return;
    }
    const status = document.querySelector("[data-admin-status]");
    if (status) status.textContent = `${originals.title}: local changes saved in this browser only.`;
    renderAdmin(); renderShop(); renderAdminStats();
    document.dispatchEvent(new CustomEvent("mgs:catalogue-updated"));
  }

  function renderAdminStats() {
    const target = document.querySelector("[data-admin-stats]");
    if (!target) return;
    const products = getProducts();
    const orders = backendOnline ? backendOrders : getOrders();
    const users = backendOnline ? backendCustomers : safeRead(KEYS.users, []);
    const active = products.filter((product) => product.active !== false).length;
    target.innerHTML = [
      ['Catalogue products', products.length, 'Software and storage SKUs'],
      ['Visible products', active, backendOnline ? 'Published from the MGS database' : 'Shown in this browser preview'],
      [backendOnline ? 'Quote enquiries' : 'Local enquiries', orders.length, backendOnline ? 'Stored on the MGS server' : 'Saved in this browser only'],
      [backendOnline ? 'Customer accounts' : 'Demo profiles', users.length, backendOnline ? 'Server-registered customer accounts' : 'Profiles in this browser only']
    ].map(([label, value, note]) => `<article class="admin-stat-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`).join('');
  }

  async function renderAdminOrders() {
    const target = document.querySelector('[data-admin-orders]');
    if (!target) return;
    let orders = getOrders();
    if (backendOnline) {
      try { orders = (await apiRequest("admin-orders")).orders || []; backendOrders = orders; }
      catch (error) { target.innerHTML = emptyMarkup("Order enquiries could not be loaded", error.message); return; }
    }
    if (!orders.length) { target.innerHTML = emptyMarkup(backendOnline ? 'No quote enquiries yet' : 'No local enquiries yet', backendOnline ? 'Customer quote requests saved on the MGS server will appear here.' : 'Submitted enquiries from this browser will appear here for review.'); renderAdminStats(); return; }
    const statuses = backendOnline ? ['Enquiry received', 'Under review', 'Quote prepared', 'Closed', 'Cancelled'] : ['Enquiry saved in this browser', 'Reviewed locally', 'Quote prepared locally', 'Closed locally'];
    target.innerHTML = orders.map((order) => `<article class="order-card"><div class="order-card-header"><div><h3>${escapeHtml(order.id)}</h3><p class="muted-small">${escapeHtml(new Date(order.date).toLocaleString())} · ${escapeHtml(order.customer.name)}</p></div><span class="order-status">${escapeHtml(order.status)}</span></div><ul class="order-product-list">${order.items.map((item) => `<li><span>${escapeHtml(item.title)} × ${item.quantity}</span><strong>${escapeHtml(item.priceLabel)}</strong></li>`).join('')}</ul><div class="admin-order-tools"><label for="status-${escapeHtml(order.id)}">Local status</label><select id="status-${escapeHtml(order.id)}" data-admin-order-status="${escapeHtml(order.id)}">${statuses.map((status) => `<option value="${escapeHtml(status)}" ${order.status === status ? 'selected' : ''}>${escapeHtml(status)}</option>`).join('')}</select><button class="admin-save" type="button" data-admin-order-save="${escapeHtml(order.id)}">Save status</button><a class="text-link" href="${escapeHtml(buildMailto(order))}">Prepare customer email ↗</a></div><div class="order-card-footer"><span>${escapeHtml(order.customer.email)}</span><strong>${escapeHtml(order.subtotalLabel)}</strong></div><p class="muted-small">${backendOnline ? 'This enquiry is stored on the MGS server. No payment was collected.' : 'Local prototype record only; this change does not update any server or customer account elsewhere.'}</p></article>`).join('');
    renderAdminStats();
  }

  async function renderAdminCustomers() {
    const target = document.querySelector('[data-admin-customers]');
    if (!target) return;
    let users = safeRead(KEYS.users, []);
    if (backendOnline) {
      try { users = (await apiRequest("admin-customers")).customers || []; backendCustomers = users; }
      catch (error) { target.innerHTML = emptyMarkup("Customer list could not be loaded", error.message); return; }
    }
    if (!users.length) { target.innerHTML = emptyMarkup(backendOnline ? 'No customer accounts yet' : 'No local demo profiles', backendOnline ? 'Registered customer accounts will appear here.' : 'Profiles created on this browser will be listed here.'); renderAdminStats(); return; }
    target.innerHTML = `<div class="admin-customer-list-inner">${users.map((user) => `<article class="admin-customer-card"><span class="customer-avatar">${escapeHtml((user.name || 'M').trim().charAt(0).toUpperCase())}</span><div><strong>${escapeHtml(user.name)}</strong><span>${escapeHtml(user.email)}</span><small>Created ${escapeHtml(new Date(user.createdAt).toLocaleDateString())}</small></div></article>`).join('')}</div>`;
    renderAdminStats();
  }

  async function saveAdminOrderStatus(id) {
    await backendInitPromise;
    const select = document.querySelector(`[data-admin-order-status="${CSS.escape(id)}"]`);
    const orders = getOrders();
    const order = orders.find((item) => item.id === id);
    if (!select || (!backendOnline && !order)) return;
    if (backendOnline) {
      try {
        await apiRequest("admin-order-status", { method: "POST", body: { id, status: select.value } });
        const status = document.querySelector('[data-admin-status]'); if (status) status.textContent = `${id}: status saved to the MGS database.`;
      } catch (error) { const status = document.querySelector('[data-admin-status]'); if (status) status.textContent = error.message; return; }
    } else {
      order.status = select.value; saveOrders(orders);
      const status = document.querySelector('[data-admin-status]'); if (status) status.textContent = `${id}: local status updated in this browser only.`;
    }
    renderAdminOrders(); renderOrders(); renderAdminStats();
  }

  function exportCatalogue() {
    const fileContent = JSON.stringify(getProducts(), null, 2);
    const blob = new Blob([fileContent], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "mgs-catalogue-local-export.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    const status = document.querySelector("[data-admin-status]");
    if (status) status.textContent = "Catalogue exported. This file contains the current local preview data.";
  }

  function setCurrency(currency) {
    localStorage.setItem(KEYS.currency, currency);
    document.querySelectorAll("[data-currency-select]").forEach((select) => { select.value = currency; });
    renderShop();
    renderCart();
    renderCheckoutSummary();
    renderOrders();
  }

  document.addEventListener("error", (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.dataset.imageFallback || image.dataset.fallbackApplied === "true") return;
    image.dataset.fallbackApplied = "true";
    image.src = image.dataset.imageFallback;
  }, true);

  document.addEventListener("click", (event) => {
    /* Clicking the product tile itself (not a button/control) opens details. */
    const tile = event.target.closest(".product-card[data-product-id]");
    if (tile && !event.target.closest("button, a, input, select, textarea")) {
      window.location.href = `product.html?id=${encodeURIComponent(tile.dataset.productId)}`;
      return;
    }
    const viewButton = event.target.closest("[data-view-product]");
    if (viewButton) { window.location.href = `product.html?id=${encodeURIComponent(viewButton.dataset.viewProduct)}`; return; }
    const addButton = event.target.closest("[data-add-cart]");
    if (addButton) { addToCart(addButton.dataset.addCart); return; }
    const modalAdd = event.target.closest("[data-modal-add]");
    if (modalAdd) { addToCart(modalAdd.dataset.modalAdd); closeProductModal(); return; }
    if (event.target.closest("[data-modal-close]")) { closeProductModal(); return; }
    if (event.target.matches("[data-product-modal]")) { closeProductModal(); return; }
    const remove = event.target.closest("[data-cart-remove]");
    if (remove) { saveCart(currentCart().filter((item) => item.id !== remove.dataset.cartRemove)); renderCart(); return; }
    const change = event.target.closest("[data-qty-change]");
    if (change) {
      const id = change.dataset.qtyId;
      const delta = Number(change.dataset.qtyChange);
      const cart = currentCart();
      const line = cart.find((item) => item.id === id);
      if (line) line.quantity = Math.max(1, Math.min(99, Number(line.quantity) + delta));
      saveCart(cart); renderCart(); return;
    }
    const adminSave = event.target.closest("[data-admin-save]");
    if (adminSave) { saveAdminProduct(adminSave.dataset.adminSave); return; }
    const orderSave = event.target.closest("[data-admin-order-save]");
    if (orderSave) { saveAdminOrderStatus(orderSave.dataset.adminOrderSave); return; }
    if (event.target.closest("[data-admin-export]")) { exportCatalogue(); return; }
    if (event.target.closest("[data-admin-add-product]")) { createAdminProduct(); return; }
    if (event.target.closest("[data-account-logout]")) {
      void (async () => {
        await backendInitPromise;
        if (backendOnline) { try { await apiRequest("logout", { method: "POST", body: {} }); } catch (_) {} }
        localStorage.removeItem(KEYS.session); backendUser = null; renderAccount();
        document.dispatchEvent(new CustomEvent("mgs:session-changed"));
        const status = document.querySelector("[data-account-greeting]");
        if (status) status.textContent = "You have signed out.";
      })();
    }
  });

  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeProductModal(); });
  document.addEventListener("input", (event) => {
    if (event.target.matches("[data-shop-search]")) renderShop();
    if (event.target.matches("[data-admin-search]")) renderAdmin();
    if (event.target.matches("[name=image]") && event.target.form?.matches("[data-admin-product-form]")) {
      const preview = document.querySelector("[data-editor-image]"); if (preview) preview.src = event.target.value || "assets/images/products/windows-license.jpg";
    }
  });
  document.addEventListener("change", (event) => { if (event.target.matches("[data-currency-select]")) setCurrency(event.target.value); });

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelector("[data-checkout-form]")?.addEventListener("submit", handleCheckout);
    document.querySelectorAll("[data-auth-form]").forEach((form) => form.addEventListener("submit", handleAuth));
    document.querySelector("[data-admin-product-form]")?.addEventListener("submit", saveProductEditor);
    document.querySelector("[data-site-settings-form]")?.addEventListener("submit", saveSiteSettings);
    backendInitPromise = initializeBackend().then((shouldRender) => {
      if (shouldRender === false) return;
      document.querySelectorAll("[data-currency-select]").forEach((select) => { select.value = getCurrency(); });
      applySiteSettings();
      renderShop(); renderProductDetailPage(); renderCart(); renderCheckoutSummary(); renderAccount(); renderOrders(); renderAdmin(); renderAdminOrders(); renderAdminCustomers(); renderAdminStats(); updateCartCounts(); renderProductEditor();
    });
  });
})();
