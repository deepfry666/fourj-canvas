export type DetectedProviderSetup = {
    apiFormat: "openai" | "gemini";
    adapterMode: "preset";
    adapterPreset: "openai-compatible" | "gemini" | "apimart-gpt-image" | "siliconflow";
};

export function detectProviderPreset(baseUrl: string): DetectedProviderSetup {
    const value = baseUrl.trim().toLowerCase();
    try {
        const hostname = new URL(value).hostname;
        if (hostname === "api.siliconflow.cn" || hostname === "api.siliconflow.com") return { apiFormat: "openai", adapterMode: "preset", adapterPreset: "siliconflow" };
    } catch { /* Incomplete addresses keep the default preset. */ }
    if (value.includes("apimart")) return { apiFormat: "openai", adapterMode: "preset", adapterPreset: "apimart-gpt-image" };
    if (value.includes("generativelanguage.googleapis.com")) return { apiFormat: "gemini", adapterMode: "preset", adapterPreset: "gemini" };
    return { apiFormat: "openai", adapterMode: "preset", adapterPreset: "openai-compatible" };
}
