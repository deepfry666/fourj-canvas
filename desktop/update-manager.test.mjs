import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createUpdateManager } from "./update-manager.mjs";

const tick = () => new Promise((resolve) => setImmediate(resolve));
function setup(t) {
  const updater = new EventEmitter();
  const handlers = new Map();
  const webContents = { send() {} };
  const event = { sender: webContents };
  const checks = [];
  let channel = "beta";
  Object.defineProperty(updater, "channel", {
    get: () => channel,
    set: (value) => { channel = value; updater.allowDowngrade = true; },
  });
  let resolveDownload;
  let installs = 0;
  updater.checkForUpdates = async () => {
    checks.push(updater.allowPrerelease);
    updater.emit("update-available", { version: updater.allowPrerelease ? "2.0.0-beta.1" : "1.1.0" });
  };
  updater.downloadUpdate = () => new Promise((resolve) => { resolveDownload = resolve; });
  updater.quitAndInstall = () => { installs++; };
  const manager = createUpdateManager({ updater, platform: "win32",
    app: { isPackaged: true, getVersion: () => "1.0.0" },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    isDevelopment: false, getWindow: () => ({ webContents, isDestroyed: () => false }),
    beforeInstall() {},
  });
  t.after(manager.clearSchedule);
  const call = (name, value) => handlers.get(`desktop:${name}`)(event, value);
  return { updater, manager, call, checks, installs: () => installs,
    finishDownload: () => {
      updater.emit("update-downloaded", { version: "1.1.0" });
      resolveDownload();
    } };
}

test("新安装只检查正式发行，并禁止自动降级", async (t) => {
  const x = setup(t);
  await x.call("check-for-updates");
  assert.deepEqual(x.checks, [false]);
  assert.equal(x.updater.channel, "latest");
  assert.equal(x.updater.allowDowngrade, false);
  assert.equal(x.updater.autoDownload, false);
  assert.equal(x.updater.autoInstallOnAppQuit, false);
});

test("旧测试偏好不能启用预发布，手动检查只读取正式版", async (t) => {
  const x = setup(t);
  x.call("set-update-preferences", { autoCheck: false, channel: "preview" });
  await x.call("check-for-updates");
  assert.equal(x.manager.getState().availableVersion, "1.1.0");
  x.call("set-update-preferences", { autoCheck: false, channel: "stable" });
  await tick();
  assert.equal(x.manager.getState().availableVersion, "1.1.0");
  assert.equal(x.call("install-update"), false);
  assert.deepEqual(x.checks, [false]);
  assert.equal(x.updater.channel, "latest");
});

test("下载途中传入旧测试偏好不会改变正式版候选包", async (t) => {
  const x = setup(t);
  x.call("set-update-preferences", { autoCheck: false, channel: "preview" });
  await x.call("check-for-updates");
  const download = x.call("download-update");
  x.call("set-update-preferences", { autoCheck: false, channel: "stable" });
  assert.equal(x.call("install-update"), false);
  x.finishDownload();
  await download;
  assert.equal(x.manager.getState().status, "downloaded");
  assert.equal(x.manager.getState().availableVersion, "1.1.0");
  assert.equal(x.updater.allowPrerelease, false);
  assert.equal(x.installs(), 0);
});

test("正式版下载完成后排队安装不受旧测试偏好影响", async (t) => {
  const x = setup(t);
  x.call("set-update-preferences", { autoCheck: false, channel: "preview" });
  await x.call("check-for-updates");
  const download = x.call("download-update");
  x.finishDownload();
  await download;
  assert.equal(x.call("install-update"), true);
  x.call("set-update-preferences", { autoCheck: false, channel: "stable" });
  await tick();
  assert.equal(x.installs(), 1);
});

test("检查途中传入旧测试偏好不会切换到测试版清单", async (t) => {
  const x = setup(t);
  const normalCheck = x.updater.checkForUpdates;
  let finishCheck;
  x.updater.checkForUpdates = () => new Promise((resolve) => { finishCheck = resolve; });
  const pending = x.call("check-for-updates");
  x.call("set-update-preferences", { autoCheck: false, channel: "preview" });
  x.updater.emit("update-available", { version: "1.1.0" });
  assert.equal(x.manager.getState().availableVersion, "1.1.0");
  x.updater.checkForUpdates = normalCheck;
  finishCheck();
  await pending;
  assert.equal(x.manager.getState().availableVersion, "1.1.0");
  assert.equal(x.updater.channel, "latest");
  assert.equal(x.updater.allowPrerelease, false);
});

test("正式版已下载更新仍可经用户操作安装", async (t) => {
  const x = setup(t);
  x.call("set-update-preferences", { autoCheck: false, channel: "preview" });
  await x.call("check-for-updates");
  const download = x.call("download-update");
  x.finishDownload();
  await download;
  assert.equal(x.call("install-update"), true);
  await tick();
  assert.equal(x.installs(), 1);
});
