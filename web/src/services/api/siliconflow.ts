import type { ProviderAdapter, ProviderImage, ProviderInput, ProviderTransport } from "../provider/types";
import { SILICONFLOW_PRESET } from "../provider/presets.ts";
import { createProviderHttpError, withProviderErrorMessage } from "../provider/provider-error.ts";

// https://docs.siliconflow.cn/docs/api/images-generations-post
const QWEN_IMAGE_SIZES = ["1328x1328", "1664x928", "928x1664", "1472x1140", "1140x1472", "1584x1056", "1056x1584"];

function imageSize(input: ProviderInput) {
    const value = String(input.options?.size || input.options?.aspectRatio || "auto").trim();
    if (/^\d+x\d+$/i.test(value)) return value.toLowerCase();
    if (!value || value === "auto") return /qwen-image/i.test(input.model) ? QWEN_IMAGE_SIZES[0] : "1024x1024";
    const [width, height] = value.split(":").map(Number);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error("硅基流动图片比例无效，请选择有效比例或像素尺寸。");
    const ratio = width / height;
    if (/qwen-image/i.test(input.model)) {
        return QWEN_IMAGE_SIZES.reduce((best, size) => {
            const [w, h] = size.split("x").map(Number);
            const [bw, bh] = best.split("x").map(Number);
            return Math.abs(w / h - ratio) < Math.abs(bw / bh - ratio) ? size : best;
        });
    }
    return ratio >= 1 ? `${Math.round(1024 * ratio / 16) * 16}x1024` : `1024x${Math.round(1024 / ratio / 16) * 16}`;
}

function imageBody(input: ProviderInput) {
    if (input.task !== "image.generate" && input.task !== "image.edit") throw new Error("硅基流动图片模板只支持文生图和参考图改图。");
    const qwenEdit = /qwen-image-edit/i.test(input.model);
    const references = input.references || [];
    const limit = /qwen-image-edit-2509$/i.test(input.model) ? 3 : 1;
    if (input.task === "image.generate" && qwenEdit) throw new Error("Qwen Image-Edit 是改图模型，请先添加参考图片；纯文字生图请选 Qwen/Qwen-Image。");
    if (input.task === "image.edit") {
        if (!references.length) throw new Error("参考图改图需要至少 1 张参考图片。");
        if (/qwen-image/i.test(input.model) && !qwenEdit) throw new Error("Qwen/Qwen-Image 是文生图模型；参考图改图请选 Qwen/Qwen-Image-Edit 或 Qwen/Qwen-Image-Edit-2509。");
        if (references.length > limit) throw new Error(`当前硅基流动模型最多支持 ${limit} 张参考图，请删除多余图片后再生成。`);
    } else if (references.length) {
        throw new Error("包含参考图片时请使用改图请求。");
    }
    const body: Record<string, unknown> = {
        model: input.model,
        prompt: input.prompt || "",
        ...(qwenEdit ? {} : { image_size: imageSize(input) }),
        ...(/qwen-image/i.test(input.model) && !qwenEdit ? { num_inference_steps: 50, cfg: 4 } : {}),
    };
    references.forEach((reference, index) => {
        const source = reference.dataUrl || reference.url || "";
        if (!/^(?:data:image\/|https?:\/\/)/i.test(source)) throw new Error("参考图片未准备好，请重新添加后再生成。");
        body[index ? `image${index + 1}` : "image"] = source;
    });
    return body;
}

export function createSiliconFlowAdapter(transport: ProviderTransport): ProviderAdapter {
    return {
        id: SILICONFLOW_PRESET,
        label: "硅基流动图片接口",
        supports: (_profile, task) => task === "image.generate" || task === "image.edit",
        async probe() {
            return { source: "manual", checkedAt: new Date().toISOString(), image: true };
        },
        async submit(profile, input) {
            let body: Record<string, unknown>;
            try {
                body = imageBody(input);
                if (input.resumeTaskId) throw new Error("硅基流动图片接口不支持按任务 ID 恢复查询，请勿重复提交状态不明的任务。");
            } catch (error) {
                throw withProviderErrorMessage(error, error instanceof Error ? error.message : String(error), "rejected");
            }
            const base = profile.baseUrl.trim().replace(/\/+$/, "");
            const url = `${base.endsWith("/v1") ? base : `${base}/v1`}/images/generations`;
            const count = Math.max(1, Math.min(15, Math.floor(Number(input.options?.count) || 1)));
            const images = await Promise.all(Array.from({ length: count }, async () => {
                const response = await transport.request({
                    method: "POST", url,
                    headers: { Authorization: `Bearer ${profile.apiKey}`, "Content-Type": "application/json" },
                    body, signal: input.signal,
                });
                const data = response.data as { images?: Array<{ url?: string }>; message?: string; error?: { message?: string } } | null;
                const message = typeof response.data === "string" ? response.data : data?.message || data?.error?.message;
                if (response.status >= 400) throw createProviderHttpError(response.status, message || `硅基流动请求失败（HTTP ${response.status}）`);
                const result: ProviderImage[] = (Array.isArray(data?.images) ? data.images : []).filter((item) => typeof item?.url === "string" && item.url).map((item) => ({ url: item.url }));
                if (!result.length) throw new Error(message || "硅基流动响应中没有可用图片。");
                return result;
            }));
            return { status: "completed", result: images.flat() };
        },
        async poll() {
            throw new Error("硅基流动图片接口直接返回图片，不支持任务轮询。");
        },
        async execute(profile, input) {
            const submission = await this.submit(profile, input, input.idempotencyKey || "");
            if (submission.status !== "completed") throw new Error("硅基流动图片接口没有直接返回结果。");
            return submission.result;
        },
    };
}
