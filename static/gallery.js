// Created: 2026-11-10 13:37
// Gallery behaviour shared by all pages:
//   1. Masonry  — .masonry lists are split into columns, each item going to the
//                 currently shortest column (keeps reading order roughly left→right).
//                 Uses each item's --r (width/height) so it works before images load.
//                 Without JS the CSS multi-column fallback still shows every work uncropped.
//   2. View switch on series pages (크게 보기 / 목록 보기).
//   3. Lightbox — a full-screen view of one work at its original aspect ratio,
//                 with ←/→, Esc, swipe, and a #work-id URL for sharing.
//   5. Home slideshow — with slideshow: true and 2+ featured works, the featured area plays
//                 like a video screen: ▶/❚❚, ‹ ›, ←/→, swipe, optional music with 🔈.
//   4. Contact e-mail — the About page carries the address reversed in two halves
//                 (data-u / data-d) so harvesters never see it; this rebuilds the link.
(function () {
  "use strict";
  function rev(s) { return (s || "").split("").reverse().join(""); }
  Array.prototype.forEach.call(document.querySelectorAll("a.js-email"), function (a) {
    var addr = rev(a.dataset.u) + "@" + rev(a.dataset.d);
    a.href = "mailto:" + addr;
    a.textContent = addr;
  });
})();

