/**
 * app.js — Good Morning gallery
 * No build step, no external JS dependencies. Talks to data/images.json
 * (or a live API, see config.js) and keeps all personal state
 * (favorites, downloads, viewing history) in localStorage only.
 */
(function () {
  "use strict";

  const DAILY_COUNT = 24; // "Today" pool size, per the brief's day-1/day-2 example

  /* ----------------------------- state ----------------------------- */
  let CATEGORIES = [];
  let IMAGES = [];
  let byId = new Map();

  let viewMode = "all";      // all | today | favorites | downloads
  let currentCategory = "all";
  let searchTerm = "";
  let visibleCount = 0;

  let todayQueueIds = [];
  let featuredId = null;
  let currentFiltered = [];  // recomputed on every render() — lightbox indexes into this

  let seen = new Set();
  let favorites = new Set();
  let downloads = new Map(); // id -> { resolution, ts }

  /* --------------------------- utilities ---------------------------- */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function todayKey() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable — app still works, just won't persist */ }
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function showToast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(showToast._tm);
    showToast._tm = setTimeout(() => t.classList.remove("show"), 2200);
  }

  /* --------------------------- persistence --------------------------- */
  function loadState() {
    const S = CONFIG.STORAGE;
    seen = new Set(readJSON(S.SEEN, []));
    favorites = new Set(readJSON(S.FAVORITES, []));
    const dl = readJSON(S.DOWNLOADS, []);
    downloads = new Map(dl.map((d) => [d.id, d]));
    todayQueueIds = readJSON(S.DAY_QUEUE, []);
  }
  function saveSeen() { writeJSON(CONFIG.STORAGE.SEEN, Array.from(seen)); }
  function saveFavorites() { writeJSON(CONFIG.STORAGE.FAVORITES, Array.from(favorites)); }
  function saveDownloads() { writeJSON(CONFIG.STORAGE.DOWNLOADS, Array.from(downloads.values())); }
  function saveDayQueue() { writeJSON(CONFIG.STORAGE.DAY_QUEUE, todayQueueIds); }

  /* ------------------------- daily rotation -------------------------- */
  // Never show the same image repeatedly: pick from images not yet in
  // `seen`. Once the pool runs out, reset history (favorites/downloads
  // are untouched) and start a fresh cycle.
  function ensureDayQueue() {
    const lastVisit = localStorage.getItem(CONFIG.STORAGE.LAST_VISIT);
    const today = todayKey();

    if (lastVisit === today && todayQueueIds.length) {
      todayQueueIds = todayQueueIds.filter((id) => byId.has(id));
      if (todayQueueIds.length) return;
    }

    let pool = IMAGES.filter((img) => !seen.has(img.id));
    if (pool.length < Math.min(DAILY_COUNT, IMAGES.length)) {
      // Pool exhausted (or nearly) — start a new cycle.
      seen = new Set();
      const cycle = (parseInt(localStorage.getItem(CONFIG.STORAGE.CYCLE) || "0", 10) || 0) + 1;
      localStorage.setItem(CONFIG.STORAGE.CYCLE, String(cycle));
      pool = IMAGES.slice();
    }

    const picked = shuffle(pool).slice(0, Math.min(DAILY_COUNT, pool.length));
    todayQueueIds = picked.map((img) => img.id);
    picked.forEach((img) => seen.add(img.id));

    saveSeen();
    saveDayQueue();
    localStorage.setItem(CONFIG.STORAGE.LAST_VISIT, today);
  }

  function pickFeatured(excludeId) {
    const pool = todayQueueIds.filter((id) => id !== excludeId);
    const fromQueue = pool.length ? pool : todayQueueIds;
    const id = fromQueue[Math.floor(Math.random() * fromQueue.length)];
    return id;
  }

  /* ----------------------------- filtering ---------------------------- */
  function baseListForView() {
    if (viewMode === "today") return todayQueueIds.map((id) => byId.get(id)).filter(Boolean);
    if (viewMode === "favorites") return Array.from(favorites).map((id) => byId.get(id)).filter(Boolean);
    if (viewMode === "downloads") return Array.from(downloads.keys()).map((id) => byId.get(id)).filter(Boolean);
    return IMAGES;
  }

  function computeFiltered() {
    let list = baseListForView();
    if (currentCategory !== "all") list = list.filter((img) => img.category === currentCategory);
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      list = list.filter((img) =>
        img.title.toLowerCase().includes(q) ||
        img.category.toLowerCase().includes(q) ||
        img.quote.toLowerCase().includes(q) ||
        img.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return list;
  }

  /* ------------------------------ render ------------------------------ */
  function renderCategoryChips() {
    const wrap = $("#categoryChips");
    wrap.querySelectorAll(".chip:not([data-category='all'])").forEach((n) => n.remove());
    CATEGORIES.forEach((cat) => {
      const b = document.createElement("button");
      b.className = "chip";
      b.dataset.category = cat.id;
      b.textContent = `${cat.emoji} ${cat.label}`;
      wrap.appendChild(b);
    });
  }

  function viewLabel() {
    switch (viewMode) {
      case "today": return "Today's Images";
      case "favorites": return "Your Favorites";
      case "downloads": return "Downloaded Images";
      default: return "The Full Collection";
    }
  }

  function render(reset) {
    if (reset) visibleCount = 0;
    currentFiltered = computeFiltered();

    $("#viewTitle").textContent = viewLabel();
    const countText = `${currentFiltered.length} image${currentFiltered.length === 1 ? "" : "s"}` +
      (currentCategory !== "all" ? ` in ${currentCategory.replace("-", " & ")}` : "") +
      (searchTerm ? ` matching "${searchTerm}"` : "");
    $("#viewMeta").textContent = countText;

    const gallery = $("#gallery");
    if (reset) gallery.innerHTML = "";

    $("#emptyState").hidden = currentFiltered.length !== 0;

    const target = Math.min(visibleCount + CONFIG.PAGE_SIZE, currentFiltered.length);
    for (let i = visibleCount; i < target; i++) {
      gallery.appendChild(renderCard(currentFiltered[i], i));
    }
    visibleCount = target;
  }

  function renderCard(img, index) {
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.id = img.id;

    const isFav = favorites.has(img.id);
    card.innerHTML = `
      <div class="card-img-wrap" data-index="${index}">
        <div class="card-badges">
          <span class="badge">${img.has4k ? "4K" : "HD"} • ${img.category.replace("-", " & ").toUpperCase()}</span>
        </div>
        <button class="fav-toggle ${isFav ? "is-fav" : ""}" aria-label="Toggle favorite" aria-pressed="${isFav}">${isFav ? "♥" : "♡"}</button>
        <img loading="lazy" width="480" height="600" alt="${img.title} — ${img.quote}" data-src="${img.thumbUrl}">
        <div class="card-quote-overlay">${img.quote}</div>
      </div>
      <div class="card-body">
        <span class="card-cat">${categoryEmoji(img.category)} ${img.title}</span>
        <div class="card-actions">
          <button class="card-download" data-res="hd">Download</button>
          <button class="card-share">Share</button>
        </div>
      </div>
    `;

    const imgEl = card.querySelector("img");
    imgEl.src = imgEl.dataset.src;
    imgEl.addEventListener("load", () => imgEl.classList.add("loaded"));
    imgEl.addEventListener("error", () => { imgEl.alt = "Image unavailable"; });

    card.querySelector(".card-img-wrap").addEventListener("click", () => openLightbox(currentFiltered, index));
    card.querySelector(".fav-toggle").addEventListener("click", (e) => { e.stopPropagation(); toggleFavorite(img.id); });
    card.querySelector(".card-download").addEventListener("click", (e) => { e.stopPropagation(); downloadImage(img, "hd"); });
    card.querySelector(".card-share").addEventListener("click", (e) => { e.stopPropagation(); shareImage(img); });

    return card;
  }

  function categoryEmoji(catId) {
    const c = CATEGORIES.find((c) => c.id === catId);
    return c ? c.emoji : "🌅";
  }

  function refreshCardFavStates() {
    $$(".card").forEach((card) => {
      const id = card.dataset.id;
      const btn = card.querySelector(".fav-toggle");
      const isFav = favorites.has(id);
      btn.classList.toggle("is-fav", isFav);
      btn.textContent = isFav ? "♥" : "♡";
      btn.setAttribute("aria-pressed", isFav);
    });
  }

  function updateNavCounts() {
    $("#favCount").textContent = favorites.size;
    $("#dlCount").textContent = downloads.size;
  }

  function updateStats() {
    $("#statTotal").textContent = IMAGES.length.toLocaleString();
    $("#statToday").textContent = todayQueueIds.length;
  }

  /* ------------------------------ hero -------------------------------- */
  function paintHero(img, animate) {
    const el = $("#todayImg");
    const setSrc = () => {
      el.classList.remove("loaded");
      el.onload = () => el.classList.add("loaded");
      el.src = img.previewUrl;
      el.alt = `${img.title} — ${img.quote}`;
    };
    if (animate) {
      el.classList.remove("loaded");
      setTimeout(setSrc, 180);
    } else {
      setSrc();
    }

    const d = new Date();
    const dateStr = d.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" }).toUpperCase();
    $("#todayDate").textContent = `GOOD MORNING — ${dateStr}`;
    $("#todayQuote").textContent = img.quote;
  }

  function setFeatured(id, animate) {
    featuredId = id;
    const img = byId.get(id);
    if (img) paintHero(img, animate);
  }

  /* ---------------------------- favorites ------------------------------ */
  function toggleFavorite(id) {
    if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
    saveFavorites();
    updateNavCounts();
    refreshCardFavStates();
    syncLightboxFav();
    if (viewMode === "favorites") render(true);
  }

  /* ---------------------------- downloads ------------------------------- */
  async function downloadImage(img, resolution) {
    const url = resolution === "4k" && img.has4k ? img.uhdUrl : img.hdUrl;
    const suffix = resolution === "4k" && img.has4k ? "-4k" : "";
    const filename = `${img.filenameBase}${suffix}.jpg`;

    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error("Network response was not OK");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      // Cross-origin or offline fallback: open the image so the user can save it manually.
      window.open(url, "_blank", "noopener");
    }

    downloads.set(img.id, { id: img.id, resolution, ts: Date.now() });
    saveDownloads();
    updateNavCounts();
    showToast(`Downloading ${filename}`);
    if (viewMode === "downloads") render(true);
  }

  /* ------------------------------ share --------------------------------- */
  async function shareImage(img) {
    const shareData = {
      title: `Good Morning — ${img.title}`,
      text: img.quote,
      url: img.previewUrl,
    };
    if (navigator.share) {
      try { await navigator.share(shareData); } catch (e) { /* user cancelled — nothing to do */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(img.previewUrl);
      showToast("Image link copied");
    } catch (e) {
      showToast("Copy this link: " + img.previewUrl);
    }
  }

  /* ------------------------------ lightbox -------------------------------- */
  let lbList = [];
  let lbIndex = 0;

  function openLightbox(list, index) {
    lbList = list;
    lbIndex = index;
    $("#lightbox").hidden = false;
    document.body.style.overflow = "hidden";
    paintLightbox();
  }
  function closeLightbox() {
    $("#lightbox").hidden = true;
    document.body.style.overflow = "";
  }
  function stepLightbox(delta) {
    lbIndex = (lbIndex + delta + lbList.length) % lbList.length;
    paintLightbox();
  }
  function paintLightbox() {
    const img = lbList[lbIndex];
    if (!img) return;
    const el = $("#lbImg");
    el.src = img.previewUrl;
    el.alt = `${img.title} — ${img.quote}`;
    $("#lbQuote").textContent = img.quote;
    $("#lbTitle").textContent = img.title;
    $("#lbRes").textContent = img.has4k ? "Full HD & 4K available" : "Full HD available";
    $("#lbDownload4K").hidden = !img.has4k;
    syncLightboxFav();

    $("#lbDownloadHD").onclick = () => downloadImage(img, "hd");
    $("#lbDownload4K").onclick = () => downloadImage(img, "4k");
    $("#lbFavorite").onclick = () => { toggleFavorite(img.id); };
    $("#lbShare").onclick = () => shareImage(img);
  }
  function syncLightboxFav() {
    const img = lbList[lbIndex];
    if (!img) return;
    const isFav = favorites.has(img.id);
    const btn = $("#lbFavorite");
    btn.classList.toggle("is-fav", isFav);
    btn.textContent = isFav ? "♥ Favorited" : "♡ Favorite";
  }

  /* -------------------------------- events --------------------------------- */
  function wireEvents() {
    $("#navToggle").addEventListener("click", () => {
      const row = $("#siteHeader").querySelector(".header-row");
      const open = row.classList.toggle("open");
      $("#navToggle").setAttribute("aria-expanded", open);
    });

    $$(".nav-link").forEach((link) => {
      link.addEventListener("click", (e) => {
        const mode = link.dataset.nav;
        $$(".nav-link").forEach((n) => n.classList.remove("active"));
        link.classList.add("active");
        $("#siteHeader").querySelector(".header-row").classList.remove("open");

        if (mode === "home") { viewMode = "all"; window.scrollTo({ top: 0, behavior: "smooth" }); render(true); }
        else if (mode === "today") { e.preventDefault(); viewMode = "today"; render(true); scrollToGallery(); }
        else if (mode === "categories") { /* just scroll, default anchor works */ }
        else if (mode === "favorites") { e.preventDefault(); viewMode = "favorites"; render(true); scrollToGallery(); }
        else if (mode === "downloads") { e.preventDefault(); viewMode = "downloads"; render(true); scrollToGallery(); }
      });
    });

    $("#categoryChips").addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      $$(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      currentCategory = chip.dataset.category;
      render(true);
    });

    let searchDebounce;
    $("#searchInput").addEventListener("input", (e) => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        searchTerm = e.target.value.trim();
        render(true);
      }, 220);
    });

    $("#exploreBtn").addEventListener("click", () => {
      viewMode = "today";
      $$(".nav-link").forEach((n) => n.classList.remove("active"));
      document.querySelector('[data-nav="today"]').classList.add("active");
      render(true);
      scrollToGallery();
    });

    $("#downloadTodayBtn").addEventListener("click", () => {
      const img = byId.get(featuredId);
      if (img) downloadImage(img, img.has4k ? "4k" : "hd");
    });

    $("#refreshMorningBtn").addEventListener("click", () => {
      const btn = $("#refreshMorningBtn");
      btn.classList.add("spinning");
      const nextId = pickFeatured(featuredId);
      setFeatured(nextId, true);
      setTimeout(() => btn.classList.remove("spinning"), 450);
    });

    $("#lbClose").addEventListener("click", closeLightbox);
    $("#lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") closeLightbox(); });
    $("#lbPrev").addEventListener("click", () => stepLightbox(-1));
    $("#lbNext").addEventListener("click", () => stepLightbox(1));
    document.addEventListener("keydown", (e) => {
      if ($("#lightbox").hidden) return;
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowLeft") stepLightbox(-1);
      else if (e.key === "ArrowRight") stepLightbox(1);
    });

    const sentinel = $("#loadSentinel");
    new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && visibleCount < currentFiltered.length) {
        render(false);
      }
    }, { rootMargin: "600px" }).observe(sentinel);
  }

  function scrollToGallery() {
    $("#categories").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* -------------------------------- boot ---------------------------------- */
  async function loadData() {
    const url = CONFIG.PROVIDER === "api" ? CONFIG.API_ENDPOINT : CONFIG.LOCAL_DATA_URL;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Could not load image data (" + res.status + ")");
    return res.json();
  }

  async function init() {
    try {
      const data = await loadData();
      CATEGORIES = data.categories;
      IMAGES = data.images;
      byId = new Map(IMAGES.map((img) => [img.id, img]));
    } catch (err) {
      $("#viewMeta").textContent = "Image data could not be loaded. Check your connection and reload.";
      console.error(err);
      return;
    }

    loadState();
    ensureDayQueue();
    if (!featuredId || !byId.has(featuredId)) featuredId = todayQueueIds[0];

    renderCategoryChips();
    wireEvents();
    setFeatured(featuredId, false);
    updateStats();
    updateNavCounts();
    viewMode = "today";
    document.querySelector('[data-nav="today"]').classList.add("active");
    document.querySelector('[data-nav="home"]').classList.remove("active");
    render(true);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
