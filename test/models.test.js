"use strict";

// Pure model-policy tests. These never touch the network or need an API key.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  GROQ_MODELS,
  DEFAULT_MODEL_ID,
  getModelById,
  getProviderLabel,
  isAllowedModel,
} = require("../models");

test("keeps the allowlist unique and the default model eligible", () => {
  const ids = GROQ_MODELS.map((model) => model.id);

  assert.equal(new Set(ids).size, ids.length);
  assert.ok(getModelById(DEFAULT_MODEL_ID));
  assert.equal(isAllowedModel(DEFAULT_MODEL_ID), true);

  for (const model of GROQ_MODELS) {
    assert.equal(typeof model.provider, "string");
    assert.ok(model.provider.trim().length > 0);
    assert.equal(model.pricing, "free-tier");
  }
});

test("rejects models outside the allowlist", () => {
  for (const id of [
    "openai/gpt-4o",
    "meta-llama/llama-3.3-70b-versatile",
    "qwen/qwen3",
    "",
    null,
  ]) {
    assert.equal(isAllowedModel(id), false);
    assert.equal(getModelById(id), null);
  }
});

test("marks exactly the vision-capable models", () => {
  const visionIds = GROQ_MODELS.filter((model) => model.vision).map(
    (model) => model.id,
  );

  assert.deepEqual(visionIds, ["qwen/qwen3.8-27b"]);
});

test("provides readable provider labels", () => {
  assert.equal(getProviderLabel("openai/gpt-oss-120b"), "OpenAI");
  assert.equal(getProviderLabel("qwen/qwen3.8-27b"), "Qwen");
  assert.equal(getProviderLabel("unknown/model"), "unknown");
  assert.equal(getProviderLabel(""), "Unknown");
});
