// Genshin HoYoLAB Overlay - Main Process (Ultra High Performance & Low Resource Edition)
// รันหน้าเว็บ Official Interactive Map ของ HoYoLAB เป็น Overlay บนเกม โดยตรง รวดเร็ว ลื่นไหล กินสเปกต่ำ
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { app, BrowserWindow, globalShortcut, Menu, Tray, screen, nativeImage } = require('electron');
const { CLEAN_OVERLAY_CSS, SCRIPT_OVERLAY_HELPER } = require('./overlay-controller');
const hotkeyHelper = require('./hotkey-helper');

// ตั้งค่า Chromium Switches เพื่อเปิดใช้ GPU Hardware Acceleration เต็มประสิทธิภาพและลื่นไหล
app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

const LOG_FILE = path.join(__dirname, '..', 'overlay.log');
function logOverlay(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {}
  console.log(line);
}

// ถ้าเป็นโหมด Hotkey Helper ให้รันกระบวนการย่อยดักจับคีย์ลัดด้วยสิทธิ์ Admin ทันที
if (hotkeyHelper.isHelperProcess()) {
  hotkeyHelper.runHelper();
  return;
}

const HOYOLAB_MAP_URL = 'https://act.hoyolab.com/ys/app/interactive-map/index.html?lang=en-us#/map/2';
const ICON_PATH = path.join(__dirname, '..', 'assets', 'icon.png');

let hoyoWin = null;
let tray = null;
let isOverlayMode = true; // ค่าเริ่มต้นเปิดในโหมด Overlay ทันที
let isOverlayHidden = false;
let isClickThrough = false; // เริ่มต้นสามารถคลิกมาร์กหมุดบนเว็บได้ทันที (กด F9 เพื่อคลิกทะลุไปในเกม)
let isSidebarPinned = false;

// ระดับความโปร่งใสของเนื้อแผนที่ (F10):
// 0.0=แสดงเฉพาะหมุดลอยบนเกม, 0.25=จาง, 0.50=ปานกลาง, 0.75=ค่อนข้างชัด, 1.0=ชัด 100% (ลบพื้นหลังดำออกหมด)
const OPACITY_STEPS = [0.0, 0.25, 0.50, 0.75, 1.0];
let opacityIndex = 4; // ค่าเริ่มต้น 1.0 (แสดงเนื้อแผนที่คมชัด 100% โดยตัดพื้นหลังสีดำของทะเลออกหมด)
let injectedCssKey = null;

// แมปปิ้งฟังก์ชันสำหรับคีย์ลัด
const HOTKEY_ACTIONS = {
  toggleSidebar: () => toggleSidebarPinned(),
  toggleVisibility: () => toggleVisibility(),
  toggleOverlay: () => toggleOverlayMode(),
  toggleClickThrough: () => setClickThrough(!isClickThrough),
  cycleOpacity: () => cycleTileOpacity(),
};

// เชื่อมต่อ Hotkey Helper (สิทธิ์ Admin) เพื่อให้กดปุ่มลัดได้แม้ในเกม Genshin Impact ที่รันด้วย Admin
const bridge = new hotkeyHelper.HotkeyBridge({
  onHotkey: (name) => {
    logOverlay(`Hotkey triggered: ${name}`);
    const action = HOTKEY_ACTIONS[name];
    if (action) action();
  },
  onStatus: ({ connected, errors }) => {
    logOverlay(`Hotkey helper status: connected=${connected}, errors=${JSON.stringify(errors || [])}`);
    if (connected && (!errors || errors.length === 0)) {
      try { globalShortcut.unregisterAll(); } catch {}
    } else if (!connected) {
      registerHotkeys();
    }
    updateTrayMenu();
  },
  log: (text) => logOverlay(`[Bridge] ${text}`),
});

