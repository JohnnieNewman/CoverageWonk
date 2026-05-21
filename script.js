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
              <span>${escapeHTML(it.director)}</span>
              <span>${escapeHTML(String(it.pages))} pp.</span>
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
