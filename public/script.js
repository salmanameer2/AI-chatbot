/* =========================================================
   Chat with AI — frontend
   Groq requests go through the local Express backend.
   ========================================================= */

const chatBody = document.querySelector(".chat-body");
const chatForm = document.querySelector(".chat-form");
const messageInput = document.querySelector(".message-input");
const sendMessageButton = document.querySelector("#send-message");
const fileInput = document.querySelector("#file-input");
const fileUploadWrapper = document.querySelector(".file-upload-wrapper");
const fileCancelButton = document.querySelector("#file-cancel");
const chatbotToggler = document.querySelector("#chatbot-toggler");
const closeChatbot = document.querySelector("#close-chatbot");
const chatStage = document.querySelector(".chat-stage");
const chatFab = document.querySelector("#chat-fab");
const clearChatButton = document.querySelector("#clear-chat");
const composerNotice = document.querySelector("#composer-notice");

const modelSelector = document.querySelector("#model-selector");
const modelTrigger = document.querySelector("#model-trigger");
const modelMenu = document.querySelector("#model-menu");
const modelList = document.querySelector("#model-list");
const modelMenuStatus = document.querySelector("#model-menu-status");
const modelMenuVerified = document.querySelector("#model-menu-verified");
const selectedModelName = document.querySelector("#selected-model-name");
const chatStatusText = document.querySelector("#chat-status-text");

// Snapshot of the welcome message so "Clear chat" can restore it
const initialChatHTML = chatBody.innerHTML;
const initialInputHeight = messageInput.scrollHeight;

const DEFAULT_MODEL_ID = "openai/gpt-oss-120b";
const MODEL_STORAGE_KEY = "chatbot:selected-model";
const MAX_HISTORY_MESSAGES = 24;
// Vercel caps request bodies at 4.5 MB, so images stay at 3 MB to leave room
// for base64 overhead and the JSON message envelope.
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = /^image\/(png|jpe?g|webp|gif)$/i;

const userData = {
  message: null,
  file: {
    data: null,
    mime_type: null,
  },
};

const state = {
  models: [],
  selectedModelId: DEFAULT_MODEL_ID,
  history: [],
  historyVersion: 0,
  isRequesting: false,
  verifiedAt: null,
};

const botAvatarMarkup = `
<svg class="bot-avatar" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="4" y="7.5" width="16" height="12" rx="4" />
    <path d="M12 3.5v3.2" />
    <circle cx="12" cy="2.3" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="9.2" cy="12.8" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="14.8" cy="12.8" r="1.1" fill="currentColor" stroke="none" />
    <path d="M9.6 16.2h4.8" />
</svg>`;

const thinkingMarkup = `
    <div class="thinking-indicator">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
    </div>`;

/* -------------------------------------------------------------------------- */
/* Small UI helpers                                                           */
/* -------------------------------------------------------------------------- */

const createMessageElement = (content, ...classes) => {
  const div = document.createElement("div");
  div.classList.add("message", ...classes);
  div.innerHTML = content;
  return div;
};

const scrollToBottom = () => {
  chatBody.scrollTo({ top: chatBody.scrollHeight, behavior: "smooth" });
};

let noticeTimer = null;

function showComposerNotice(message, duration = 6500) {
  if (!composerNotice) return;

  clearTimeout(noticeTimer);
  composerNotice.textContent = message;
  composerNotice.hidden = false;

  noticeTimer = setTimeout(() => {
    composerNotice.hidden = true;
  }, duration);
}

function hideComposerNotice() {
  if (!composerNotice) return;
  clearTimeout(noticeTimer);
  composerNotice.hidden = true;
}

function setModelMenuStatus(message, { withRetry = false } = {}) {
  modelMenuStatus.replaceChildren();

  if (!message) {
    modelMenuStatus.hidden = true;
    return;
  }

  modelMenuStatus.hidden = false;

  const text = document.createElement("span");
  text.textContent = message;
  modelMenuStatus.appendChild(text);

  if (withRetry) {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "model-menu-retry";
    retry.textContent = "Retry";
    retry.addEventListener("click", () => loadModels());
    modelMenuStatus.appendChild(retry);
  }
}

function setRequesting(value) {
  state.isRequesting = value;
  sendMessageButton.disabled = value;
  chatForm.classList.toggle("is-busy", value);
  messageInput.setAttribute("aria-busy", String(value));

  document.querySelectorAll(".error-retry").forEach((button) => {
    button.disabled = value;
  });
}

