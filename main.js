const { app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage, ipcMain, screen, desktopCapturer, systemPreferences } = require('electron');
const path = require('path');

// Global error handlers - log but don't crash
process.on('uncaughtException', (err) => {
  console.error('[leonel-quick] Uncaught exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[leonel-quick] Unhandled rejection:', reason);
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

let tray = null;
let win = null;
let lastScreenshot = null;
let pendingAuthUrl = null;

// Register custom protocol (must be before ready)
app.setAsDefaultProtocolClient('leonel-quick');

// macOS: open-url can fire before app is ready
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (win && !win.isDestroyed()) {
    handleProtocolUrl(url);
  } else {
    pendingAuthUrl = url;
  }
});

if (app.dock) app.dock.hide();

app.whenReady().then(() => {
  createTray();
  createWindow();
  registerShortcut();
  ipcMain.on('hide-window', () => hideWindow());
  ipcMain.handle('check-screen-permission', () => {
    if (process.platform === 'darwin') {
      return systemPreferences.getMediaAccessStatus('screen');
    }
    return 'granted';
  });
  ipcMain.handle('get-screenshot', () => lastScreenshot);

  // Trigger screen recording permission prompt on first launch
  desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }).catch(() => {});

  // Process pending auth URL (macOS: open-url may have fired before ready)
  if (pendingAuthUrl) {
    handleProtocolUrl(pendingAuthUrl);
    pendingAuthUrl = null;
  }

  // Windows: check argv for protocol URL on first launch
  const protocolArg = process.argv.find(a => a.startsWith('leonel-quick://'));
  if (protocolArg) handleProtocolUrl(protocolArg);
});

function createTray() {
  const isMac = process.platform === 'darwin';
  const shortcut = isMac ? '⌘L' : 'Ctrl+L';

  let icon;
  if (isMac) {
    const iconPath = path.join(__dirname, 'assets', 'iconTemplate.png');
    icon = nativeImage.createFromPath(iconPath);
    icon.setTemplateImage(true);
  } else {
    icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
  }

  tray = new Tray(icon);
  tray.setToolTip(`Quick by Leonel (${shortcut})`);
  tray.on('click', () => toggleWindow());

  const contextMenu = Menu.buildFromTemplate([
    { label: `Abrir (${shortcut})`, click: () => toggleWindow() },
    { type: 'separator' },
    { label: 'Reiniciar', click: () => {
      if (win && !win.isDestroyed()) win.loadURL('https://leonel.app/exam');
    }},
    { type: 'separator' },
    { label: 'Salir', click: () => app.exit(0) },
  ]);
  tray.on('right-click', () => tray.popUpContextMenu(contextMenu));
}

function getDefaultPosition() {
  const display = screen.getPrimaryDisplay();
  const { height: sh } = display.workAreaSize;
  return { x: 20, y: sh - 300 };
}

async function captureScreenshot() {
  try {
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('screen');
      if (status === 'denied') return null;
    }
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    });
    if (!sources || sources.length === 0) return null;
    const img = sources[0].thumbnail;
    if (img.isEmpty()) return null;
    const buf = img.toJPEG(70);
    if (buf.length < 5000) return null;
    // 5MB size limit
    if (buf.length > 5 * 1024 * 1024) return null;
    return buf.toString('base64');
  } catch (e) {
    return null;
  }
}

