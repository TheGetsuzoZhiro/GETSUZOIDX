import { CATEGORY_MAP } from "./config.js";
import { escapeHtml, isNewNews, getCategoryIconHtml, renderStockTagsHtml, formatFullDateTime } from "./utils.js";
import { fetchNews, fetchNewsByStock } from "./api.js";

// ===== NEWS =====

let _isUpdatingNewsHash = false;

export function handleImageError(imgElement, newsUrl) {
  if (!imgElement.dataset.triedMicrolink) {
    imgElement.dataset.triedMicrolink = "true";
    imgElement.src = `https://api.microlink.io/?url=${encodeURIComponent(newsUrl)}&embed=image.url`;
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "news-image-placeholder";
    if (imgElement.style.height) {
      placeholder.style.height = imgElement.style.height;
    }
    placeholder.innerHTML = '<i class="fas fa-newspaper"></i>';
    if (imgElement.parentNode) {
      imgElement.parentNode.replaceChild(placeholder, imgElement);
    }
  }
}

export function renderNewsCard(news) {
  const published = news.publishedAt ? new Date(news.publishedAt) : null;
  const timeStr = published
    ? published.toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  const isNew = isNewNews(news.publishedAt);
  const newRibbonHtml = isNew ? `<div class="ribbon-new-green">NEW</div>` : "";
  const stockTags = renderStockTagsHtml(news.stockCodes);

  const microlinkUrl = `https://api.microlink.io/?url=${encodeURIComponent(news.link)}&embed=image.url`;
  const imgSrc = news.imageUrl || microlinkUrl;
  const imageHtml = `<img src="${imgSrc}" alt="${escapeHtml(news.title)}" class="news-image" loading="lazy" onerror="handleImageError(this, '${escapeHtml(news.link)}')">`;

  const categoryBadgeHtml = news.category
    ? `<div class="news-category-badge">${getCategoryIconHtml(news.category)}<span>${escapeHtml(news.category)}</span></div>`
    : "";

  return `
    <div class="news-card">
      <div class="news-card-image news-image-wrapper">
        ${newRibbonHtml}
        ${imageHtml}
      </div>
      <div class="news-card-body">
        ${categoryBadgeHtml}
        <h3 class="news-title">
          <a href="${escapeHtml(news.link)}" target="_blank" rel="noopener noreferrer">
            ${escapeHtml(news.title)}
          </a>
        </h3>
        ${news.description ? `<p class="news-description">${escapeHtml(news.description)}</p>` : ""}
        <div class="news-meta">
          <span class="news-time"><i class="far fa-clock"></i> ${timeStr}</span>
          ${stockTags ? `<div class="news-stocks">${stockTags}</div>` : ""}
        </div>
        <a href="${escapeHtml(news.link)}" target="_blank" class="news-read-more">
          Baca Selengkapnya <i class="fas fa-arrow-right"></i>
        </a>
      </div>
    </div>
  `;
}