/* -------------------------------------------------------------------------- */
/* Model selector                                                             */
/* -------------------------------------------------------------------------- */

function getSelectedModel() {
  return state.models.find((model) => model.id === state.selectedModelId) || null;
}

function readSavedModel() {
  try {
    return window.localStorage.getItem(MODEL_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveSelectedModel(modelId) {
  try {
    window.localStorage.setItem(MODEL_STORAGE_KEY, modelId);
  } catch {
    // Storage can be unavailable (private mode / file://). Selection still works.
  }
}

function updateModelTrigger() {
  const model = getSelectedModel();
  const name = model?.name || "GPT-OSS 120B";

  selectedModelName.textContent = name;
  modelTrigger.title = model
    ? `${model.name}${model.provider ? ` by ${model.provider}` : ""} — ${model.description}`
    : "Choose a model";
  modelTrigger.setAttribute("aria-label", `Current model: ${name}. Change model.`);
  chatStatusText.textContent = `Online · ${model?.shortName || "Ready to chat"}`;

  if (state.verifiedAt) {
    modelMenuVerified.title = `Model list reviewed on ${state.verifiedAt}`;
  }
}

function createModelOption(model) {
  const isSelected = model.id === state.selectedModelId;

  const option = document.createElement("button");
  option.type = "button";
  option.className = "model-option";
  option.dataset.modelId = model.id;
  option.setAttribute("role", "option");
  option.setAttribute("aria-selected", String(isSelected));
  option.classList.toggle("is-selected", isSelected);
  option.title = model.description;

  const main = document.createElement("span");
  main.className = "model-option-main";

  const top = document.createElement("span");
  top.className = "model-option-top";

  const name = document.createElement("span");
  name.className = "model-option-name";
  name.textContent = model.name;

  const free = document.createElement("span");
  free.className = "model-option-free";
  free.textContent = "FREE";

  top.append(name);

  if (typeof model.provider === "string" && model.provider.trim()) {
    const provider = document.createElement("span");
    provider.className = "model-option-provider";
    provider.textContent = model.provider.trim();
    top.append(provider);
  }

  top.append(free);

  const description = document.createElement("span");
  description.className = "model-option-desc";
  description.textContent = model.description;

  const meta = document.createElement("span");
  meta.className = "model-option-meta";

  for (const tag of Array.isArray(model.tags) ? model.tags : []) {
    const tagElement = document.createElement("span");
    tagElement.className = "model-tag";
    tagElement.textContent = tag;
    meta.appendChild(tagElement);
  }

  const check = document.createElement("span");
  check.className = "material-symbols-rounded model-check";
  check.setAttribute("aria-hidden", "true");
  check.textContent = "check";

  main.append(top, description, meta);
  option.append(main, check);

  option.addEventListener("click", () => selectModel(model.id));
  return option;
}

function renderModelList() {
  modelList.replaceChildren();

  if (state.models.length === 0) return;

  const groups = new Map();

  for (const model of state.models) {
    const category = model.category || "Models";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(model);
  }

  for (const [category, models] of groups) {
    const group = document.createElement("div");
    group.className = "model-group";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", category);

    const label = document.createElement("div");
    label.className = "model-group-label";
    label.textContent = category;

    group.appendChild(label);
    for (const model of models) group.appendChild(createModelOption(model));
    modelList.appendChild(group);
  }
}

function openModelMenu() {
  if (!modelMenu.hidden) return;

  modelMenu.hidden = false;
  modelTrigger.setAttribute("aria-expanded", "true");
  modelSelector.classList.add("is-open");

  // On narrow screens the menu is anchored to the header. Clamp its height to
  // the space left inside the chat card so the footer is never clipped.
  requestAnimationFrame(fitModelMenu);

  const target =
    modelList.querySelector(".model-option.is-selected") ||
    modelList.querySelector(".model-option");
  target?.focus({ preventScroll: true });
}

function fitModelMenu() {
  modelMenu.style.maxHeight = "";

  if (modelMenu.hidden) return;
  if (!window.matchMedia("(max-width: 720px)").matches) return;

  const card = document.querySelector(".chatbot-popup");
  if (!card) return;

  const menuRect = modelMenu.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const available = Math.floor(cardRect.bottom - menuRect.top - 12);

  if (available > 0) {
    modelMenu.style.maxHeight = `${Math.min(455, Math.max(180, available))}px`;
  }
}

function closeModelMenu({ restoreFocus = false } = {}) {
  if (modelMenu.hidden) return;

  modelMenu.hidden = true;
  modelMenu.style.maxHeight = "";
  modelTrigger.setAttribute("aria-expanded", "false");
  modelSelector.classList.remove("is-open");

  if (restoreFocus) modelTrigger.focus({ preventScroll: true });
}

function getVisionModelNames() {
  const names = state.models
    .filter((model) => model.vision)
    .map((model) => model.name);

  return names.length > 0 ? names.join(", ") : "a vision-capable model";
}

function selectModel(modelId) {
  const model = state.models.find((entry) => entry.id === modelId);
  if (!model) return;

  state.selectedModelId = model.id;
  saveSelectedModel(model.id);
  updateModelTrigger();
  renderModelList();
  closeModelMenu({ restoreFocus: true });

  if (userData.file.data && model.vision === false) {
    showComposerNotice(
      `${model.name} cannot read images. Choose ${getVisionModelNames()}, or remove the attachment.`,
      8000,
    );
  }
}

async function loadModels() {
  setModelMenuStatus("Loading models…");

  try {
    const response = await fetch("/api/models", {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (!Array.isArray(data?.models) || data.models.length === 0) {
      throw new Error("The server returned an empty model list.");
    }

    state.models = data.models.filter(
      (model) => model && typeof model.id === "string",
    );
    state.verifiedAt = data.verifiedAt || null;

    const saved = readSavedModel();
    const savedIsValid = state.models.some((model) => model.id === saved);

    if (savedIsValid) {
      state.selectedModelId = saved;
    } else if (state.models.some((model) => model.id === data.defaultModel)) {
      state.selectedModelId = data.defaultModel;
    } else {
      state.selectedModelId = state.models[0].id;
    }

    setModelMenuStatus("");
    renderModelList();
    updateModelTrigger();
  } catch (error) {
    console.error("Could not load the model list:", error);
    state.models = [];
    state.selectedModelId = DEFAULT_MODEL_ID;
    updateModelTrigger();
    setModelMenuStatus(
      "Could not load the model list. Make sure the server is running (or the deployment is healthy), then retry.",
      { withRetry: true },
    );
  }
}

modelTrigger.addEventListener("click", () => {
  if (modelMenu.hidden) openModelMenu();
  else closeModelMenu();
});

modelTrigger.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    openModelMenu();
  }
});

modelList.addEventListener("keydown", (event) => {
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return;

  const options = [...modelList.querySelectorAll(".model-option")];
  if (options.length === 0) return;

  const currentIndex = options.indexOf(document.activeElement);
  let nextIndex;

  if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = options.length - 1;
  else if (event.key === "ArrowDown") {
    nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % options.length;
  } else {
    nextIndex =
      currentIndex < 0
        ? options.length - 1
        : (currentIndex - 1 + options.length) % options.length;
  }

  event.preventDefault();
  options[nextIndex].focus({ preventScroll: true });
});

document.addEventListener("pointerdown", (event) => {
  if (modelMenu.hidden) return;
  if (!modelSelector.contains(event.target)) closeModelMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modelMenu.hidden) {
    event.preventDefault();
    closeModelMenu({ restoreFocus: true });
  }
});

window.addEventListener("resize", () => {
  if (!modelMenu.hidden) requestAnimationFrame(fitModelMenu);
});

/* -------------------------------------------------------------------------- */
/* Chat API                                                                   */
/* -------------------------------------------------------------------------- */

class ChatRequestError extends Error {
  constructor(message, { code = "request_failed", status = 0, retryAfter = null, detail = null } = {}) {
    super(message);
    this.name = "ChatRequestError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
    this.detail = detail;
  }
}

function buildApiMessages(history, currentFile) {
  const lastIndex = history.length - 1;

  return history.map((turn, index) => {
    let text = turn.content;

    if (turn.hadImage && index !== lastIndex) {
      text += "\n\n[An image was attached to this earlier message.]";
    }

    if (index === lastIndex && currentFile?.data) {
      return {
        role: turn.role,
        content: [
          { type: "text", text: turn.content },
          {
            type: "image_url",
            image_url: {
              url: `data:${currentFile.mime_type};base64,${currentFile.data}`,
            },
          },
        ],
      };
    }

    return { role: turn.role, content: text };
  });
}

function trimHistory() {
  if (state.history.length <= MAX_HISTORY_MESSAGES) return;

  state.history = state.history.slice(-MAX_HISTORY_MESSAGES);

  while (state.history.length > 0 && state.history[0].role !== "user") {
    state.history.shift();
  }
}

function errorFromResponse(response, data) {
  const apiError = data?.error;

  return new ChatRequestError(
    typeof apiError?.message === "string" && apiError.message.trim()
      ? apiError.message
      : "The server could not complete the request.",
    {
      code: apiError?.code || "request_failed",
      status: response.status,
      retryAfter:
        Number.isFinite(Number(apiError?.retryAfter)) && Number(apiError.retryAfter) > 0
          ? Number(apiError.retryAfter)
          : null,
      detail: typeof apiError?.detail === "string" ? apiError.detail : null,
    },
  );
}

async function requestBotResponse(botDiv, requestMessages, historyVersion, modelId) {
  const messageElement = botDiv.querySelector(".message-text");

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelId,
        messages: requestMessages,
      }),
    });

    const raw = await response.text();
    let data = null;

    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }

    if (!response.ok) throw errorFromResponse(response, data);

    const reply = typeof data?.message === "string" ? data.message.trim() : "";

    if (!reply) {
      throw new ChatRequestError(
        "The model returned an empty response. Retry, or choose another model.",
        { code: "empty_response", status: response.status },
      );
    }

    messageElement.classList.remove("error-message");
    messageElement.innerText = reply.replace(/\*\*(.*?)\*\*/g, "$1").trim();

    // If the user has not sent another message since this request started,
    // keep the assistant reply in the conversation history.
    if (historyVersion === state.historyVersion) {
      state.history.push({ role: "assistant", content: reply });
      trimHistory();
    }
  } catch (error) {
    const chatError =
      error instanceof ChatRequestError
        ? error
        : new ChatRequestError(
            "Could not reach the server. If you are running locally, make sure it is started; otherwise check your connection and retry.",
            { code: "network_error" },
          );

    renderChatError(botDiv, chatError, { messages: requestMessages, version: historyVersion });
  } finally {
    setRequesting(false);
    botDiv.classList.remove("thinking");
    scrollToBottom();
  }
}