(function () {
  "use strict";

  // ---------------------------------------------------------------- Masonry
  function layoutMasonry(list, force) {
    var cols = parseInt(getComputedStyle(list).getPropertyValue("--cols"), 10) || 3;
    if (!force && list._cols === cols) return;
    list._cols = cols;
    if (!list._items) list._items = Array.prototype.slice.call(list.querySelectorAll(":scope > .m-item, :scope > .masonry-col > .m-item"));

    var gap = parseFloat(getComputedStyle(list).columnGap) || parseFloat(getComputedStyle(list).gap) || 12;
    var width = list.clientWidth || list.parentElement.clientWidth || 1000;
    var colWidth = Math.max(1, (width - gap * (cols - 1)) / cols);
    var extra = parseFloat(list.dataset.extra || "0");   // caption height under each image, px

    var columns = [], heights = [];
    for (var i = 0; i < cols; i++) {
      var col = document.createElement("div");
      col.className = "masonry-col";
      columns.push(col);
      heights.push(0);
    }
    // Equal-area mode narrows each work to colWidth·min(1, √r/--area-ref) (see style.css).
    var areaMode = document.documentElement.dataset.size === "area";
    var itemHeight = function (item) {
      var r = parseFloat(item.style.getPropertyValue("--r")) || 1;
      var w = areaMode ? colWidth * Math.min(1, Math.sqrt(r) / (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--area-ref")) || 1.1547)) : colWidth;
      return w / r + extra + gap;
    };
    list._items.forEach(function (item) {
      var k = heights.indexOf(Math.min.apply(null, heights));
      columns[k].appendChild(item);
      heights[k] += itemHeight(item);
    });
    // Even out the bottoms: move the last work of the tallest column to the
    // shortest one while that narrows the gap. Only tail items move, so the
    // artist's order is kept for everything above.
    for (var guard = 0; guard < list._items.length; guard++) {
      var tall = heights.indexOf(Math.max.apply(null, heights));
      var short = heights.indexOf(Math.min.apply(null, heights));
      var last = columns[tall].lastElementChild;
      if (!last || tall === short) break;
      var h = itemHeight(last);
      var spread = heights[tall] - heights[short];
      if (Math.abs((heights[tall] - h) - (heights[short] + h)) >= spread) break;
      columns[short].appendChild(last);
      heights[tall] -= h;
      heights[short] += h;
    }
    list.textContent = "";
    columns.forEach(function (c) { list.appendChild(c); });
    list.classList.add("is-masonry");
  }

  var masonryLists = Array.prototype.slice.call(document.querySelectorAll(".masonry"));
  masonryLists.forEach(function (l) { layoutMasonry(l, true); });
  // The preview's 시안 switcher can change the sizing mode: re-balance the columns.
  if (window.MutationObserver) {
    new MutationObserver(function () { masonryLists.forEach(function (l) { layoutMasonry(l, true); }); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ["data-size"] });
  }
  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      masonryLists.forEach(function (l) { layoutMasonry(l, false); });
    }, 120);
  });

  // ------------------------------------------------------------ View switch
  var article = document.querySelector(".series");
  if (article) {
    var sw = article.querySelector(".view-switch");
    var viewButtons = sw.querySelectorAll("button");
    sw.hidden = false;
    viewButtons.forEach(function (b) {
      b.addEventListener("click", function () {
        article.dataset.view = b.dataset.view;
        viewButtons.forEach(function (x) { x.setAttribute("aria-pressed", x === b); });
        // The index was hidden while laid out; re-balance now that it has a width.
        if (b.dataset.view === "index") masonryLists.forEach(function (l) { layoutMasonry(l, true); });
        alignHeader();
      });
    });

    // Line the title block up with the left edge of the first work. Works in the sequence
    // view are centred at their own width; the index view already starts at the left edge.
    var firstImg = article.querySelector(".sequence .work img");
    var alignHeader = function () {
      var indent = 0;
      if (firstImg && article.dataset.view !== "index") {
        indent = Math.max(0, Math.round(firstImg.getBoundingClientRect().left - article.getBoundingClientRect().left));
      }
      article.style.setProperty("--head-indent", indent + "px");
    };
    alignHeader();
    if (firstImg && !firstImg.complete) firstImg.addEventListener("load", alignHeader);
    window.addEventListener("resize", alignHeader);
  }

  // --------------------------------------------------------------- Lightbox
  var dialog = document.querySelector(".lightbox");
  var dataEl = document.getElementById("works-data");
  if (!dialog || !dataEl || typeof dialog.showModal !== "function") return;

  var works = JSON.parse(dataEl.textContent);
  var img = dialog.querySelector(".lb-img");
  var caption = dialog.querySelector(".lb-caption");
  var counter = dialog.querySelector(".lb-count");
  var prevBtn = dialog.querySelector(".lb-prev");
  var nextBtn = dialog.querySelector(".lb-next");
  var current = -1, opener = null;

  if (works.length < 2) { prevBtn.hidden = true; nextBtn.hidden = true; }

  function captionHTML(w) {
    var esc = function (s) { var d = document.createElement("span"); d.textContent = s; return d.innerHTML; };
    var head = [w.title, w.year].filter(Boolean).map(esc).join(", ");
    var details = [w.size, w.edition ? "Edition " + w.edition : ""].filter(Boolean).map(esc).join(" · ");
    return (head ? "<span class=\"lb-title\">" + head + "</span>" : "") +
           (details ? "<span class=\"lb-detail\">" + details + "</span>" : "");
  }

  function show(i) {
    current = (i + works.length) % works.length;
    var w = works[current];
    img.removeAttribute("src");          // avoid flashing the previous work
    img.srcset = w.srcset;
    img.sizes = "100vw";
    img.src = w.src;
    img.width = w.w;
    img.height = w.h;
    img.alt = w.alt;
    img.style.setProperty("--r", w.w / w.h);
    caption.innerHTML = captionHTML(w);
    counter.textContent = (current + 1) + " / " + works.length;
    history.replaceState(null, "", "#" + encodeURIComponent(w.id));
    // Warm the neighbours so ←/→ feel instant.
    [current - 1, current + 1].forEach(function (j) {
      var n = works[(j + works.length) % works.length];
      var pre = new Image(); pre.sizes = "100vw"; pre.srcset = n.srcset;
    });
  }

  function open(id, trigger) {
    var i = works.findIndex(function (w) { return w.id === id; });
    if (i < 0) return;
    opener = trigger || null;
    show(i);
    if (!dialog.open) {
      dialog.showModal();
      dialog.focus();   // focus the lightbox itself, not the ✕ (avoids a focus box on open)
      document.documentElement.classList.add("lb-open");
    }
  }

  dialog.addEventListener("close", function () {
    document.documentElement.classList.remove("lb-open");
    history.replaceState(null, "", location.pathname + location.search);
    if (opener) opener.focus();
  });

  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-open]");
    if (!t) return;
    e.preventDefault();
    open(t.dataset.open, t);
  });

  prevBtn.addEventListener("click", function () { show(current - 1); });
  nextBtn.addEventListener("click", function () { show(current + 1); });
  dialog.querySelector(".lb-close").addEventListener("click", function () { dialog.close(); });

  dialog.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft") { e.preventDefault(); show(current - 1); }
    if (e.key === "ArrowRight") { e.preventDefault(); show(current + 1); }
  });

  // Swipe left/right on touch screens; a tap on the empty area closes.
  var startX = null, startY = null, moved = false;
  dialog.addEventListener("pointerdown", function (e) { startX = e.clientX; startY = e.clientY; moved = false; });
  dialog.addEventListener("pointermove", function (e) {
    if (startX !== null && Math.abs(e.clientX - startX) > 10) moved = true;
  });
  dialog.addEventListener("pointerup", function (e) {
    if (startX === null) return;
    var dx = e.clientX - startX, dy = e.clientY - startY;
    startX = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) && works.length > 1) {
      show(current + (dx < 0 ? 1 : -1));
    }
  });
  dialog.addEventListener("click", function (e) {
    if (moved) { moved = false; return; }
    if (e.target === dialog || e.target.classList.contains("lb-stage")) dialog.close();
  });

  // A shared link (…/#work-id) shows that work directly — on page load and when
  // the hash changes later (back/forward, a link to another work on this page).
  function openFromHash() {
    if (!location.hash) { if (dialog.open) dialog.close(); return; }
    var id = decodeURIComponent(location.hash.slice(1));
    if (works.some(function (w) { return w.id === id; })) open(id, null);
  }
  window.addEventListener("hashchange", openFromHash);
  openFromHash();
})();

