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
      const mode = sortBy ? sortBy.value : 'file';
      const cmp = {
        'file':       (a, b) => a.file.localeCompare(b.file),
        'score-asc':  (a, b) => a.score - b.score,
        'score-desc': (a, b) => b.score - a.score,
        'year-asc':   (a, b) => a.year - b.year,
        'year-desc':  (a, b) => b.year - a.year,
        'title':      (a, b) => a.title.localeCompare(b.title)
      }[mode] || ((a, b) => 0);
      items.sort(cmp);

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
