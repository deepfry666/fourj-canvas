import assert from "node:assert/strict";
import test from "node:test";

test("OpenAI-compatible image responses with URL arrays are accepted", async () => {
    const previousLocalStorage = globalThis.localStorage;
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    globalThis.localStorage = { getItem: () => null, setItem: () => undefined } as unknown as Storage;
    globalThis.window = { localStorage: globalThis.localStorage, location: { href: "https://canvas.example/" } } as unknown as Window & typeof globalThis;
    globalThis.document = { documentElement: { lang: "zh-CN" } } as unknown as Document;

    const axios = (await import("axios")).default;
    const previousPost = axios.post;
    axios.post = (async () => ({ data: { data: [{ url: ["https://cdn.example/result.png"] }] } })) as typeof axios.post;

    try {
        const { requestGeneration } = await import("./image.ts");
        const { defaultConfig } = await import("@/stores/use-config-store");
        const config = {
            ...defaultConfig,
            channelMode: "local" as const,
            baseUrl: "https://cpa.example/v1",
            apiKey: "test-key",
            apiFormat: "openai" as const,
            channels: [{ id: "cpa", name: "CPA", baseUrl: "https://cpa.example/v1", apiKey: "test-key", apiFormat: "openai" as const, models: [{ name: "gpt-image", capability: "image" as const }] }],
            model: "cpa::gpt-image",
            imageModel: "cpa::gpt-image",
            count: "1",
            quality: "auto",
            size: "1024x1024",
            background: "",
            systemPrompt: "",
            reasoningEffort: "auto" as const,
        };

        const result = await requestGeneration(config, "a test image");
        assert.equal(result[0]?.dataUrl, "https://cdn.example/result.png");
    } finally {
        axios.post = previousPost;
        globalThis.localStorage = previousLocalStorage;
        globalThis.document = previousDocument;
        globalThis.window = previousWindow;
    }
});

test("硅基流动渠道从真实生图与编辑入口走内置模板，仍允许模型覆盖适配", async () => {
    const previousLocalStorage = globalThis.localStorage;
    const previousDocument = globalThis.document;
    const previousFetch = globalThis.fetch;
    globalThis.localStorage = { getItem: () => null, setItem: () => undefined } as unknown as Storage;
    globalThis.document = { documentElement: { lang: "zh-CN" } } as unknown as Document;
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = (async (url, init) => {
        requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ images: [{ url: "https://cdn.example/siliconflow.png" }] }), { headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    try {
        const { requestGeneration, requestEdit } = await import("./image.ts");
        const { defaultConfig, resolveModelAdapter } = await import("@/stores/use-config-store");
        const channel = {
            id: "sf", name: "硅基流动", baseUrl: "https://api.siliconflow.cn/v1", apiKey: "test-key",
            apiFormat: "openai" as const, adapterMode: "preset" as const, adapterPreset: "siliconflow",
            models: [
                { name: "Qwen/Qwen-Image", capability: "image" as const },
                { name: "Qwen/Qwen-Image-Edit-2509", capability: "image" as const },
            ],
        };
        const config = { ...defaultConfig, channels: [channel], model: "sf::Qwen/Qwen-Image", imageModel: "sf::Qwen/Qwen-Image", count: "1", size: "16:9", systemPrompt: "" };
        const images = await requestGeneration(config, "杯子");
        assert.equal(images[0].dataUrl, "https://cdn.example/siliconflow.png");
        assert.equal(requests[0].body.image_size, "1664x928");
        const references = Array.from({ length: 3 }, (_, index) => ({ id: String(index), name: "ref.png", type: "image/png", dataUrl: `data:image/png;base64,${index}` }));
        const edits = await requestEdit({ ...config, model: "sf::Qwen/Qwen-Image-Edit-2509" }, "换背景", references);
        assert.equal(edits[0].dataUrl, "https://cdn.example/siliconflow.png");
        assert.equal(requests.length, 2);
        assert.equal(requests.every((item) => item.url === "https://api.siliconflow.cn/v1/images/generations"), true);
        assert.equal(requests[1].body.image3, references[2].dataUrl);
        assert.equal("image_size" in requests[1].body, false);

        // A model-specific mapping must keep precedence over the channel preset.
        const mapping = JSON.stringify({ endpoints: { "image.generate": { path: "/custom-image", body: { prompt: "$prompt" }, response: { images: "$.images" } } } });
        const overrideConfig = { ...config, channels: [{ ...channel, models: [{ ...channel.models[0], adapterMode: "declarative" as const, adapterMapping: mapping }] }] };
        assert.equal(resolveModelAdapter(overrideConfig, config.model).mode, "declarative");
        await requestGeneration(overrideConfig, "custom");
        assert.equal(requests[2].url, "https://api.siliconflow.cn/v1/custom-image");
    } finally {
        globalThis.fetch = previousFetch;
        globalThis.localStorage = previousLocalStorage;
        globalThis.document = previousDocument;
    }
});

test("旧 preview 配置恢复为正式通道，保留自动更新开关与创作设置", async () => {
    const { useConfigStore } = await import("@/stores/use-config-store");
    const merged = useConfigStore.persist.getOptions().merge?.({ config: {
        desktopUpdateChannel: "preview", desktopAutoUpdate: false, size: "16:9",
    } }, useConfigStore.getState());
    assert.ok(merged);
    assert.equal(merged.config.desktopUpdateChannel, "stable");
    assert.equal(merged.config.desktopAutoUpdate, false);
    assert.equal(merged.config.size, "16:9");
});