function showStartupNotification(customMsg) {
  try {
    const { Notification } = require('electron');
    if (Notification.isSupported()) {
      const n = new Notification({
        title: 'Genshin HoYoLAB Overlay',
        body: customMsg || 'Ready to use! Press F7 to Show/Hide, F9 to Toggle Click Mode, F10 for Map Opacity',
        icon: ICON_PATH
      });
      n.show();
    }
  } catch {}
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    logOverlay('[App] Second instance attempted: focusing and showing window');
    if (hoyoWin && !hoyoWin.isDestroyed()) {
      if (isOverlayHidden) {
        toggleVisibility();
      } else {
        hoyoWin.setBounds(targetDisplay().bounds);
        hoyoWin.setOpacity(1);
        hoyoWin.setAlwaysOnTop(true, 'screen-saver', 1);
        hoyoWin.show();
        hoyoWin.focus();
        hoyoWin.moveTop();
      }
      showStartupNotification('HoYoLAB Overlay is already running! (Press F7 to Show/Hide, F9 for Click-through)');
    }
  });

  app.whenReady().then(initApp);
}

app.on('window-all-closed', (e) => e.preventDefault());
app.on('will-quit', () => globalShortcut.unregisterAll());

function targetDisplay() {
  return screen.getPrimaryDisplay();
}

async function initApp() {
  Menu.setApplicationMenu(null);
  createTray();
  registerHotkeys();

  // สร้างหน้าต่างหลัก HoYoLAB Overlay
  createHoyoWindow(true);

  // ตรวจจับ Genshin Impact เพื่อเชื่อมต่อ Hotkey Helper อัตโนมัติ
  checkGenshinImpact();
  setInterval(checkGenshinImpact, 5000);
}

// ตรวจสอบว่า Genshin Impact กำลังรันอยู่หรือไม่
function checkGenshinImpact() {
  try {
    const res = spawnSync('tasklist', ['/FI', 'IMAGENAME eq GenshinImpact.exe', '/NH'], { windowsHide: true, encoding: 'utf8' });
    const running = (res.stdout || '').includes('GenshinImpact.exe');
    if (running && !bridge.connected && !bridge.starting) {
      bridge.start().catch(() => {});
    }
  } catch {}
}

// ---------- 1. หน้าต่าง HoYoLAB Window ----------

