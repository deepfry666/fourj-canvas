export const OPENAI_COMPATIBLE_PRESET = "openai-compatible";
export const GEMINI_PRESET = "gemini";
export const SILICONFLOW_PRESET = "siliconflow";
export const DECLARATIVE_PRESET = "declarative";
// Keep the persisted id for existing channels; the preset now covers all APIMart media APIs.
export const APIMART_GPT_IMAGE_PRESET = "apimart-gpt-image";

export const PROVIDER_PRESETS = [
    { id: OPENAI_COMPATIBLE_PRESET, label: "OpenAI 兼容接口", description: "适用于大多数 /v1 文本和图片接口" },
    { id: SILICONFLOW_PRESET, label: "硅基流动图片接口", description: "支持文生图和参考图改图，自动处理尺寸、参考图与图片结果" },
    { id: APIMART_GPT_IMAGE_PRESET, label: "APIMart 全媒体", description: "APIMart 生图与视频接口，按模型自动提交任务并轮询结果" },
    { id: GEMINI_PRESET, label: "Gemini", description: "Gemini 原生 generateContent 接口" },
    { id: DECLARATIVE_PRESET, label: "声明式接口", description: "用字段映射适配文档不同的中转站，不写脚本" },
] as const;
