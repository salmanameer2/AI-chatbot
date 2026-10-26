"use strict";

// Frontend behaviour tests for the chat launcher. These run the real
// public/script.js inside a tiny DOM stub so no browser or dependency is needed.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const publicDir = path.join(__dirname, "..", "public");
const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
const css = fs.readFileSync(path.join(publicDir, "style.css"), "utf8");
const script = fs.readFileSync(path.join(publicDir, "script.js"), "utf8");

function createClassList(initialClasses = []) {
  const classes = new Set(initialClasses);

  return {
    add(...names) {
      for (const name of names) classes.add(name);
    },
    remove(...names) {
      for (const name of names) classes.delete(name);
    },
    toggle(name, force) {
      const shouldAdd =
        force === undefined ? !classes.has(name) : Boolean(force);
      if (shouldAdd) classes.add(name);
      else classes.delete(name);
      return shouldAdd;
    },
    contains(name) {
      return classes.has(name);
    },
  };
}

function createElement(tag = "div", initialClasses = []) {
  const attributes = new Map();
  const children = [];
  const listeners = new Map();

  const element = {
    tagName: tag.toUpperCase(),
    hidden: false,
    disabled: false,
    focused: false,
    value: "",
    files: [],
    scrollHeight: 44,
    scrollTop: 0,
    title: "",
    dataset: {},
    style: {},
    classList: createClassList(initialClasses),
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    hasAttribute(name) {
      return attributes.has(name);
    },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    dispatch(type, event = {}) {
      for (const handler of listeners.get(type) || []) {
        handler({
          preventDefault() {},
          target: element,
          key: "",
          ...event,
        });
      }
    },
    appendChild(child) {
      children.push(child);
      return child;
    },
    append(...nodes) {
      children.push(...nodes);
    },
    replaceChildren(...nodes) {
      children.length = 0;
      children.push(...nodes);
    },
    querySelector(selector) {
      let child = children.find((entry) => entry.__selector === selector);
      if (!child) {
        child = createElement("span");
        child.__selector = selector;
        children.push(child);
      }
      return child;
    },
    querySelectorAll() {
      return [];
    },
    focus() {
      element.focused = true;
    },
    scrollTo() {},
    scrollIntoView() {},
    setRangeText() {},
    click() {
      element.dispatch("click");
    },
    getBoundingClientRect() {
      return { top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 };
    },
  };

  Object.defineProperty(element, "innerHTML", {
    get() {
      return element.__innerHTML || "";
    },
    set(value) {
      element.__innerHTML = String(value);
    },
  });

  Object.defineProperty(element, "textContent", {
    get() {
      return element.__textContent || "";
    },
    set(value) {
      element.__textContent = String(value);
    },
  });

  return element;
}

function createDom() {
  const elements = new Map();
  const body = createElement("body");

  body.innerHTML = '<div class="message bot-message">Welcome</div>';

  const get = (selector) => {
    if (selector === "body") return body;

    if (!elements.has(selector)) {
      const element = createElement("div");
      element.__selector = selector;

      if (selector === "#model-menu") element.hidden = true;

      elements.set(selector, element);
    }

    return elements.get(selector);
  };

  const document = {
    body,
    querySelector: (selector) => get(selector),
    querySelectorAll: () => [],
    createElement: (tag) => createElement(tag),
    addEventListener() {},
  };

  const window = {
    EmojiMart: undefined,
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
  };

  const sandbox = {
    document,
    window,
    console: { log() {}, warn() {}, error() {}, info() {} },
    fetch: async () => {
      throw new Error("offline test");
    },
    requestAnimationFrame: (callback) => {
      callback();
      return 1;
    },
    cancelAnimationFrame() {},
    setTimeout: (callback) => {
      callback();
      return 1;
    },
    clearTimeout() {},
  };

  return { sandbox, get, body };
}

test("initial markup keeps the chatbot minimized", () => {
  const bodyTag = html.match(/<body\b([^>]*)>/i);
  assert.ok(bodyTag, "index.html should have a body tag");
  assert.doesNotMatch(
    bodyTag[1],
    /\bshow-chatbot\b/,
    "the page must not start with the chat panel open",
  );

  const togglerTag = html.match(/<button[^>]*id="chatbot-toggler"[^>]*>/i);
  assert.ok(togglerTag, "index.html should have the Try With Demo button");
  assert.match(togglerTag[0], /aria-expanded="false"/);

  const fabTag = html.match(/<button[^>]*id="chat-fab"[^>]*>/i);
  assert.ok(fabTag, "index.html should have a floating chat launcher");
  assert.match(fabTag[0], /aria-expanded="false"/);

  assert.match(
    css,
    /body:not\(\.show-chatbot\)\s+\.chat-stage\s*\{[^}]*display:\s*none/,
    "the chat stage should be hidden until show-chatbot is set",
  );
  assert.match(css, /\.chat-fab\s*\{/, "the floating launcher should be styled");
});

test("boots minimized, and Try With Demo opens the chat", async () => {
  const dom = createDom();

  vm.runInNewContext(script, dom.sandbox, { filename: "script.js" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const toggler = dom.get("#chatbot-toggler");
  const closeButton = dom.get("#close-chatbot");
  const fab = dom.get("#chat-fab");
  const input = dom.get(".message-input");

  assert.equal(
    dom.body.classList.contains("show-chatbot"),
    false,
    "the chat should start minimized on load",
  );
  assert.equal(toggler.getAttribute("aria-expanded"), "false");
  assert.equal(fab.getAttribute("aria-expanded"), "false");

  toggler.dispatch("click");

  assert.equal(
    dom.body.classList.contains("show-chatbot"),
    true,
    "Try With Demo should open the chat immediately",
  );
  assert.equal(toggler.getAttribute("aria-expanded"), "true");
  assert.equal(fab.getAttribute("aria-expanded"), "true");
  assert.equal(input.focused, true, "the message input should be ready for typing");

  closeButton.dispatch("click");
  assert.equal(dom.body.classList.contains("show-chatbot"), false);
  assert.equal(toggler.getAttribute("aria-expanded"), "false");
  assert.equal(fab.getAttribute("aria-expanded"), "false");

  // Reopening after a close works from the floating launcher.
  fab.dispatch("click");
  assert.equal(dom.body.classList.contains("show-chatbot"), true);
  assert.equal(fab.getAttribute("aria-expanded"), "true");

  // And Try With Demo still opens it after it was minimized again.
  closeButton.dispatch("click");
  toggler.dispatch("click");
  assert.equal(dom.body.classList.contains("show-chatbot"), true);
});