export async function loadNews(category, page = 1) {
  const container = document.getElementById("news");
  if (!container) return;

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
    const resData = await fetchNews(category, page);
    const data = resData.data || resData;
    const pagination = resData.pagination || { totalPages: 1, currentPage: 1 };

    if (!data || data.length === 0) {
      container.innerHTML = `
        <div class="news-empty">
          <i class="fas fa-newspaper"></i>
          <p>Belum ada berita untuk kategori <strong>${escapeHtml(category)}</strong></p>
        </div>
      `;
      return;
    }

    let paginationHtml = "";
    if (pagination.totalPages > 1) {
      paginationHtml = `<div class="pagination-container">`;
      paginationHtml += `
        <button class="page-btn" ${page === 1 ? "disabled" : ""} onclick="loadNews('${category}', ${page - 1})">
          <i class="fas fa-chevron-left"></i>
        </button>
      `;
      const maxVisible = 5;
      let startPage = Math.max(1, page - Math.floor(maxVisible / 2));
      let endPage = startPage + maxVisible - 1;
      if (endPage > pagination.totalPages) {
        endPage = pagination.totalPages;
        startPage = Math.max(1, endPage - maxVisible + 1);
      }
      for (let i = startPage; i <= endPage; i++) {
        paginationHtml += `
          <button class="page-btn ${i === page ? "active" : ""}" onclick="loadNews('${category}', ${i})">
            ${i}
          </button>
        `;
      }
      paginationHtml += `
        <button class="page-btn" ${page === pagination.totalPages ? "disabled" : ""} onclick="loadNews('${category}', ${page + 1})">
          <i class="fas fa-chevron-right"></i>
        </button>
      `;
      paginationHtml += `</div>`;
    }

    container.innerHTML = `
      <div class="news-header">
        <h2 class="news-category-title">
          <i class="fas fa-tag" style="color:#8b5cf6; margin-right:0.5rem;"></i>
          ${escapeHtml(category)}
        </h2>
        <span class="news-count">${pagination.totalItems || data.length} Berita</span>
      </div>
      <div class="news-grid">
        ${data.map((news) => renderNewsCard(news)).join("")}
      </div>
      ${paginationHtml}
    `;
  } catch (error) {
    console.error("Error loading news:", error);
    container.innerHTML = `
      <div class="news-error">
        <i class="fas fa-circle-exclamation"></i>
        <p>Gagal memuat berita.</p>
      </div>
    `;
  }
}