function renderChatError(botDiv, error, retryInfo) {
  const messageElement = botDiv.querySelector(".message-text");
  messageElement.replaceChildren();
  messageElement.classList.add("error-message");

  const heading = document.createElement("div");
  heading.className = "error-heading";

  const icon = document.createElement("span");
  icon.className = "material-symbols-rounded";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "error";

  const headingText = document.createElement("span");
  headingText.textContent = "Couldn't get a response";

  heading.append(icon, headingText);

  const detail = document.createElement("p");
  detail.className = "error-detail";
  detail.textContent = error.message;

  messageElement.append(heading, detail);

  if (error.retryAfter) {
    const wait = document.createElement("p");
    wait.className = "error-hint";
    wait.textContent = `Try again in about ${error.retryAfter} second${error.retryAfter === 1 ? "" : "s"}.`;
    messageElement.appendChild(wait);
  } else if (
    ["rate_limited", "local_rate_limited", "model_unavailable"].includes(
      error.code,
    )
  ) {
    const hint = document.createElement("p");
    hint.className = "error-hint";

    if (error.code === "local_rate_limited") {
      hint.textContent =
        "This browser is sending requests too quickly. Wait a minute, then retry.";
    } else if (error.code === "model_unavailable") {
      hint.textContent = "Choose a different model from the selector.";
    } else {
      hint.textContent =
        "Groq free-plan quotas are shared. Switching to another model may help.";
    }

    messageElement.appendChild(hint);
  } else if (["not_configured", "server_auth_error"].includes(error.code)) {
    const hint = document.createElement("p");
    hint.className = "error-hint";
    hint.textContent =
      "This is a server setup issue. Set a valid GROQ_API_KEY in .env locally or in Vercel Project Settings -> Environment Variables, then redeploy.";
    messageElement.appendChild(hint);
  }

  const actions = document.createElement("div");
  actions.className = "error-actions";

  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "error-action error-retry";
  retry.textContent = "Retry";
  retry.disabled = state.isRequesting;
  retry.addEventListener("click", () => retryBotResponse(botDiv));

  const choose = document.createElement("button");
  choose.type = "button";
  choose.className = "error-action secondary";
  choose.textContent = "Choose another model";
  choose.addEventListener("click", () => openModelMenu());

  actions.append(retry, choose);
  messageElement.appendChild(actions);

  botDiv.__retryInfo = retryInfo;

  if (error.detail) {
    const details = document.createElement("details");
    details.className = "error-details";

    const summary = document.createElement("summary");
    summary.textContent = "Technical details";

    const detailText = document.createElement("p");
    detailText.textContent = error.detail;

    details.append(summary, detailText);
    messageElement.appendChild(details);
  }
}

