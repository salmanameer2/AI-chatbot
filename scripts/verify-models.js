"use strict";

require("dotenv").config({ quiet: true });

const { GROQ_MODELS } = require("../models");

const API_KEY = String(process.env.GROQ_API_KEY || "").trim();
const CATALOG_URL = "https://api.groq.com/openai/v1/models";

function contextLabel(entry) {
  const value = entry?.context_window ?? entry?.context_length;
  return value === undefined || value === null ? "unknown" : String(value);
}

async function main() {
  if (!API_KEY) {
    console.error(
      "GROQ_API_KEY is not set. Add it to .env, then run `npm run verify:models` again.",
    );
    process.exitCode = 1;
    return;
  }

  console.log("Checking the model allowlist against Groq's catalog...\n");

  const response = await fetch(CATALOG_URL, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Groq catalog responded with HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!Array.isArray(data?.data)) {
    throw new Error("Groq catalog response was malformed.");
  }

  const byId = new Map(data.data.map((model) => [model.id, model]));
  let failures = 0;

  const rows = GROQ_MODELS.map((model) => {
    const entry = byId.get(model.id);

    if (!entry) {
      failures += 1;
      return {
        model: model.name,
        id: model.id,
        context: "not listed",
        status: "MISSING",
      };
    }

    return {
      model: model.name,
      id: model.id,
      context: contextLabel(entry),
      status: "OK",
    };
  });

  console.table(rows);

  if (failures > 0) {
    console.error(
      `\n${failures} allowlisted model(s) are not available on Groq. ` +
        "Update models.js with the current model IDs.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\nAll ${GROQ_MODELS.length} allowlisted models are available on Groq.`);
  console.log("Catalog checked:", new Date().toISOString());
  console.log(
    "Note: availability does not imply unlimited free usage. Groq free-plan rate limits still apply.",
  );
}

main().catch((error) => {
  console.error("Could not verify the Groq model catalog:", error.message);
  process.exitCode = 1;
});
