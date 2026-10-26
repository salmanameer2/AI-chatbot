"use strict";

/**
 * Central list of models the chatbot is allowed to use.
 *
 * Every entry below is served by Groq and is available on Groq's free plan:
 * https://console.groq.com/docs/models
 * https://console.groq.com/docs/rate-limits
 *
 * Groq's free plan is rate limited rather than zero-priced. There is no paid
 * fallback in this project: if the free-plan limit is reached, the request
 * fails with a clear error instead of switching to a paid tier.
 *
 * When Groq changes its lineup, update this file and run
 * `npm run verify:models` with GROQ_API_KEY set.
 */

const GROQ_MODELS_VERIFIED_AT = "2026-10-26";

const GROQ_MODELS = [
  {
    id: "openai/gpt-oss-120b",
    name: "GPT-OSS 120B",
    shortName: "GPT-OSS 120B",
    provider: "OpenAI",
    description:
      "OpenAI's flagship open-weight reasoning model for complex, multi-step questions.",
    category: "Reasoning",
    tags: ["Reasoning", "Long context"],
    vision: false,
    contextWindow: 131072,
    pricing: "free-tier",
  },
  {
    id: "openai/gpt-oss-20b",
    name: "GPT-OSS 20B",
    shortName: "GPT-OSS 20B",
    provider: "OpenAI",
    description:
      "A smaller, faster GPT-OSS model for everyday questions and quick answers.",
    category: "Fast",
    tags: ["Fast", "General"],
    vision: false,
    contextWindow: 131072,
    pricing: "free-tier",
  },
  {
    id: "qwen/qwen3.8-27b",
    name: "Qwen 3.8 27B",
    shortName: "Qwen 3.8",
    provider: "Qwen",
    description:
      "Qwen's multimodal model for general reasoning, coding, and image inputs.",
    category: "Vision",
    tags: ["Vision", "Reasoning"],
    vision: true,
    contextWindow: 131072,
    pricing: "free-tier",
  },
];

const DEFAULT_MODEL_ID = "openai/gpt-oss-120b";

const PROVIDER_LABELS = Object.freeze({
  openai: "OpenAI",
  qwen: "Qwen",
  groq: "Groq",
});

const MODEL_IDS = new Set(GROQ_MODELS.map((model) => model.id));

if (MODEL_IDS.size !== GROQ_MODELS.length) {
  throw new Error("GROQ_MODELS contains duplicate model IDs.");
}

function getModelById(modelId) {
  return GROQ_MODELS.find((model) => model.id === modelId) || null;
}

function isAllowedModel(modelId) {
  return MODEL_IDS.has(modelId);
}

function getProviderLabel(modelId) {
  const providerId = String(modelId || "")
    .replace(/^~/, "")
    .split("/")[0]
    .toLowerCase();

  return PROVIDER_LABELS[providerId] || providerId || "Unknown";
}

module.exports = {
  GROQ_MODELS,
  DEFAULT_MODEL_ID,
  GROQ_MODELS_VERIFIED_AT,
  getModelById,
  getProviderLabel,
  isAllowedModel,
};
