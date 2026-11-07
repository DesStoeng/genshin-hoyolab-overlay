// Genshin HoYoLAB Overlay - Overlay Controller
// จัดการ Custom CSS และ Helper Scripts ในหน้าเว็บ HoYoLAB ให้แสดงผลแบบโปร่งใส สวยงาม คมชัด และตัดพื้นหลังสีดำออก 100%

const CLEAN_OVERLAY_CSS = `
  /* 1. ลบพื้นหลังทึบของ html, body, root, layout, และ leaflet-container เพื่อให้โปร่งใสทะลุจอเกม 100% */
  html,
  body,
  #root,
  .m-layout,
  .mhy-map-container,
  .mhy-game-gis,
  .mhy-map,
  .leaflet-container,
  .map-container,
  .leaflet-pane,
  .leaflet-tile-pane,
  .leaflet-tile-container {
    background: transparent !important;
    background-color: transparent !important;
  }

  /* 2. ซ่อนแถบ Header, Banner, QR Code, คุกกี้ และ UI ส่วนเกินของเว็บ HoYoLAB เพื่อความสะอาดและประหยัดทรัพยากร */
  header,
  .mhy-header,
  .hoyolab-header,
  .header-wrap,
  .header,
  .top-bar,
  .app-download-bar,
  .download-btn,
  .feedback-btn,
  .share-btn,
  .cookie-banner,
  .qr-code-wrap,
  .download-dialog,
  .user-guide,
  .mhy-hoyolab-app-header,
  .map-notice-bar,
  .bbs-qr,
  .bbs-qr__inner,
  .bbs-qr__th-th,
  .bbs-qr__en-us,
  [class*="bbs-qr"],
  .mihoyo-cookie-tips,
  .strong-tip-closable,
  .guide-mask,
  .driver-overlay,
  #gt-driver-overlay-path,
  .driver-popover {
    display: none !important;
  }

  /* Modals & Dialogs (เช่น Guide for Viewing Entrances, Layer Exploration, Correct Pin) ให้แสดงผลได้อย่างถูกต้อง คมชัด และปิดได้ */
  .gt-modal,
  .gt-popup-root,
  .correct-modal {
    pointer-events: auto !important;
  }

  .gt-modal .gt-modal__content,
  .correct-modal,
  .viewing-entrances-dialog,
  .layer-exploration-dialog {
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.85) !important;
    border-radius: 12px !important;
    pointer-events: auto !important;
  }

  /* ให้พื้นหลัง Mask ของ Modal มืดลงเล็กน้อยเพื่อให้เห็น Dialog ชัดเจน และคลิกปิดได้ */
  .gt-popup-layout__mask,
  .gt-modal__mask {
    background: rgba(0, 0, 0, 0.5) !important;
    backdrop-filter: blur(2px) !important;
    pointer-events: auto !important;
  }

  /* Loading Mask สำหรับสลับชั้นแผนที่ ให้โปร่งใส ไม่บดบัง และไม่ทำให้ระบบค้าง */
  .map-loading-mask {
    background: transparent !important;
    pointer-events: none !important;
  }

  /* 3. กรองพื้นหลังสีดำ/น้ำเงินเข้ม (#121921) ของทะเลและช่องว่างนอกขอบเขตแผนที่ออกให้โปร่งใส 100% ทะลุเห็นตัวเกม */
  .leaflet-tile,
  img.leaflet-tile,
  .leaflet-tile-loaded {
    filter: url(#remove-dark-bg) !important;
  }

  /* 4. ปรับความโปร่งใสของเนื้อแผนที่ (Tiles) - ปรับได้ตามใจชอบผ่าน F10 */
  .leaflet-tile-pane,
  .leaflet-tile-container,
  .map-tile,
  .leaflet-canvas-div-layer {
    opacity: var(--tile-opacity, 1.0) !important;
    transition: opacity 0.2s ease;
  }

  /* 5. ให้ไอคอนหมุด Oculi, หีบ, มอนสเตอร์ คมชัด 100% โดดเด่นบนจอเกม */
  .leaflet-marker-pane,
  .leaflet-marker-icon,
  .marker-container,
  .point-list,
  .point-item,
  .marker-icon {
    opacity: 1 !important;
    filter: drop-shadow(0 0 3px rgba(0, 0, 0, 0.95)) drop-shadow(0 0 6px rgba(0, 0, 0, 0.75)) !important;
    pointer-events: auto !important;
  }

  /* 6. หน้าต่าง Popup ตอนกดดูรายละเอียดหมุด */
  .leaflet-popup,
  .point-detail-dialog,
  .info-window {
    opacity: 0.98 !important;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.85) !important;
    border-radius: 8px !important;
    pointer-events: auto !important;
  }

  /* 7. Sidebar แถบตัวเลือกหมุดด้านซ้าย (Filter Panel) - ย่อซ่อนอัตโนมัติในโหมด Overlay */
  .filter-panel {
    transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease !important;
    z-index: 1000 !important;
  }

  /* เมื่อเปิดโหมด Overlay ให้ย่อซ่อนไปทางซ้าย ไม่บดบังสายตาในเกม */
  body.overlay-mode .filter-panel {
    transform: translateX(-370px) !important;
    opacity: 0.25 !important;
  }

  /* เมื่อชี้เมาส์ที่แถบซ้าย ให้เลื่อนเปิดออกมารับการคลิกอย่างนุ่มนวล */
  body.overlay-mode .filter-panel:hover,
  body.overlay-mode.overlay-sidebar-pinned .filter-panel {
    transform: translateX(0) !important;
    opacity: 0.96 !important;
  }
`;