export async function mountStockNewsCarousel(stockCode, targetContainerId) {
  const container = document.getElementById(targetContainerId);
  if (!container) return;

  container.innerHTML = `
    <div style="font-size:0.75rem; color:var(--text-secondary); text-align:center; padding:0.5rem;">
      <i class="fas fa-spinner fa-spin"></i> Memuat berita ${escapeHtml(stockCode)}...
    </div>
  `;

  try {
    const newsList = await fetchNewsByStock(stockCode, 10);
    const data = Array.isArray(newsList) ? newsList : newsList.data || [];

    if (!data || data.length === 0) {
      container.innerHTML = `
        <div style="font-size:0.7rem; color:var(--text-secondary); opacity:0.6; padding:0.5rem 0.75rem;">
          <i class="far fa-newspaper" style="margin-right:0.3rem;"></i> Belum ada berita terkini untuk ${escapeHtml(stockCode)}.
        </div>
      `;
      return;
    }

    let currentIndex = 0;

    function renderSlide(index) {
      const news = data[index];
      const isNew = isNewNews(news.publishedAt);
      const newRibbon = isNew ? `<div class="ribbon-new-green">NEW</div>` : "";

      const published = news.publishedAt ? new Date(news.publishedAt) : null;
      const timeStr = published
        ? published.toLocaleDateString("id-ID", {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "";

      const categoryBadge = news.category
        ? `<div class="news-category-badge">${getCategoryIconHtml(news.category)}<span>${escapeHtml(news.category)}</span></div>`
        : "";

      const stockTags = renderStockTagsHtml(news.stockCodes);

      const imgHtml = news.imageUrl
        ? `<img src="${news.imageUrl}" style="width:100%; height:140px; object-fit:cover; border-radius:6px 6px 0 0;" onerror="handleImageError(this, '${escapeHtml(news.link)}')">`
        : `<div class="news-image-placeholder" style="height:140px;"><i class="fas fa-newspaper"></i></div>`;

      return `
        <div class="detail-news-carousel-container">
          <div class="detail-news-header">
            <span class="detail-news-title-text">
              <i class="fas fa-newspaper" style="color:#8b5cf6;"></i> Berita ${escapeHtml(stockCode)}
            </span>
            <div class="carousel-controls">
              <button class="carousel-btn" id="carouselPrevBtn" ${index === 0 ? "disabled" : ""}>
                <i class="fas fa-chevron-left"></i>
              </button>
              <span class="carousel-counter">${index + 1} / ${data.length}</span>
              <button class="carousel-btn" id="carouselNextBtn" ${index === data.length - 1 ? "disabled" : ""}>
                <i class="fas fa-chevron-right"></i>
              </button>
            </div>
          </div>
          <div class="carousel-slide-card news-image-wrapper">
            ${newRibbon}
            ${imgHtml}
            <div style="padding:0.75rem;">
              ${categoryBadge}
              <h4 style="font-size:0.85rem; font-weight:700; margin:0.3rem 0; line-height:1.35;">
                <a href="${escapeHtml(news.link)}" target="_blank" style="color:var(--text-primary); text-decoration:none;">
                  ${escapeHtml(news.title)}
                </a>
              </h4>
              ${news.description ? `<p style="font-size:0.7rem; color:var(--text-secondary); opacity:0.8; margin-bottom:0.5rem; line-clamp:2; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${escapeHtml(news.description)}</p>` : ""}
              <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.6rem; color:var(--text-secondary); opacity:0.8; margin-top:0.4rem;">
                <span><i class="far fa-clock"></i> ${timeStr}</span>
                ${stockTags ? `<div class="news-stocks">${stockTags}</div>` : ""}
              </div>
            </div>
          </div>
        </div>
      `;
    }

    function updateCarousel() {
      container.innerHTML = renderSlide(currentIndex);
      const prevBtn = container.querySelector("#carouselPrevBtn");
      const nextBtn = container.querySelector("#carouselNextBtn");
      if (prevBtn) {
        prevBtn.addEventListener("click", () => {
          if (currentIndex > 0) { currentIndex--; updateCarousel(); }
        });
      }
      if (nextBtn) {
        nextBtn.addEventListener("click", () => {
          if (currentIndex < data.length - 1) { currentIndex++; updateCarousel(); }
        });
      }
    }

    updateCarousel();
  } catch (err) {
    console.warn("Gagal memuat carousel berita emiten:", err);
    container.innerHTML = "";
  }
}

export function selectNewsCategory(category) {
  if (_isUpdatingNewsHash) return;
  const pageTitle = document.querySelector(".page-title");
  const pageSubtitle = document.querySelector(".page-subtitle");
  const titleKey = `news-${category}`;
  const titles = {
    "news-buyback": { t: "Buy Back & Backdoor", s: "Berita buy back dan backdoor" },
    "news-akuisisi": { t: "Akuisisi & Merger", s: "Berita akuisisi dan merger" },
    "news-private": { t: "Private Placement", s: "Berita private placement" },
    "news-rightissue": { t: "Right Issue", s: "Berita right issue" },
    "news-dividen": { t: "Dividen", s: "Berita dividen" },
    "news-labarugi": { t: "Laba Rugi", s: "Berita laba rugi" },
    "news-tender": { t: "Tender Offer", s: "Berita tender offer" },
    "news-net": { t: "Net Sell / Buy Asing", s: "Berita net asing" },
    "news-konglomerasi": { t: "Konglomerasi", s: "Berita konglomerasi" },
    "news-sentimen": { t: "Sentimen Lainnya", s: "Berita sentimen" },
  };

  if (titles[titleKey]) {
    pageTitle.innerText = titles[titleKey].t;
    pageSubtitle.innerText = titles[titleKey].s;
  } else {
    pageTitle.innerText = "Berita";
    pageSubtitle.innerText = "Kategori berita";
  }

  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById("news").classList.add("active");

  _isUpdatingNewsHash = true;
  window.location.hash = `#${titleKey}`;
  _isUpdatingNewsHash = false;

  const parent = document.getElementById("newsParent");
  const sub = document.getElementById("newsSubMenu");
  if (parent && sub) {
    parent.classList.add("open");
    sub.classList.add("open");
    sub.style.display = "block";
    const arrow = parent.querySelector(".nav-arrow");
    if (arrow) arrow.classList.add("open");
  }

  const realCategory = CATEGORY_MAP[category] || category.toUpperCase();
  loadNews(realCategory);

  document.querySelector(".sidebar")?.classList.remove("open");
  document.querySelector(".overlay")?.classList.remove("active");
}
