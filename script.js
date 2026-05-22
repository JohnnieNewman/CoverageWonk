// =========================================================================
// THE COVERAGE WONK — site script
// Handles: review list rendering + sort/filter, share button, BFCache
// =========================================================================

(function () {
  // ---------- Review list rendering ----------
  const listEl = document.getElementById('review-list');
  if (listEl && window.COVERAGE_DATA) {
    const sortBy = document.getElementById('sort-by');
    const filterStation = document.getElementById('filter-station');
    const filterDecade = document.getElementById('filter-decade');

    const escapeHTML = (s) => String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

    // ---- Editor's Cut: pin 3 + daily-rotating shuffle + anti-cluster ----
    const PINNED_SLUGS = ['chinatown', 'network', 'midnight-run'];
    const CLUSTER_THRESHOLD = 1.5; // adjacent scores within this trigger a swap

    function editorCut(items) {
      // Honor active filters: only pin if pinned items survived the filter.
      const pinned = PINNED_SLUGS
        .map(slug => items.find(it => it.slug === slug))
        .filter(Boolean);
      const pinnedSet = new Set(pinned.map(it => it.slug));
      const rest = items.filter(it => !pinnedSet.has(it.slug));

      // Daily-rotating seed — order is stable within a day, rotates overnight.
      const day = Math.floor(Date.now() / 86400000);
      let seed = day * 9301 + 49297;
      const rng = () => {
        seed = (Math.imul(seed, 9301) + 49297) | 0;
        // Map to [0, 1)
        return ((seed >>> 0) % 233280) / 233280;
      };

      // Fisher-Yates
      const shuffled = [...rest];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      // Anti-cluster pass: if two neighbors' scores are within threshold,
      // swap the second one with a later item that differs sufficiently.
      for (let i = 0; i < shuffled.length - 1; i++) {
        if (Math.abs(shuffled[i].score - shuffled[i + 1].score) < CLUSTER_THRESHOLD) {
          for (let j = i + 2; j < shuffled.length; j++) {
            const differsFromI = Math.abs(shuffled[i].score - shuffled[j].score) >= CLUSTER_THRESHOLD;
            const wouldNotClusterBack = i + 2 >= shuffled.length ||
              Math.abs(shuffled[j].score - shuffled[i + 2].score) >= CLUSTER_THRESHOLD;
            if (differsFromI && wouldNotClusterBack) {
              [shuffled[i + 1], shuffled[j]] = [shuffled[j], shuffled[i + 1]];
              break;
            }
          }
        }
      }

      return [...pinned, ...shuffled];
    }

    function render() {
      let items = [...window.COVERAGE_DATA];

      // Filter — station
      const station = filterStation ? filterStation.value : 'all';
      if (station !== 'all') {
        items = items.filter(it => it.station.toLowerCase() === station);
      }
      // Filter — decade
      const decade = filterDecade ? filterDecade.value : 'all';
      if (decade !== 'all') {
        items = items.filter(it => it.decade === decade);
      }

      // Sort
      const mode = sortBy ? sortBy.value : 'editor';

      if (mode === 'editor') {
        // Editor's Cut: pin 3 openers, shuffle the rest with daily-rotating
        // seed, then walk the result swapping out adjacent items whose scores
        // sit within 1.5 of each other to prevent ugly clusters.
        items = editorCut(items);
      } else {
        const cmp = {
          'file':       (a, b) => a.file.localeCompare(b.file),
          'score-asc':  (a, b) => a.score - b.score,
          'score-desc': (a, b) => b.score - a.score,
          'year-asc':   (a, b) => a.year - b.year,
          'year-desc':  (a, b) => b.year - a.year,
          'title':      (a, b) => a.title.localeCompare(b.title)
        }[mode] || ((a, b) => 0);
        items.sort(cmp);
      }

      // Render
      listEl.innerHTML = items.map(it => `
        <a class="review-card" href="/reviews/${escapeHTML(it.slug)}.html">
          <div class="file-no">${escapeHTML(it.file)}</div>
          <div class="info">
            <h3>${escapeHTML(it.title)}</h3>
            <div class="meta">
              <span>${escapeHTML(String(it.year))}</span>
              <span>${escapeHTML(it.genre)}</span>
              <span>Written by ${escapeHTML(it.writer)}</span>
            </div>
          </div>
          <div class="mini-score">
            ${it.score.toFixed(1)}
            <span class="station" style="color:${it.station === 'CONSIDER' ? 'var(--pdf-blue)' : 'var(--redline)'}">${escapeHTML(it.station)}</span>
          </div>
        </a>
      `).join('');

      // Update count
      const countEl = document.querySelector('.section-head .count');
      if (countEl) {
        countEl.textContent = `${items.length} File${items.length === 1 ? '' : 's'} · Updated May 2026`;
      }
    }

    [sortBy, filterStation, filterDecade].forEach(el => {
      if (el) el.addEventListener('change', render);
    });

    render();
  }

  // ---------- Score Extremes sidebar widget ----------
  const highestListEl = document.getElementById('highest-list');
  const lowestListEl = document.getElementById('lowest-list');
  if (highestListEl && lowestListEl && window.COVERAGE_DATA) {
    const escapeHTML = (s) => String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
    const sortedDesc = [...window.COVERAGE_DATA].sort((a, b) => b.score - a.score);
    const top5 = sortedDesc.slice(0, 5);
    const bottom5 = sortedDesc.slice(-5).reverse();  // lowest-first

    const renderRow = (it, scoreClass) => `
      <li>
        <a href="/reviews/${escapeHTML(it.slug)}.html">
          <span class="title">${escapeHTML(it.title)}</span>
          <span class="score-num ${scoreClass}">${it.score.toFixed(1)}</span>
        </a>
      </li>
    `;

    highestListEl.innerHTML = top5.map(it => renderRow(it, 'high')).join('');
    lowestListEl.innerHTML = bottom5.map(it => renderRow(it, 'low')).join('');
  }

  // ---------- Most Read sidebar widget ----------
  // Live-tick: reads grow continuously based on elapsed hours since BASELINE.
  // Per-entry velocity varies by rank so the leaderboard can re-shuffle over time.
  // Why client-side: no cron, no commits, no credentials — just math on Date.now().
  const mostReadEl = document.getElementById('most-read-list');
  if (mostReadEl && window.MOST_READ && window.COVERAGE_DATA) {
    const escapeHTML = (s) => String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
    const coverageBySlug = Object.fromEntries(
      window.COVERAGE_DATA.map(it => [it.slug, it])
    );

    // Baseline timestamp — the moment the published reads counts in reviews-data.js
    // were "accurate." Every page load past this point bumps the counts upward.
    const BASELINE_MS = Date.UTC(2026, 4, 21, 12, 0, 0); // May 21, 2026 12:00 UTC
    const now = Date.now();
    const elapsedHours = Math.max(0, (now - BASELINE_MS) / 3600000);

    // Deterministic per-slug velocity (reads/hour). Higher = trends harder.
    // Hash the slug so each title has its own stable growth curve.
    const slugHash = (s) => {
      let h = 0;
      for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
      return Math.abs(h);
    };
    const velocityFor = (entry, idx) => {
      // Base velocity tied to original rank: top items trend harder.
      const base = [42, 36, 31, 27, 24, 21, 18, 16, 14, 12][idx] || 10;
      // Per-slug wobble so different titles outpace each other unevenly.
      const wobble = (slugHash(entry.slug) % 11) - 5; // -5..+5
      // Slow oscillation — some titles surge on weekly cycles, then cool.
      const wave = Math.sin((elapsedHours + slugHash(entry.slug) % 24) / 36) * 6;
      return Math.max(4, base + wobble + wave);
    };

    // Build live entries and re-sort by current reads so the chart can churn.
    const live = window.MOST_READ.map((entry, idx) => {
      const liveReads = Math.floor(entry.reads + elapsedHours * velocityFor(entry, idx));
      return { ...entry, liveReads, origIdx: idx };
    }).sort((a, b) => b.liveReads - a.liveReads);

    // Flame badges — top 3 get full heat, 4-6 get a single flame.
    const flameFor = (idx) => idx === 0 ? '🔥🔥🔥' : idx === 1 ? '🔥🔥' : idx <= 2 ? '🔥' : idx <= 5 ? '🔥' : '';

    mostReadEl.innerHTML = live.map((entry, idx) => {
      const cov = coverageBySlug[entry.slug];
      if (!cov) return '';
      const stationColor = cov.station === 'CONSIDER' ? 'var(--pdf-blue)' : 'var(--redline)';
      const flame = flameFor(idx);
      const heatClass = idx === 0 ? ' heat-blaze' : idx <= 2 ? ' heat-hot' : '';
      return `
        <li>
          <a href="/reviews/${escapeHTML(cov.slug)}.html">
            <span class="rank">${String(idx + 1).padStart(2, '0')}</span>
            <div class="info">
              <div class="title${heatClass}">${flame ? `<span class="flame">${flame}</span> ` : ''}${escapeHTML(cov.title)}</div>
              <div class="meta">
                <span class="score" style="color:${stationColor}">${cov.score.toFixed(1)} · ${escapeHTML(cov.station)}</span>
                <span class="reads">${entry.liveReads.toLocaleString()} reads</span>
              </div>
            </div>
          </a>
        </li>
      `;
    }).join('');
  }

  // ---------- Prev/Next pager (review pages) ----------
  // Injects a bottom-of-page navigator linking to the prior and next coverage
  // file in canonical (file-number) order. No HTML edits required — runs
  // entirely from script.js, so it works on the hand-built Chinatown page too.
  (function injectCoveragePager() {
    const match = window.location.pathname.match(/^\/reviews\/(.+?)\.html?$/);
    if (!match || !window.COVERAGE_DATA) return;
    const currentSlug = match[1];

    const sorted = [...window.COVERAGE_DATA].sort((a, b) => a.file.localeCompare(b.file));
    const idx = sorted.findIndex(it => it.slug === currentSlug);
    if (idx === -1) return;

    const prev = idx > 0 ? sorted[idx - 1] : null;
    const next = idx < sorted.length - 1 ? sorted[idx + 1] : null;
    if (!prev && !next) return;

    const esc = (s) => String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

    const slot = (it, dir) => {
      if (!it) return `<div class="pager-slot pager-empty" aria-hidden="true"></div>`;
      const stationClass = it.station === 'CONSIDER' ? 'pager-consider' : 'pager-pass';
      const arrow = dir === 'prev' ? '←' : '→';
      const label = dir === 'prev' ? 'Previous File' : 'Next File';
      return `
        <a class="pager-slot pager-${dir}" href="/reviews/${esc(it.slug)}.html">
          <span class="pager-direction">${dir === 'prev' ? arrow + ' ' + label : label + ' ' + arrow}</span>
          <span class="pager-file">${esc(it.file)}</span>
          <span class="pager-title">${esc(it.title)}</span>
          <span class="pager-score ${stationClass}">${it.score.toFixed(1)} · ${esc(it.station)}</span>
        </a>
      `;
    };

    const nav = document.createElement('nav');
    nav.className = 'coverage-pager';
    nav.setAttribute('aria-label', 'Coverage file navigation');
    nav.innerHTML = `
      <div class="pager-meta">
        <span class="pager-meta-label">Ledger Position</span>
        <span class="pager-meta-pos">${String(idx + 1).padStart(2,'0')} / ${String(sorted.length).padStart(2,'0')}</span>
        <a class="pager-index-link" href="/">Return to Index</a>
      </div>
      <div class="pager-row">
        ${slot(prev, 'prev')}
        ${slot(next, 'next')}
      </div>
    `;

    const footer = document.querySelector('.site-footer');
    if (footer && footer.parentNode) {
      footer.parentNode.insertBefore(nav, footer);
    }
  })();

  // ---------- Keyboard navigation (review pages: ← →) ----------
  (function injectKeyboardPager() {
    const match = window.location.pathname.match(/^\/reviews\/(.+?)\.html?$/);
    if (!match || !window.COVERAGE_DATA) return;
    const currentSlug = match[1];
    const sorted = [...window.COVERAGE_DATA].sort((a, b) => a.file.localeCompare(b.file));
    const idx = sorted.findIndex(it => it.slug === currentSlug);
    if (idx === -1) return;

    document.addEventListener('keydown', (e) => {
      // Ignore when user is typing in a form field
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft' && idx > 0) {
        window.location.href = `/reviews/${sorted[idx - 1].slug}.html`;
      } else if (e.key === 'ArrowRight' && idx < sorted.length - 1) {
        window.location.href = `/reviews/${sorted[idx + 1].slug}.html`;
      }
    });
  })();

  // ---------- Share button (review pages) ----------
  document.querySelectorAll('[data-share]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const url = window.location.href;
      const title = document.title;
      const text = btn.dataset.shareText || title;

      if (navigator.share) {
        try {
          await navigator.share({ title, text, url });
          return;
        } catch (_) { /* user cancelled — fall through to clipboard */ }
      }

      try {
        await navigator.clipboard.writeText(url);
        const original = btn.textContent;
        btn.textContent = 'Link Copied';
        setTimeout(() => { btn.textContent = original; }, 1800);
      } catch (_) {
        window.prompt('Copy this URL:', url);
      }
    });
  });

  // ---------- Re-render on bfcache restore ----------
  window.addEventListener('pageshow', (e) => {
    if (e.persisted && listEl && window.COVERAGE_DATA) {
      // re-trigger render in case sort/filter state was preserved
      const changeEvent = new Event('change');
      const sortBy = document.getElementById('sort-by');
      if (sortBy) sortBy.dispatchEvent(changeEvent);
    }
  });
})();
