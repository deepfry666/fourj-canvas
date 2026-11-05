import electronUpdater from "electron-updater";

import {
  normalizeUpdatePreferences,
  resolveUpdateSupport,
} from "./update-policy.mjs";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INITIAL_CHECK_DELAY_MS = 15 * 1000;

export function createUpdateManager({ app, ipcMain, isDevelopment, getWindow, beforeInstall,
  updater = electronUpdater.autoUpdater, platform = process.platform }) {
  const autoUpdater = updater;
  const support = resolveUpdateSupport({
    isDevelopment,
    isPackaged: app.isPackaged,
    platform,
  });
  let preferences = normalizeUpdatePreferences();
  let operation = null;
  let operationChannel = preferences.channel;
  let queuedCheck = false;
  let downloadedChannel = null;
  let initialTimer = null;
  let intervalTimer = null;
  let state = {
    status: support.supported ? "idle" : "unsupported",
    currentVersion: app.getVersion(),
    availableVersion: "",
    percent: 0,
    transferred: 0,
    total: 0,
    message: support.reason,
    checkedAt: "",
    manual: false,
  };

  const sendState = (patch = {}) => {
    state = { ...state, ...patch };
    const window = getWindow();
    if (window && !window.isDestroyed())
      window.webContents.send("desktop:update-state", state);
    return state;
  };

  const acceptsEvent = () => operation !== null && !queuedCheck &&
    operationChannel === preferences.channel;
  const fail = (error) => {
    if (!acceptsEvent()) return;
    sendState({
      status: "error",
      message: updateErrorMessage(error),
      checkedAt: new Date().toISOString(),
    });
  };

  const resetCandidate = () => {
    downloadedChannel = null;
    return sendState({ status: support.supported ? "idle" : "unsupported",
      availableVersion: "", percent: 0, transferred: 0, total: 0, message: support.reason });
  };

  const finishOperation = async () => {
    operation = null;
    if (queuedCheck) {
      queuedCheck = false;
      resetCandidate();
      await checkForUpdates(true);
    }
  };

  const checkForUpdates = async (manual = false) => {
    if (!support.supported) return sendState({ manual, message: support.reason });
    if (operation) return state;
    operation = "check";
    operationChannel = preferences.channel;
    downloadedChannel = null;
    autoUpdater.allowPrerelease = operationChannel === "preview";
    autoUpdater.allowDowngrade = false;
    sendState({ status: "checking", message: "", manual });
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      fail(error);
    } finally {
      await finishOperation();
    }
    return state;
  };

  const downloadUpdate = async () => {
    if (!support.supported || operation || state.status !== "available" ||
        operationChannel !== preferences.channel) return state;
    operation = "download";
    sendState({ status: "downloading", percent: 0, transferred: 0, total: 0, message: "" });
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      fail(error);
    } finally {
      await finishOperation();
    }
    return state;
  };

  const clearSchedule = () => {
    if (initialTimer) clearTimeout(initialTimer);
    if (intervalTimer) clearInterval(intervalTimer);
    initialTimer = null;
    intervalTimer = null;
  };

  const scheduleChecks = () => {
    clearSchedule();
    if (!support.supported || !preferences.autoCheck) return;
    initialTimer = setTimeout(() => void checkForUpdates(false), INITIAL_CHECK_DELAY_MS);
    intervalTimer = setInterval(() => void checkForUpdates(false), CHECK_INTERVAL_MS);
  };

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.on("checking-for-update", () =>
    acceptsEvent() && sendState({ status: "checking", message: "" }),
  );
  autoUpdater.on("update-available", (info) =>
    acceptsEvent() && sendState({
      status: "available",
      availableVersion: info.version || "",
      checkedAt: new Date().toISOString(),
      message: "",
    }),
  );
  autoUpdater.on("update-not-available", () =>
    acceptsEvent() && sendState({
      status: "not-available",
      availableVersion: "",
      checkedAt: new Date().toISOString(),
      message: "",
    }),
  );
  autoUpdater.on("download-progress", (progress) =>
    acceptsEvent() && sendState({
      status: "downloading",
      percent: Number.isFinite(progress.percent) ? progress.percent : 0,
      transferred: Number.isFinite(progress.transferred) ? progress.transferred : 0,
      total: Number.isFinite(progress.total) ? progress.total : 0,
    }),
  );
  autoUpdater.on("update-downloaded", (info) => {
    if (!acceptsEvent()) return;
    downloadedChannel = operationChannel;
    sendState({
      status: "downloaded",
      availableVersion: info.version || state.availableVersion,
      percent: 100,
      checkedAt: new Date().toISOString(),
      message: "",
    });
  });
  autoUpdater.on("error", fail);

  ipcMain.handle("desktop:get-update-state", () => state);
  ipcMain.handle("desktop:set-update-preferences", (event, value) => {
    if (event.sender !== getWindow()?.webContents) return state;
    const next = normalizeUpdatePreferences(value);
    const channelChanged = next.channel !== preferences.channel;
    preferences = next;
    if (channelChanged) {
      resetCandidate();
      if (operation) queuedCheck = true;
      else void checkForUpdates(true);
    }
    scheduleChecks();
    return state;
  });
  ipcMain.handle("desktop:check-for-updates", (event) => {
    if (event.sender !== getWindow()?.webContents) return state;
    return checkForUpdates(true);
  });
  ipcMain.handle("desktop:download-update", (event) => {
    if (event.sender !== getWindow()?.webContents) return state;
    return downloadUpdate();
  });
  ipcMain.handle("desktop:install-update", (event) => {
    if (event.sender !== getWindow()?.webContents || operation ||
        state.status !== "downloaded" || downloadedChannel !== preferences.channel)
      return false;
    const version = state.availableVersion;
    setImmediate(() => {
      if (operation || state.status !== "downloaded" ||
          downloadedChannel !== preferences.channel || state.availableVersion !== version) return;
      beforeInstall();
      autoUpdater.quitAndInstall(false, true);
    });
    return true;
  });

  return { getState: () => state, clearSchedule };
}

function updateErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || "未知更新错误");
  return message.replace(/gh[opusr]_[A-Za-z0-9_]+/g, "[已隐藏凭据]").slice(0, 500);
}
