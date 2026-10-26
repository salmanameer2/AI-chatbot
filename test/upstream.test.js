"use strict";

// This file tests the Groq integration. It must never make a real network
// request: global.fetch is replaced with a small fake below.
process.env.GROQ_API_KEY = "gsk_test_key_never_logged";
process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

const { DEFAULT_MODEL_ID } = require("../models");
const app = require("../server");

const realFetch = global.fetch;
const groqCalls = [];

// A tiny 1x1 transparent PNG.
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let chatResponse = () => {
  throw new Error("chat handler was not configured");
};

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

global.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;

  if (url === "https://api.groq.com/openai/v1/chat/completions") {
    groqCalls.push({
      headers: init.headers,
      body: JSON.parse(init.body),
    });
    return chatResponse();
  }

  return realFetch(input, init);
};

let server;
let baseUrl;

test.before(async () => {
  server = app.listen(0);
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  global.fetch = realFetch;
  await new Promise((resolve) => server.close(resolve));
});

async function postChat(body) {
  const response = await realFetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, data: await response.json() };
}

test("reports that the server is configured for Groq", async () => {
  const response = await realFetch(`${baseUrl}/api/health`);
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.provider, "groq");
  assert.equal(data.configured, true);
  assert.equal(data.defaultModel, DEFAULT_MODEL_ID);
});

test("sends the selected model and history to Groq", async () => {
  groqCalls.length = 0;

  chatResponse = () =>
    jsonResponse({
      model: "openai/gpt-oss-20b",
      choices: [{ message: { content: "Hello from the mocked model." } }],
    });

  const { response, data } = await postChat({
    model: "openai/gpt-oss-20b",
    messages: [
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "Second question" },
    ],
  });

  assert.equal(response.status, 200);
  assert.equal(data.message, "Hello from the mocked model.");
  assert.equal(data.model, "openai/gpt-oss-20b");
  assert.equal(groqCalls.length, 1);

  const call = groqCalls[0];
  assert.equal(call.body.model, "openai/gpt-oss-20b");
  assert.equal(call.body.max_completion_tokens, 2048);
  assert.equal(call.body.messages[0].role, "system");
  assert.deepEqual(
    call.body.messages.slice(1).map((message) => message.role),
    ["user", "assistant", "user"],
  );
  assert.equal(call.body.messages.at(-1).content, "Second question");
  assert.equal(call.headers.Authorization, "Bearer gsk_test_key_never_logged");

  const serialized = JSON.stringify(data);
  assert.ok(!serialized.includes("gsk_test_key_never_logged"));
});

test("forwards image parts to the vision-capable model", async () => {
  groqCalls.length = 0;

  chatResponse = () =>
    jsonResponse({
      choices: [{ message: { content: "A tiny transparent image." } }],
    });

  const { response, data } = await postChat({
    model: "qwen/qwen3.8-27b",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          { type: "image_url", image_url: { url: TINY_PNG } },
        ],
      },
    ],
  });

  assert.equal(response.status, 200);
  assert.equal(data.message, "A tiny transparent image.");

  const content = groqCalls[0].body.messages.at(-1).content;
  assert.equal(content[0].type, "text");
  assert.equal(content[1].type, "image_url");
  assert.equal(content[1].image_url.url, TINY_PNG);
});

test("rejects images for text-only models before calling Groq", async () => {
  groqCalls.length = 0;

  const { response, data } = await postChat({
    model: "openai/gpt-oss-120b",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          { type: "image_url", image_url: { url: TINY_PNG } },
        ],
      },
    ],
  });

  assert.equal(response.status, 400);
  assert.equal(data.error.code, "image_not_supported");
  assert.equal(groqCalls.length, 0);
});

test("rejects unknown model IDs", async () => {
  groqCalls.length = 0;

  for (const model of [
    "openai/gpt-4o",
    "meta-llama/llama-3.3-70b-versatile",
    "qwen/qwen3",
  ]) {
    const { response, data } = await postChat({
      model,
      messages: [{ role: "user", content: "Hello" }],
    });

    assert.equal(response.status, 400, `${model} should be rejected`);
    assert.equal(data.error.code, "model_not_allowed");
  }

  assert.equal(groqCalls.length, 0, "must not call any unverified model");
});

test("maps a 429 rate-limit response to a clear error", async () => {
  chatResponse = () =>
    jsonResponse(
      { error: { message: "Rate limit exceeded for this model." } },
      429,
      { "Retry-After": "12" },
    );

  const { response, data } = await postChat({
    model: DEFAULT_MODEL_ID,
    messages: [{ role: "user", content: "Hello" }],
  });

  assert.equal(response.status, 429);
  assert.equal(data.error.code, "rate_limited");
  assert.equal(data.error.retryAfter, 12);
  assert.match(data.error.message, /rate limit/i);
  assert.match(data.error.message, /another model/i);
});

test("maps a rejected API key to a server setup error", async () => {
  chatResponse = () =>
    jsonResponse({ error: { message: "Invalid API Key" } }, 401);

  const { response, data } = await postChat({
    model: DEFAULT_MODEL_ID,
    messages: [{ role: "user", content: "Hello" }],
  });

  assert.equal(response.status, 502);
  assert.equal(data.error.code, "server_auth_error");
  assert.match(data.error.message, /GROQ_API_KEY/);
});

test("maps a 404 to a model-unavailable message", async () => {
  chatResponse = () =>
    jsonResponse({ error: { message: "The model does not exist" } }, 404);

  const { response, data } = await postChat({
    model: DEFAULT_MODEL_ID,
    messages: [{ role: "user", content: "Hello" }],
  });

  assert.equal(response.status, 404);
  assert.equal(data.error.code, "model_unavailable");
  assert.match(data.error.message, /no longer available/i);
});

test("maps a 503 provider outage to a retryable error", async () => {
  chatResponse = () =>
    jsonResponse({ error: { message: "Service unavailable" } }, 503);

  const { response, data } = await postChat({
    model: DEFAULT_MODEL_ID,
    messages: [{ role: "user", content: "Hello" }],
  });

  assert.equal(response.status, 503);
  assert.equal(data.error.code, "provider_unavailable");
  assert.match(data.error.message, /another model/i);
});

test("returns an empty-response error instead of a blank bubble", async () => {
  chatResponse = () =>
    jsonResponse({
      choices: [{ message: { role: "assistant", content: "   " } }],
    });

  const { response, data } = await postChat({
    model: DEFAULT_MODEL_ID,
    messages: [{ role: "user", content: "Hello" }],
  });

  assert.equal(response.status, 502);
  assert.equal(data.error.code, "empty_response");
});

test("never echoes the server API key in upstream error details", async () => {
  chatResponse = () =>
    jsonResponse(
      {
        error: {
          message: "Upstream echoed gsk_test_key_never_logged in its error text",
        },
      },
      500,
    );

  const { response, data } = await postChat({
    model: DEFAULT_MODEL_ID,
    messages: [{ role: "user", content: "Hello" }],
  });

  assert.equal(response.status, 502);
  assert.equal(data.error.detail, "Upstream echoed [redacted] in its error text");
  assert.ok(!JSON.stringify(data).includes("gsk_test_key_never_logged"));
});