function createHoyoWindow(overlayMode = true) {
  if (hoyoWin && !hoyoWin.isDestroyed()) {
    hoyoWin.destroy();
  }

  isOverlayMode = overlayMode;
  isOverlayHidden = false;
  const display = targetDisplay();

  const windowOptions = overlayMode
    ? {
        ...display.bounds,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        resizable: false,
        movable: false,
        alwaysOnTop: true,
        skipTaskbar: false,
        title: 'Genshin HoYoLAB Overlay',
        icon: ICON_PATH,
        webPreferences: {
          partition: 'persist:hoyolab',
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          backgroundThrottling: false,
        },
      }
    : {
        width: 1366,
        height: 850,
        center: true,
        frame: true,
        transparent: false,
        alwaysOnTop: false,
        skipTaskbar: false,
        title: 'HoYoLAB Interactive Map - Setup & Login',
        icon: ICON_PATH,
        webPreferences: {
          partition: 'persist:hoyolab',
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      };

  hoyoWin = new BrowserWindow(windowOptions);

  hoyoWin.webContents.setWindowOpenHandler(({ url }) => {
    if (url && url.startsWith('http')) {
      require('electron').shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  hoyoWin.webContents.on('render-process-gone', (e, details) => {
    logOverlay(`[Process] Render process gone: ${JSON.stringify(details)}`);
  });

  hoyoWin.webContents.on('unresponsive', () => {
    logOverlay('[Process] Window became unresponsive');
  });

  if (overlayMode) {
    hoyoWin.setAlwaysOnTop(true, 'screen-saver', 1);
    setClickThrough(isClickThrough);
  }

  hoyoWin.loadURL(HOYOLAB_MAP_URL);

  hoyoWin.webContents.on('dom-ready', async () => {
    try {
      await hoyoWin.webContents.executeJavaScript(SCRIPT_OVERLAY_HELPER);
      logOverlay('[HoYoLAB] Helper script injected on dom-ready');
    } catch {}
  });

  hoyoWin.webContents.on('did-finish-load', async () => {
    logOverlay('[HoYoLAB] Page finished loading');
    try {
      await hoyoWin.webContents.executeJavaScript(SCRIPT_OVERLAY_HELPER);
    } catch (e) {
      logOverlay(`[HoYoLAB] Helper script injection error: ${e.message}`);
    }

    if (isOverlayMode) {
      applyOverlayModeStyles();
    }
    showStartupNotification();
  });

  hoyoWin.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      toggleVisibility();
    }
  });

  updateTrayMenu();
}

async function applyOverlayModeStyles() {
  if (!hoyoWin || hoyoWin.isDestroyed()) return;

  try {
    if (injectedCssKey) {
      await hoyoWin.webContents.removeInsertedCSS(injectedCssKey);
    }
    injectedCssKey = await hoyoWin.webContents.insertCSS(CLEAN_OVERLAY_CSS);
    updateTileOpacity(OPACITY_STEPS[opacityIndex]);
    await hoyoWin.webContents.executeJavaScript(SCRIPT_OVERLAY_HELPER);
    await hoyoWin.webContents.executeJavaScript(`
      (() => {
        document.body.classList.add('overlay-mode');
        return true;
      })()
    `);
    logOverlay('[HoYoLAB] Overlay mode styles applied successfully');
  } catch (err) {
    logOverlay(`[HoYoLAB] CSS Injection failed: ${err.message}`);
  }
}

// ปรับระดับความโปร่งใสของพื้นหลังแผนที่ (F10)
function updateTileOpacity(val) {
  if (!hoyoWin || hoyoWin.isDestroyed()) return;
  const script = `
    if (typeof window.__setTileOpacity === 'function') {
      window.__setTileOpacity(${val});
    } else {
      document.documentElement.style.setProperty('--tile-opacity', '${val}');
      let style = document.getElementById('__hoyo_tile_opacity_style');
      if (!style) {
        style = document.createElement('style');
        style.id = '__hoyo_tile_opacity_style';
        document.head.appendChild(style);
      }
      style.textContent = '.leaflet-tile-pane, .leaflet-tile-container, .map-tile, .leaflet-canvas-div-layer { opacity: ${val} !important; }';
    }
  `;
  hoyoWin.webContents.executeJavaScript(script).catch(() => {});
}

// สลับโหมดคลิกทะลุจอ (F9)
function setClickThrough(enable) {
  isClickThrough = enable;
  if (hoyoWin && !hoyoWin.isDestroyed() && isOverlayMode && !isOverlayHidden) {
    hoyoWin.setIgnoreMouseEvents(isClickThrough, { forward: true });
  }
  logOverlay(`[ClickThrough] isClickThrough=${isClickThrough}`);
  updateTrayMenu();
}

// สลับโหมดระหว่าง Overlay กับ หน้าต่างตั้งค่า (F8)
function toggleOverlayMode() {
  isOverlayMode = !isOverlayMode;
  createHoyoWindow(isOverlayMode);
}

// หมุนเวียนระดับความโปร่งใสของพื้นหลังแผนที่ (F10)
function cycleTileOpacity() {
  opacityIndex = (opacityIndex + 1) % OPACITY_STEPS.length;
  updateTileOpacity(OPACITY_STEPS[opacityIndex]);
  logOverlay(`[Opacity] Set tile opacity to ${OPACITY_STEPS[opacityIndex] * 100}%`);
  updateTrayMenu();
}

// สลับการตรึง / ย่อเก็บแถบเลือกหมุดด้านซ้าย (F6)
function toggleSidebarPinned() {
  if (!hoyoWin || hoyoWin.isDestroyed()) return;
  isSidebarPinned = !isSidebarPinned;
  hoyoWin.webContents.executeJavaScript(`
    if (typeof window.__toggleSidebarPinned === 'function') {
      window.__toggleSidebarPinned();
    }
  `).catch(() => {});
  updateTrayMenu();
}

// แสดง / ซ่อน Overlay อย่างรวดเร็วและแม่นยำ (F7)
function toggleVisibility() {
  if (!hoyoWin || hoyoWin.isDestroyed()) return;

  isOverlayHidden = !isOverlayHidden;
  logOverlay(`[Window] toggleVisibility: isOverlayHidden=${isOverlayHidden}`);

  if (isOverlayMode) {
    if (isOverlayHidden) {
      // ซ่อน Overlay โดยปรับ Opacity เป็น 0 และคลิกทะลุจอทันที
      hoyoWin.setOpacity(0);
      hoyoWin.setIgnoreMouseEvents(true, { forward: true });
    } else {
      // แสดง Overlay กลับมาทันที ทับบนเกม 100%
      hoyoWin.setBounds(targetDisplay().bounds);
      hoyoWin.setOpacity(1);
      hoyoWin.setIgnoreMouseEvents(isClickThrough, { forward: true });
      hoyoWin.setAlwaysOnTop(true, 'screen-saver', 1);
      hoyoWin.show();
      hoyoWin.moveTop();
    }
  } else {
    // โหมด Setup ปกติ
    if (isOverlayHidden) {
      hoyoWin.hide();
    } else {
      hoyoWin.show();
      hoyoWin.focus();
    }
  }

  updateTrayMenu();
}

// ---------- 2. คีย์ลัด (Hotkeys) ----------

function registerHotkeys() {
  const hotkeys = {
    toggleSidebar: 'F6',
    toggleVisibility: 'F7',
    toggleOverlay: 'F8',
    toggleClickThrough: 'F9',
    cycleOpacity: 'F10',
  };

  // 1. ส่งให้ Hotkey Helper (Admin) เพื่อดักจับปุ่มได้แม้เกม GenshinImpact.exe (Admin) กำลังโฟกัสอยู่
  bridge.setHotkeys(hotkeys);

  // 2. ถ้า Helper ยังไม่เชื่อมต่อ ให้ใช้ globalShortcut ของระบบเป็นการชั่วคราว
  if (!bridge.connected) {
    globalShortcut.unregisterAll();
    for (const [name, accelerator] of Object.entries(hotkeys)) {
      const action = HOTKEY_ACTIONS[name];
      if (action) {
        try {
          globalShortcut.register(accelerator, action);
        } catch {}
      }
    }
  }
}

// ---------- 3. System Tray Menu ----------

function createTray() {
  let img;
  if (fs.existsSync(ICON_PATH)) {
    img = nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
  } else {
    img = nativeImage.createEmpty();
  }

  tray = new Tray(img);
  tray.setToolTip('Genshin HoYoLAB Overlay');
  tray.on('click', toggleVisibility);
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;

  const opacityPercent = Math.round(OPACITY_STEPS[opacityIndex] * 100);
  const clickModeText = isClickThrough ? 'Click-through (In-Game)' : 'Interactive (Marking Pins)';
  const helperStatus = bridge.connected ? '✓ Active (Admin Privileges)' : 'Connecting...';

  tray.setToolTip(`Genshin HoYoLAB Overlay (${clickModeText})`);

  const menu = Menu.buildFromTemplate([
    {
      label: `Current Mode: ${isOverlayMode ? 'Overlay (In-Game)' : 'Setup & Login Mode'}`,
      enabled: false,
    },
    {
      label: `Mouse Mode: ${clickModeText}`,
      enabled: false,
    },
    {
      label: `Map Opacity: ${opacityPercent}%`,
      enabled: false,
    },
    {
      label: `Hotkey Helper: ${helperStatus}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: isOverlayHidden ? 'Show Overlay Window [F7]' : 'Hide Overlay Window [F7]',
      click: toggleVisibility,
    },
    {
      label: isClickThrough ? 'Switch to: Interactive Pin Mode [F9]' : 'Switch to: Click-through Game Mode [F9]',
      visible: isOverlayMode,
      click: () => setClickThrough(!isClickThrough),
    },
    {
      label: `Cycle Map Opacity (${opacityPercent}%) [F10]`,
      visible: isOverlayMode,
      click: cycleTileOpacity,
    },
    {
      label: isSidebarPinned ? 'Left Filter Panel: Pinned [F6]' : 'Left Filter Panel: Auto-collapse [F6]',
      visible: isOverlayMode,
      click: toggleSidebarPinned,
    },
    {
      label: isOverlayMode ? 'Switch to: Setup & Account Login Mode [F8]' : 'Switch to: Overlay Mode [F8]',
      click: toggleOverlayMode,
    },
    { type: 'separator' },
    {
      label: 'Quit Overlay',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
}