async function retryBotResponse(botDiv) {
  const retryInfo = botDiv.__retryInfo;
  if (!retryInfo || state.isRequesting) return;

  setRequesting(true);
  botDiv.classList.add("thinking");

  const messageElement = botDiv.querySelector(".message-text");
  messageElement.classList.remove("error-message");
  messageElement.innerHTML = thinkingMarkup;

  scrollToBottom();

  // Use the model currently shown in the selector. The user may have switched
  // after seeing the error; this is an explicit choice, never a silent switch.
  await requestBotResponse(
    botDiv,
    retryInfo.messages,
    retryInfo.version,
    state.selectedModelId,
  );
}

/* -------------------------------------------------------------------------- */
/* Outgoing messages                                                          */
/* -------------------------------------------------------------------------- */

const handleOutgoingMessage = (event) => {
  event?.preventDefault?.();

  if (state.isRequesting) {
    showComposerNotice("Please wait for the current response before sending another message.");
    return;
  }

  const text = messageInput.value.trim();
  if (!text) return;

  const selectedModel = getSelectedModel();

  if (userData.file.data && selectedModel && selectedModel.vision === false) {
    showComposerNotice(
      `${selectedModel.name} cannot read images. Choose ${getVisionModelNames()}, or remove the attachment.`,
      8000,
    );
    openModelMenu();
    return;
  }

  const file = userData.file.data ? { ...userData.file } : null;
  const modelId = state.selectedModelId;
  const attachmentMarkup = file
    ? `<img src="data:${file.mime_type};base64,${file.data}" class="attachment" alt="Attached image" />`
    : "";

  userData.message = text;

  messageInput.value = "";
  messageInput.style.height = `${initialInputHeight}px`;
  fileUploadWrapper.classList.remove("file-uploaded");
  fileUploadWrapper.querySelector("img").src = "";
  userData.file = {};
  hideComposerNotice();

  const outgoingMessageDiv = createMessageElement(
    `<div class="message-text"></div>${attachmentMarkup}`,
    "user-message",
  );
  outgoingMessageDiv.querySelector(".message-text").textContent = text;
  chatBody.appendChild(outgoingMessageDiv);
  scrollToBottom();

  state.history.push({
    role: "user",
    content: text,
    hadImage: Boolean(file),
  });
  trimHistory();

  state.historyVersion += 1;
  const version = state.historyVersion;
  const requestMessages = buildApiMessages(state.history, file);

  setRequesting(true);

  setTimeout(() => {
    const botContent = `${botAvatarMarkup}<div class="message-text">${thinkingMarkup}</div>`;
    const incomingMessageDiv = createMessageElement(
      botContent,
      "bot-message",
      "thinking",
    );

    chatBody.appendChild(incomingMessageDiv);
    scrollToBottom();
    requestBotResponse(incomingMessageDiv, requestMessages, version, modelId);
  }, 500);
};

