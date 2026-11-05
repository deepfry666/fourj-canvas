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
      updater.emit("update-downloaded", { version: "2.0.0-beta.1" });
      resolveDownload();
    } };
}

test("新安装只检查正式发行，并禁止自动降级", async (t) => {
  const x = setup(t);
  await x.call("check-for-updates");
  assert.deepEqual(x.checks, [false]);
  assert.equal(x.updater.allowDowngrade, false);
  assert.equal(x.updater.autoDownload, false);
  assert.equal(x.updater.autoInstallOnAppQuit, false);
});

test("切换通道会使旧候选包失效并重新检查", async (t) => {
  const x = setup(t);
  x.call("set-update-preferences", { autoCheck: false, channel: "preview" });
  await tick();
  assert.equal(x.manager.getState().availableVersion, "2.0.0-beta.1");
  x.call("set-update-preferences", { autoCheck: false, channel: "stable" });
  await tick();
  assert.equal(x.manager.getState().availableVersion, "1.1.0");
  assert.equal(x.call("install-update"), false);
  assert.deepEqual(x.checks, [true, false]);
});

test("下载途中切回稳定通道，迟到的测试包不能进入可安装状态", async (t) => {
  const x = setup(t);
  x.call("set-update-preferences", { autoCheck: false, channel: "preview" });
  await tick();
  const download = x.call("download-update");
  x.call("set-update-preferences", { autoCheck: false, channel: "stable" });
  assert.equal(x.call("install-update"), false);
  x.finishDownload();
  await download;
  assert.equal(x.manager.getState().status, "available");
  assert.equal(x.manager.getState().availableVersion, "1.1.0");
  assert.equal(x.call("install-update"), false);
  assert.equal(x.installs(), 0);
});

test("已下载包在通道切换后不能安装，包括排队中的安装请求", async (t) => {
  const x = setup(t);
  x.call("set-update-preferences", { autoCheck: false, channel: "preview" });
  await tick();
  const download = x.call("download-update");
  x.finishDownload();
  await download;
  assert.equal(x.call("install-update"), true);
  x.call("set-update-preferences", { autoCheck: false, channel: "stable" });
  await tick();
  assert.equal(x.installs(), 0);
});

test("检查途中切换通道，旧检查结果被丢弃后按新通道重查", async (t) => {
  const x = setup(t);
  const normalCheck = x.updater.checkForUpdates;
  let finishCheck;
  x.updater.checkForUpdates = () => new Promise((resolve) => { finishCheck = resolve; });
  const pending = x.call("check-for-updates");
  x.call("set-update-preferences", { autoCheck: false, channel: "preview" });
  x.updater.emit("update-available", { version: "1.1.0" });
  assert.equal(x.manager.getState().availableVersion, "");
  x.updater.checkForUpdates = normalCheck;
  finishCheck();
  await pending;
  assert.equal(x.manager.getState().availableVersion, "2.0.0-beta.1");
});

test("同一通道的已下载更新仍可经用户操作安装", async (t) => {
  const x = setup(t);
  x.call("set-update-preferences", { autoCheck: false, channel: "preview" });
  await tick();
  const download = x.call("download-update");
  x.finishDownload();
  await download;
  assert.equal(x.call("install-update"), true);
  await tick();
  assert.equal(x.installs(), 1);
});
