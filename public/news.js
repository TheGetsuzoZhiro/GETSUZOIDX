// news.js - UI untuk menampilkan daftar berita berdasarkan kategori

// Mapping dari slug URL ke kategori di database (huruf besar semua)
const CATEGORY_MAP = {
  buyback: 'BUY BACK AND BACKDOOR',
  akuisisi: 'AKUISISI AND MERGER',
  private: 'PRIVATE PLACEMENT',
  rightissue: 'RIGHT ISSUE',
  dividen: 'DIVIDEN',
  labarugi: 'LABA RUGI',
  tender: 'TENDER OFFER',
  net: 'NET SELL AND NET BUY ASING',
  konglomerasi: 'KONGLOMERASI',
  sentimen: 'SENTIMEN LAINYA'
};

/**
 * Memuat berita berdasarkan kategori (harus dalam huruf besar, sesuai database)
 */
async function loadNews(category) {
  const container = document.getElementById('news');
  if (!container) {
    console.warn('Element #news tidak ditemukan');
    return;
  }

  // Tampilkan loading
  container.innerHTML = `
    <div class="loading-state">
      <div class="loader">
        <div class="loader-ring"></div>
        <div class="loader-ring"></div>
        <div class="loader-ring"></div>
      </div>
      <p>Memuat berita untuk <strong>${escapeHtml(category)}</strong>...</p>
    </div>
  `;

  try {
    const url = `/api/news?category=${encodeURIComponent(category)}&limit=50`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();

    if (!data || data.length === 0) {
      container.innerHTML = `
        <div class="news-empty">
          <i class="fas fa-newspaper"></i>
          <p>Belum ada berita untuk kategori <strong>${escapeHtml(category)}</strong></p>
        </div>
      `;
      return;
    }

    // Render kartu berita
    container.innerHTML = `
      <div class="news-header">
        <h2 class="news-category-title">
          <i class="fas fa-tag" style="color:#8b5cf6; margin-right:0.5rem;"></i>
          ${escapeHtml(category)}
        </h2>
        <span class="news-count">${data.length} berita</span>
      </div>
      <div class="news-grid">
        ${data.map(news => renderNewsCard(news)).join('')}
      </div>
    `;

  } catch (error) {
    console.error('Error loading news:', error);
    container.innerHTML = `
      <div class="news-error">
        <i class="fas fa-circle-exclamation"></i>
        <p>Gagal memuat berita. Silakan coba lagi nanti.</p>
        <p style="font-size:0.7rem; opacity:0.5; margin-top:0.5rem;">${escapeHtml(error.message)}</p>
      </div>
    `;
  }
}

/**
 * Render satu kartu berita
 */
function renderNewsCard(news) {
  const published = news.publishedAt ? new Date(news.publishedAt) : null;
  const timeStr = published
    ? published.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    : '';

  const stockTags = (news.stockCodes || [])
    .filter(code => code && code.trim())
    .map(code => `<span class="news-stock-tag">${escapeHtml(code.trim())}</span>`)
    .join('');

  const imageHtml = news.imageUrl
    ? `<img src="${news.imageUrl}" alt="${escapeHtml(news.title)}" class="news-image" onerror="this.style.display='none'">`
    : `<div class="news-image-placeholder"><i class="fas fa-newspaper"></i></div>`;

  return `
    <div class="news-card">
      <div class="news-card-image">
        ${imageHtml}
      </div>
      <div class="news-card-body">
        <h3 class="news-title">
          <a href="${escapeHtml(news.link)}" target="_blank" rel="noopener noreferrer">
            ${escapeHtml(news.title)}
          </a>
        </h3>
        ${news.description ? `<p class="news-description">${escapeHtml(news.description)}</p>` : ''}
        <div class="news-meta">
          <span class="news-time"><i class="far fa-clock"></i> ${timeStr}</span>
          ${stockTags ? `<span class="news-stocks"><i class="fas fa-tags"></i> ${stockTags}</span>` : ''}
        </div>
        <a href="${escapeHtml(news.link)}" target="_blank" class="news-read-more">
          Baca Selengkapnya <i class="fas fa-arrow-right"></i>
        </a>
      </div>
    </div>
  `;
}

/**
 * Escape HTML (gunakan fungsi global jika ada, fallback)
 */
function escapeHtml(str) {
  if (!str) return '';
  if (typeof window.escapeHtml === 'function') return window.escapeHtml(str);
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================
// INIT – Jika halaman dimuat dengan hash #news-*, langsung load
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  const hash = window.location.hash;
  if (hash.startsWith('#news-')) {
    const slug = hash.replace('#news-', '');
    const category = CATEGORY_MAP[slug] || slug.toUpperCase();
    if (category) {
      loadNews(category);
    }
  }
});

// Ekspos fungsi ke global agar bisa dipanggil dari script.js
window.loadNews = loadNews;
window.CATEGORY_MAP = CATEGORY_MAP;