const SCRIPT_OVERLAY_HELPER = `
  (() => {
    // 1. ฟังก์ชันติดตั้ง SVG Filter ตัดพื้นหลังสีดำ (#121921) ให้โปร่งใส 100%
    function ensureDarkRemovalFilter() {
      let svg = document.getElementById('__hoyo_dark_remover_svg');
      if (!svg) {
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.id = '__hoyo_dark_remover_svg';
        svg.setAttribute('style', 'position:absolute; width:0; height:0; pointer-events:none; overflow:hidden;');
        svg.innerHTML = \`
          <defs>
            <filter id="remove-dark-bg" color-interpolation-filters="sRGB">
              <feColorMatrix type="matrix"
                values="0 0 0 0 0
                        0 0 0 0 0
                        0 0 0 0 0
                        0.2126 0.7152 0.0722 0 0"
                result="luma" />
              <feComponentTransfer in="luma" result="alphaMask">
                <feFuncA type="linear" slope="4.5" intercept="-0.45" />
              </feComponentTransfer>
              <feComposite in="SourceGraphic" in2="alphaMask" operator="in" />
            </filter>
          </defs>
        \`;
        (document.documentElement || document.body).appendChild(svg);
      }
    }
    ensureDarkRemovalFilter();

    // 2. ปิดและล้าง Overlay ของ Onboarding Tutorial อัตโนมัติ
    function dismissDriverTutorial() {
      try {
        localStorage.setItem('user_guide_finish', 'true');
        localStorage.setItem('has_shown_guide', 'true');
      } catch {}
      document.querySelectorAll('.driver-overlay, #gt-driver-overlay-path, .driver-popover').forEach(el => el.remove());
      document.body.classList.remove('driver-active', 'driver-fade');
    }
    dismissDriverTutorial();

    // 3. ฟังก์ชันสลับการตรึงแถบเลือกหมุด (Sidebar)
    window.__toggleSidebarPinned = function() {
      const isPinned = document.body.classList.toggle('overlay-sidebar-pinned');
      return isPinned;
    };

    // 4. ฟังก์ชันปรับความโปร่งใสของพื้นหลังแผนที่
    window.__setTileOpacity = function(val) {
      document.documentElement.style.setProperty('--tile-opacity', String(val));
      let style = document.getElementById('__hoyo_tile_opacity_style');
      if (!style) {
        style = document.createElement('style');
        style.id = '__hoyo_tile_opacity_style';
        document.head.appendChild(style);
      }
      style.textContent = '.leaflet-tile-pane, .leaflet-tile-container, .map-tile, .leaflet-canvas-div-layer { opacity: ' + val + ' !important; }';
    };

    return true;
  })()
`;

module.exports = {
  CLEAN_OVERLAY_CSS,
  SCRIPT_OVERLAY_HELPER,
};