/* -------------------------------------------------------------------------- */
/* Input, attachments, and demo controls                                      */
/* -------------------------------------------------------------------------- */

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    if (messageInput.value.trim()) {
      event.preventDefault();
      handleOutgoingMessage(event);
    }
  }
});

messageInput.addEventListener("input", () => {
  messageInput.style.height = `${initialInputHeight}px`;
  messageInput.style.height = `${messageInput.scrollHeight}px`;
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  if (!SUPPORTED_IMAGE_TYPES.test(file.type)) {
    showComposerNotice("Unsupported image format. Use a PNG, JPEG, WebP, or GIF image.");
    fileInput.value = "";
    return;
  }

  if (file.size > MAX_IMAGE_BYTES) {
    showComposerNotice("That image is too large. Please use an image under 3 MB.");
    fileInput.value = "";
    return;
  }

  const reader = new FileReader();

  reader.onload = (event) => {
    const dataUrl = event.target.result;
    fileUploadWrapper.querySelector("img").src = dataUrl;
    fileUploadWrapper.classList.add("file-uploaded");

    const base64String = dataUrl.split(",")[1];
    const mimeType = file.type.toLowerCase() === "image/jpg" ? "image/jpeg" : file.type;

    userData.file = {
      data: base64String,
      mime_type: mimeType,
    };

    fileInput.value = "";
    hideComposerNotice();
  };

  reader.onerror = () => {
    showComposerNotice("Could not read that image. Please try another file.");
    fileInput.value = "";
  };

  reader.readAsDataURL(file);
});

