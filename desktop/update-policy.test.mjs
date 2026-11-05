import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeUpdatePreferences,
  resolveUpdateSupport,
} from "./update-policy.mjs";

test("新安装默认自动检查稳定通道", () => {
  assert.deepEqual(normalizeUpdatePreferences(), {
    autoCheck: true,
    channel: "stable",
  });
});

test("更新偏好只接受明确的关闭与稳定通道", () => {
  assert.deepEqual(
    normalizeUpdatePreferences({ autoCheck: false, channel: "stable" }),
    { autoCheck: false, channel: "stable" },
  );
  assert.deepEqual(
    normalizeUpdatePreferences({ autoCheck: "no", channel: "nightly" }),
    { autoCheck: true, channel: "stable" },
  );
});

test("保留用户主动选择的测试通道", () => {
  assert.deepEqual(normalizeUpdatePreferences({ channel: "preview" }), {
    autoCheck: true, channel: "preview",
  });
});

test("当前版本只在已打包的 Windows 应用中启用自动更新", () => {
  assert.deepEqual(
    resolveUpdateSupport({ isDevelopment: false, isPackaged: true, platform: "win32" }),
    { supported: true, reason: "" },
  );
  assert.equal(
    resolveUpdateSupport({ isDevelopment: true, isPackaged: false, platform: "win32" }).supported,
    false,
  );
  assert.equal(
    resolveUpdateSupport({ isDevelopment: false, isPackaged: true, platform: "darwin" }).supported,
    false,
  );
});