// ------------------------------------------------------- Home slideshow player
(function () {
  "use strict";
  var box = document.querySelector(".home-featured.has-slideshow");
  var bar = document.querySelector(".home-controls");
  if (!box || !bar) return;
  var figs = Array.prototype.slice.call(box.querySelectorAll(".featured-work"));
  if (figs.length < 2) return;
  // What plays: the slideshow works (.is-slide) when the operator chose some, otherwise the
  // featured works. The featured work on screen is where the screen starts either way.
  var seq = figs.map(function (_, i) { return i; }).filter(function (i) { return figs[i].classList.contains("is-slide"); });
  if (!seq.length) seq = figs.map(function (_, i) { return i; });

  // slideshow_interval = how long a work is shown whole; the dissolve into the next one
  // comes on top, so one turn is interval + dissolve (operator request, 2026-11-13).
  var interval = 1000 * (Number(box.dataset.interval) || 5);
  var dissolve = 1000 * (Number(box.dataset.dissolve) || 0);
  // Rounds to play before going back to the featured work and stopping; 0 = keep going.
  var rounds = Number(box.dataset.rounds || 1), roundsDone = 0;
  var playBtn = bar.querySelector(".hc-play");
  var stopBtn = bar.querySelector(".hc-stop");
  var muteBtn = bar.querySelector(".hc-mute");
  var audio = document.querySelector(".slideshow-audio");
  var playing = false, timer = null, order = [], pos = 0;

  // The work already on screen (the first, or the random pick) is where playing starts.
  var current = Math.max(0, figs.findIndex(function (f) { return !f.hidden; }));
  var home = current;            // the featured work ■ returns to
  function load(f) {
    var img = f.querySelector("img");
    if (img && img.dataset.src && !img.getAttribute("src")) { img.srcset = img.dataset.srcset; img.src = img.dataset.src; }
  }
  // Turn the area into the screen: every work in one cell, only the current one visible.
  figs.forEach(function (f, i) { f.hidden = false; f.classList.toggle("is-current", i === current); });
  box.classList.add("is-player");
  bar.hidden = false;

  function makeOrder() {          // the play sequence (from the work on screen, if it is in it)
    var inSeq = seq.indexOf(current) >= 0;
    order = seq.filter(function (i) { return i !== current; });
    if (box.dataset.order === "random") {
      for (var k = order.length - 1; k > 0; k--) {
        var j = Math.floor(Math.random() * (k + 1)), t = order[k]; order[k] = order[j]; order[j] = t;
      }
    }
    if (inSeq) order.unshift(current);
    pos = 0;
  }
  makeOrder();

  function show(i) {
    current = i;
    load(figs[i]);
    figs.forEach(function (f, k) { f.classList.toggle("is-current", k === i); });
    load(figs[order[(order.indexOf(i) + 1) % order.length]]);   // warm the next one (or the first)
    syncStop();
    schedule();
  }
  function syncStop() { if (stopBtn) stopBtn.hidden = !(playing || current !== home); }
  function step(d) {
    var at = order.indexOf(current);   // -1 while the featured work (not in the show) is on screen
    pos = at < 0 ? (d > 0 ? 0 : order.length - 1) : (at + d + order.length) % order.length;
    show(order[pos]);
  }
  function schedule() {
    clearTimeout(timer);
    if (playing) timer = setTimeout(advance, dissolve + interval);
  }
  function advance() {             // the timer's step; after the set number of rounds, go home
    if (order.indexOf(current) === order.length - 1 && ++roundsDone >= rounds && rounds > 0) toHome();
    else step(1);
  }
  // ■ (and the end of a round): dissolve back to the featured work, stop, and start over next time.
  function toHome() {
    roundsDone = 0;
    setPlaying(false, true);
    show(home);
    makeOrder();                    // a new shuffle for the next ▶ when the order is random
    syncStop();
  }

  // ---- music: plays with the slideshow, fades in/out, follows Pause; 🔈 mutes (remembered)
  var fadeTimer = null, audioRetried = false;
  function fadeTo(target, ms, done) {
    clearInterval(fadeTimer);
    var from = audio.volume, t0 = Date.now();
    fadeTimer = setInterval(function () {
      var k = Math.min(1, (Date.now() - t0) / ms);
      audio.volume = from + (target - from) * k;   // iOS ignores volume; play/pause still work
      if (k >= 1) { clearInterval(fadeTimer); if (done) done(); }
    }, 40);
  }
  function musicPlay() {
    if (!audio) return;
    var p = audio.play();
    if (p && p.then) p.then(function () { fadeTo(1, 1200); }).catch(function () {});
  }
  function musicStop(rewind) {     // rewind: the next ▶ starts the music from the beginning
    if (!audio) return;
    var done = function () { audio.pause(); if (rewind) try { audio.currentTime = 0; } catch (e) {} };
    if (audio.paused) done(); else fadeTo(0, rewind ? 900 : 500, done);
  }
  function syncMute() {
    muteBtn.dataset.state = audio.muted ? "off" : "on";
    muteBtn.setAttribute("aria-label", audio.muted ? "Play music" : "Mute music");
  }
  if (audio && muteBtn) {
    audio.volume = 0;
    try { audio.muted = localStorage.getItem("slideshow-muted") === "1"; } catch (e) {}
    syncMute();
    muteBtn.addEventListener("click", function () {
      audio.muted = !audio.muted;
      try { localStorage.setItem("slideshow-muted", audio.muted ? "1" : "0"); } catch (e) {}
      syncMute();
    });
    // A server without byte ranges (some local previews) can't stream audio to Safari;
    // then load the whole file once and play it from memory.
    audio.addEventListener("error", function () {
      if (audioRetried) return;
      audioRetried = true;
      fetch(audio.src).then(function (r) { return r.blob(); }).then(function (b) {
        audio.src = URL.createObjectURL(b);
        if (playing) musicPlay();
      }).catch(function () {});
    });
  }

  function setPlaying(on, rewind) {
    playing = on;
    playBtn.dataset.state = on ? "playing" : "paused";   // CSS shows ❚❚ while playing, ▶ while paused
    playBtn.setAttribute("aria-label", on ? "Pause slideshow" : "Play slideshow");
    if (on) { seq.forEach(function (i) { load(figs[i]); }); musicPlay(); } else musicStop(rewind);
    syncStop();
    // From the featured work (not part of the show) go straight into the first slide.
    if (on && order.indexOf(current) < 0) step(1); else schedule();
  }

  playBtn.addEventListener("click", function () { setPlaying(!playing); });
  if (stopBtn) stopBtn.addEventListener("click", function () {
    toHome();
    playBtn.focus();               // the ■ key disappears; keep the keyboard focus nearby
  });
  bar.querySelector(".hc-prev").addEventListener("click", function () { step(-1); });
  bar.querySelector(".hc-next").addEventListener("click", function () { step(1); });
  box.tabIndex = 0;              // ←/→ when the screen has focus
  box.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); step(e.key === "ArrowRight" ? 1 : -1); }
  });
  var x0 = null;
  box.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; }, { passive: true });
  box.addEventListener("touchend", function (e) {
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
  });
  // Stop when the page is left in the background, so music doesn't play on unseen.
  document.addEventListener("visibilitychange", function () { if (document.hidden && playing) setPlaying(false); });
})();