function createWindow() {
  const pos = getDefaultPosition();
  const isWin = process.platform === 'win32';

  win = new BrowserWindow({
    width: 340,
    height: 280,
    x: pos.x,
    y: pos.y,
    minWidth: 300,
    minHeight: 220,
    maxWidth: 600,
    maxHeight: 500,
    show: false,
    frame: false,
    resizable: true,
    movable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    backgroundColor: '#141414',
    roundedCorners: true,
    ...(isWin ? { type: 'toolbar', thickFrame: false } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Start on the main page so user can log in, then redirect to /exam
  win.loadURL('https://leonel.app');

  // After each page load, check if we should redirect to /exam
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(0.85);
    injectUI();
    checkAndRedirect();
  });

  // Also catch SPA navigations (e.g. after login)
  win.webContents.on('did-navigate-in-page', () => {
    checkAndRedirect();
  });

  // Send last screenshot when window becomes visible (fallback for tray click, etc.)
  win.on('show', () => {
    if (lastScreenshot && !win.isDestroyed()) {
      win.webContents.send('screenshot-captured', lastScreenshot);
    }
  });

  // Let leonel.app links navigate inside the window; external links open in browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.includes('leonel.app')) {
      win.loadURL(url);
    } else {
      require('electron').shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.on('close', (e) => {
    e.preventDefault();
    win.hide();
  });
}

function checkAndRedirect() {
  if (!win || win.isDestroyed()) return;

  const currentURL = win.webContents.getURL();

  // If already on /exam, we're good
  if (currentURL.includes('/exam')) return;

  // If on main page, check if logged in and redirect to /exam
  win.webContents.executeJavaScript(`
    (function() {
      // Check for Supabase auth token in localStorage
      var keys = Object.keys(localStorage);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].startsWith('sb-') && keys[i].includes('auth-token')) {
          return true;
        }
      }
      return false;
    })();
  `).then(hasAuth => {
    if (hasAuth) {
      win.loadURL('https://leonel.app/exam');
    }
  }).catch(() => {});
}

function injectUI() {
  if (!win || win.isDestroyed()) return;

  win.webContents.executeJavaScript(`
    (function() {
      // --- Drag bar (just for moving, no buttons) ---
      if (!document.getElementById('leonel-bar')) {
        var bar = document.createElement('div');
        bar.id = 'leonel-bar';
        bar.style.cssText = 'position:fixed;top:0;left:0;right:0;height:24px;-webkit-app-region:drag;z-index:99999;background:transparent;cursor:grab';
        document.body.prepend(bar);
      }

      // --- Escape to hide ---
      if (!window._leonelKeys) {
        window._leonelKeys = true;
        document.addEventListener('keydown', function(e) {
          if (e.key === 'Escape' && window.leonel) window.leonel.hide();
        });
      }

      // --- Drag & drop images ---
      if (!window._leonelDrop) {
        window._leonelDrop = true;

        document.addEventListener('dragover', function(e) {
          e.preventDefault();
          e.stopPropagation();
        });

        document.addEventListener('drop', function(e) {
          e.preventDefault();
          e.stopPropagation();

          var files = e.dataTransfer && e.dataTransfer.files;
          if (!files || files.length === 0) return;

          var file = files[0];
          if (!file.type.startsWith('image/')) return;

          var fileInput = document.querySelector('input[type="file"][accept="image/*"]');
          if (fileInput) {
            var dt = new DataTransfer();
            dt.items.add(file);
            fileInput.files = dt.files;
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });

        document.addEventListener('dragenter', function(e) {
          e.preventDefault();
          if (!document.getElementById('leonel-drop-overlay')) {
            var overlay = document.createElement('div');
            overlay.id = 'leonel-drop-overlay';
            overlay.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(255,131,0,0.1);border:2px dashed rgba(255,131,0,0.5);border-radius:16px;display:flex;align-items:center;justify-content:center;pointer-events:none';
            overlay.innerHTML = '<div style="background:rgba(0,0,0,0.7);padding:8px 16px;border-radius:10px;color:#FF8300;font-size:13px;font-weight:600">Suelta la imagen aqui</div>';
            document.body.appendChild(overlay);
          }
        });

        document.addEventListener('dragleave', function(e) {
          if (e.relatedTarget === null || e.relatedTarget === document.documentElement) {
            var ov = document.getElementById('leonel-drop-overlay');
            if (ov) ov.remove();
          }
        });

        document.addEventListener('drop', function() {
          var ov = document.getElementById('leonel-drop-overlay');
          if (ov) ov.remove();
        });
      }
    })();
  `).catch(() => {});
}

function hideWindow() {
  if (win && !win.isDestroyed() && win.isVisible()) {
    win.hide();
  }
}

function toggleWindow() {
  if (!win || win.isDestroyed()) {
    createWindow();
  }

  if (win.isVisible()) {
    win.hide();
    return;
  }

  // Show at default position/size
  const pos = getDefaultPosition();
  win.setBounds({ x: pos.x, y: pos.y, width: 340, height: 280 });
  win.show();
  win.focus();

  // Windows DPI workaround: re-apply bounds after show (first call can be wrong)
  if (process.platform === 'win32') {
    win.setBounds({ x: pos.x, y: pos.y, width: 340, height: 280 });
    win.setSkipTaskbar(true);
  }

  // Capture screenshot async AFTER showing (non-blocking)
  captureScreenshot().then(screenshot => {
    lastScreenshot = screenshot;
    if (win && !win.isDestroyed()) {
      win.webContents.send('screenshot-captured', screenshot);
    }
  });
}

function registerShortcut() {
  globalShortcut.register('CommandOrControl+L', () => toggleWindow());
}

app.on('window-all-closed', (e) => e.preventDefault());
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('second-instance', (_event, argv) => {
  // Windows: protocol URL comes in argv of second instance
  const protocolArg = argv.find(a => a.startsWith('leonel-quick://'));
  if (protocolArg) {
    handleProtocolUrl(protocolArg);
  } else {
    toggleWindow();
  }
});

function handleProtocolUrl(url) {
  try {
    if (typeof url !== 'string' || !url.startsWith('leonel-quick://')) {
      console.warn('[leonel-quick] Invalid protocol URL format');
      return;
    }

    const parsed = new URL(url);
    if (parsed.protocol !== 'leonel-quick:') return;

    const refreshToken = parsed.searchParams.get('rt');
    if (!refreshToken || refreshToken.length < 10 || refreshToken.length > 4096) {
      console.warn('[leonel-quick] Invalid or missing refresh token');
      return;
    }

    if (!win || win.isDestroyed()) createWindow();

    // Whitelist: only allow alphanumeric, hyphens, underscores, dots
    const sanitized = refreshToken.replace(/[^a-zA-Z0-9._-]/g, '');
    if (!sanitized || sanitized.length < 10) {
      console.warn('[leonel-quick] Token failed sanitization');
      return;
    }

    win.loadURL(`https://leonel.app/exam?quick_auth=${encodeURIComponent(sanitized)}`);
    win.show();
    win.focus();
  } catch (e) {
    console.error('[leonel-quick] Protocol handler error:', e.message);
  }
}
