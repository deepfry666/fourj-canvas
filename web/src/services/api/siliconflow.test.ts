import assert from "node:assert/strict";
import test from "node:test";

import { createSiliconFlowAdapter } from "./siliconflow.ts";
import type { ProviderInput, ProviderProfile, ProviderTransport } from "../provider/types";

const profile: ProviderProfile = { id: "sf", name: "硅基流动", baseUrl: "https://api.siliconflow.cn/v1", apiKey: "test-key", protocol: "openai", presetId: "siliconflow", models: [] };
const reference = { dataUrl: "data:image/png;base64,dGVzdA==" };
const generate: ProviderInput = { task: "image.generate", model: "Qwen/Qwen-Image", prompt: "陶瓷杯", options: { aspectRatio: "16:9", count: 1 } };

function setup(response: { status: number; data: unknown } = { status: 200, data: { images: [{ url: "https://cdn.example/image.png" }] } }) {
    const requests: Array<Parameters<ProviderTransport["request"]>[0]> = [];
    const adapter = createSiliconFlowAdapter({ async request(input) { requests.push(input); return { ...response, headers: new Headers() }; } });
    return { adapter, requests };
}

test("硅基流动文生图使用原生字段、推荐尺寸和 images 响应，/v1 不重复", async () => {
    for (const baseUrl of ["https://api.siliconflow.cn", "https://api.siliconflow.cn/v1", "https://api.siliconflow.cn/v1/"]) {
        const { adapter, requests } = setup();
        const controller = new AbortController();
        assert.deepEqual(await adapter.execute({ ...profile, baseUrl }, { ...generate, signal: controller.signal }), [{ url: "https://cdn.example/image.png" }]);
        assert.equal(requests[0].url, "https://api.siliconflow.cn/v1/images/generations");
        assert.equal(requests[0].headers?.Authorization, "Bearer test-key");
        assert.equal(requests[0].signal, controller.signal);
        assert.deepEqual(requests[0].body, { model: "Qwen/Qwen-Image", prompt: "陶瓷杯", image_size: "1664x928", num_inference_steps: 50, cfg: 4 });
    }
});

test("Qwen 默认方图、竖图与用户像素尺寸正确传递，其他模型不带 Qwen 专用参数", async () => {
    const { adapter, requests } = setup();
    await adapter.execute(profile, { ...generate, options: {} });
    await adapter.execute(profile, { ...generate, options: { aspectRatio: "9:16" } });
    await adapter.execute(profile, { ...generate, options: { aspectRatio: "1472x1140" } });
    await adapter.execute(profile, { ...generate, model: "OpenMOSS-Team/MOSS-Image", options: {} });
    assert.deepEqual(requests.map((item) => (item.body as Record<string, unknown>).image_size), ["1328x1328", "928x1664", "1472x1140", "1024x1024"]);
    assert.deepEqual(requests[3].body, { model: "OpenMOSS-Team/MOSS-Image", prompt: "陶瓷杯", image_size: "1024x1024" });
});

test("参考图改图使用 JSON image 字段与 generations 路径，Qwen 编辑不传尺寸", async () => {
    const { adapter, requests } = setup();
    await adapter.execute(profile, { ...generate, task: "image.edit", model: "Qwen/Qwen-Image-Edit", references: [reference] });
    assert.deepEqual(requests[0].body, { model: "Qwen/Qwen-Image-Edit", prompt: "陶瓷杯", image: reference.dataUrl });
    assert.equal(requests[0].url, "https://api.siliconflow.cn/v1/images/generations");
});

test("Qwen Edit 2509 按原顺序传递三图，不丢弃参考素材", async () => {
    const { adapter, requests } = setup();
    const references = [reference, { url: "https://cdn.example/second.png" }, { dataUrl: "data:image/jpeg;base64,dGhpcmQ=" }];
    await adapter.execute(profile, { ...generate, task: "image.edit", model: "Qwen/Qwen-Image-Edit-2509", references });
    const body = requests[0].body as Record<string, unknown>;
    assert.equal(body.image, references[0].dataUrl);
    assert.equal(body.image2, references[1].url);
    assert.equal(body.image3, references[2].dataUrl);
    assert.equal("image_size" in body, false);
});

test("错用模型、缺图、多图或恢复同步请求时先拒绝，不产生网络调用", async () => {
    const { adapter, requests } = setup();
    const edit: ProviderInput = { ...generate, task: "image.edit", model: "Qwen/Qwen-Image-Edit", references: [reference] };
    for (const input of [
        { ...edit, references: [] },
        { ...edit, references: [reference, reference] },
        { ...edit, model: "Qwen/Qwen-Image-Edit-2509", references: Array(4).fill(reference) },
        { ...edit, model: "Qwen/Qwen-Image" },
        { ...generate, model: "Qwen/Qwen-Image-Edit" },
        { ...generate, resumeTaskId: "old-task" },
    ]) {
        await assert.rejects(adapter.execute(profile, input), (error: Error & { submissionState?: string }) => error.submissionState === "rejected");
    }
    assert.equal(requests.length, 0);
});

test("批量生成逐次请求原生同步接口，不发送不支持的 n 或批量参数", async () => {
    const { adapter, requests } = setup();
    const images = await adapter.execute(profile, { ...generate, options: { count: 3 } });
    assert.equal(Array.isArray(images) && images.length, 3);
    assert.equal(requests.length, 3);
    assert.equal(requests.every((item) => !("n" in (item.body as object))), true);
});

test("余额、限流及服务端错误保留 HTTP 状态与原始提示，没有自动重试", async () => {
    for (const status of [401, 403, 429, 503]) {
        const { adapter, requests } = setup({ status, data: { message: "provider error" } });
        await assert.rejects(adapter.execute(profile, generate), (error: Error & { status?: number }) => error.message === "provider error" && error.status === status);
        assert.equal(requests.length, 1);
    }
});

test("没有图片的成功响应仍报错，网络取消原样传递", async () => {
    const { adapter } = setup({ status: 200, data: { images: [] } });
    await assert.rejects(adapter.execute(profile, generate), /没有可用图片/);
    const aborted = new DOMException("cancelled", "AbortError");
    const cancelAdapter = createSiliconFlowAdapter({ async request() { throw aborted; } });
    await assert.rejects(cancelAdapter.execute(profile, generate), (error) => error === aborted);
});