fileCancelButton.addEventListener("click", () => {
  userData.file = {};
  fileUploadWrapper.classList.remove("file-uploaded");
  fileUploadWrapper.querySelector("img").src = "";
  fileInput.value = "";
});

sendMessageButton.addEventListener("click", (event) => handleOutgoingMessage(event));
chatForm.addEventListener("submit", (event) => event.preventDefault());
document.querySelector("#file-upload").addEventListener("click", () => fileInput.click());

/* -------------------------------------------------------------------------- */
/* Chat visibility (demo launcher, floating button, close control)             */
/* -------------------------------------------------------------------------- */

const isChatOpen = () => document.body.classList.contains("show-chatbot");

function setChatOpen(isOpen, { scroll = false, focus = false } = {}) {
  document.body.classList.toggle("show-chatbot", isOpen);
  chatbotToggler.setAttribute("aria-expanded", String(isOpen));
  chatFab?.setAttribute("aria-expanded", String(isOpen));

  if (!isOpen) {
    document.body.classList.remove("show-emoji-picker");
    closeModelMenu();
    return;
  }

  if (scroll) {
    requestAnimationFrame(() => {
      chatStage?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  if (focus) {
    setTimeout(() => messageInput.focus({ preventScroll: true }), 150);
  }
}

function openChat(options = {}) {
  setChatOpen(true, options);
}

function closeChat() {
  setChatOpen(false);
}

// "Try With Demo" always opens the panel, even after a previous minimize/close.
chatbotToggler.addEventListener("click", () => {
  openChat({ scroll: true, focus: true });
});

// Floating launcher is visible only while the chat is closed.
chatFab?.addEventListener("click", () => {
  if (isChatOpen()) {
    closeChat();
    chatbotToggler.focus({ preventScroll: true });
    return;
  }

  openChat({ scroll: true, focus: true });
});

closeChatbot.addEventListener("click", () => {
  closeChat();
  chatbotToggler.focus({ preventScroll: true });
});

// Restore the welcome state and clear the conversation sent to the model.
clearChatButton.addEventListener("click", () => {
  if (state.isRequesting) {
    showComposerNotice("Wait for the current response before clearing the chat.");
    return;
  }

  chatBody.innerHTML = initialChatHTML;
  state.history = [];
  state.historyVersion += 1;
  userData.message = null;
  userData.file = {};
  messageInput.value = "";
  fileInput.value = "";
  fileUploadWrapper.classList.remove("file-uploaded");
  fileUploadWrapper.querySelector("img").src = "";
  document.body.classList.remove("show-emoji-picker");
  closeModelMenu();
  hideComposerNotice();
  chatBody.scrollTo({ top: 0, behavior: "smooth" });
  messageInput.focus({ preventScroll: true });
});

/* -------------------------------------------------------------------------- */
/* Emoji picker                                                               */
/* -------------------------------------------------------------------------- */

if (window.EmojiMart?.Picker) {
  const picker = new EmojiMart.Picker({
    theme: "dark",
    skinTonePosition: "none",
    previewPosition: "none",
    onEmojiSelect: (emoji) => {
      const { selectionStart: start, selectionEnd: end } = messageInput;
      messageInput.setRangeText(emoji.native, start, end, "end");
      messageInput.focus();
    },
    onClickOutside: (event) => {
      if (event.target.id === "emoji-picker") {
        document.body.classList.toggle("show-emoji-picker");
      } else {
        document.body.classList.remove("show-emoji-picker");
      }
    },
  });

  chatForm.appendChild(picker);
} else {
  console.warn("Emoji picker failed to load from the CDN.");
  document.querySelector("#emoji-picker")?.addEventListener("click", () => {
    showComposerNotice("The emoji picker is unavailable right now.");
  });
}

/* -------------------------------------------------------------------------- */
/* Boot                                                                       */
/* -------------------------------------------------------------------------- */

// Every page load/refresh starts minimized; only an explicit click opens chat.
setChatOpen(false);
updateModelTrigger();
loadModels();
