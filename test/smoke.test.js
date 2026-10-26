"use strict";

// Make sure the test suite never calls Groq, even if a local .env exists.
process.env.GROQ_API_KEY = "";
process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

const { GROQ_MODELS, DEFAULT_MODEL_ID } = require("../models");
const app = require("../server");

// A tiny 1x1 transparent PNG.
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let server;
let baseUrl;

test.before(async () => {
  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function postJson(path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("serves the chatbot page", async () => {
  const response = await fetch(`${baseUrl}/`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(html, /id="model-trigger"/);
  assert.match(html, /id="model-menu"/);
});

test("does not expose server files or secrets", async () => {
  for (const path of ["/.env", "/server.js", "/package.json", "/models.js"]) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 404, `${path} should not be served`);
  }
});

test("serves the frontend assets from the public directory", async () => {
  const css = await fetch(`${baseUrl}/style.css`);
  const js = await fetch(`${baseUrl}/script.js`);
  const favicon = await fetch(`${baseUrl}/favicon.svg`);

  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type"), /text\/css/);
  assert.equal(js.status, 200);
  assert.match(js.headers.get("content-type"), /javascript/);
  assert.equal(favicon.status, 200);
  assert.match(favicon.headers.get("content-type"), /image\/svg\+xml/);
});

test("frontend assets contain no API key material", async () => {
  for (const path of ["/", "/style.css", "/script.js"]) {
    const body = await (await fetch(`${baseUrl}${path}`)).text();

    assert.doesNotMatch(body, /gsk_[A-Za-z0-9]/, `${path} leaks a Groq key`);
    assert.doesNotMatch(body, /AIza[0-9A-Za-z_-]{20,}/, `${path} leaks a Google key`);
    assert.doesNotMatch(body, /Bearer\s+sk-/, `${path} leaks a bearer token`);
  }
});

test("returns the centralized model list", async () => {
  const response = await fetch(`${baseUrl}/api/models`);
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.defaultModel, DEFAULT_MODEL_ID);
  assert.ok(Array.isArray(data.models));
  assert.equal(data.models.length, GROQ_MODELS.length);
  assert.deepEqual(
    data.models.map((model) => model.id),
    GROQ_MODELS.map((model) => model.id),
  );

  for (const model of data.models) {
    assert.equal(typeof model.id, "string");
    assert.equal(typeof model.name, "string");
    assert.equal(typeof model.provider, "string");
    assert.equal(typeof model.description, "string");
    assert.equal(typeof model.vision, "boolean");
    assert.equal(model.pricing, "free-tier");
  }
});

test("rejects models outside the allowlist", async () => {
  const response = await postJson("/api/chat", {
    model: "openai/gpt-4o",
    messages: [{ role: "user", content: "Hello" }],
  });
  const data = await response.json();

  assert.equal(response.status, 400);
  assert.equal(data.error.code, "model_not_allowed");
});

test("rejects empty conversations", async () => {
  const response = await postJson("/api/chat", {
    model: DEFAULT_MODEL_ID,
    messages: [],
  });
  const data = await response.json();

  assert.equal(response.status, 400);
  assert.equal(data.error.code, "invalid_messages");
});

test("rejects images for text-only models", async () => {
  const response = await postJson("/api/chat", {
    model: "openai/gpt-oss-20b",
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
  const data = await response.json();

  assert.equal(response.status, 400);
  assert.equal(data.error.code, "image_not_supported");
});

test("returns a clear setup error when the API key is missing", async () => {
  const response = await postJson("/api/chat", {
    model: DEFAULT_MODEL_ID,
    messages: [{ role: "user", content: "Hello" }],
  });
  const data = await response.json();

  assert.equal(response.status, 503);
  assert.equal(data.error.code, "not_configured");
  assert.match(data.error.message, /GROQ_API_KEY/);
});

test("rejects malformed JSON safely", async () => {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not valid json",
  });
  const data = await response.json();

  assert.equal(response.status, 400);
  assert.equal(data.error.code, "invalid_json");
});
