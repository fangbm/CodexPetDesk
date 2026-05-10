#!/usr/bin/env node

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const args = process.argv.slice(2);
const agent = valueAfter("--agent") || "code";
const rawEvent = valueAfter("--event") || "complete";
const argvJson = args.find((arg) => arg.trim().startsWith("{"));
const argvText = args.filter((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--")).join(" ");
const PORT_FILES = [
  path.join(os.homedir(), ".codex-pet-desk", "port"),
  path.join(os.tmpdir(), "codex-pet-desk-port")
];

let handled = false;
if (argvJson) {
  handle(argvJson);
} else {
  const chunks = [];
  process.stdin.on("data", (chunk) => chunks.push(chunk));
  process.stdin.on("end", () => handle(Buffer.concat(chunks).toString("utf8")));
  setTimeout(() => handle(""), 300);
}

function handle(input) {
  if (handled) return;
  handled = true;

  const context = enrichContext(parseJson(input), input);
  const event = normalizeEvent(context);
  if (!event) return;

  const title = resolveTitle(context, event);
  const message = resolveMessage(context, event);

  writeEvent({
    type: event,
    agent,
    title: truncate(title, 72),
    message: truncate(message, event === "approval" ? 220 : 180),
    cwd: context.cwd || context.workingDirectory || context.working_directory || "",
    timestamp: Date.now()
  });

  postEvent({
    agent,
    session_id: context.session_id || context.sessionId || context["thread-id"] || `${agent}-${process.ppid}`,
    event: toCopiwaifuEvent(event),
    data: {
      tool_name: context.tool_name || context.toolName || context.name || agent,
      summary: truncate(message, event === "approval" ? 220 : 180),
      working_directory: context.cwd || context.workingDirectory || context.working_directory || "",
      session_title: truncate(title, 180),
      needs_attention: event === "approval",
      turn_start: event === "running",
      turn_fingerprint: title || message
    }
  });
}

function normalizeEvent(context) {
  const value = String(context.type || context.event || rawEvent || "").trim();
  const haystack = [
    value,
    context.kind,
    context.name,
    context.tool_name,
    context.toolName,
    context.message,
    context.summary,
    context.reason
  ].filter(Boolean).join(" ").toLowerCase();

  if (/(permission|approval|approve|confirm|confirmation|consent|authorize|auth|sandbox|escalat)/i.test(haystack)) {
    return "approval";
  }
  if (["Stop", "SessionEnd", "agentStop", "complete", "completed", "done"].includes(value)) {
    return "complete";
  }
  if (["running", "thinking", "tool_use", "tool_result", "notify"].includes(value)) {
    return "running";
  }
  if (/(complete|completed|done|finish|finished|sessionend|agentstop|stop)/i.test(haystack)) {
    return "complete";
  }
  if (/(start|running|thinking|tool|exec|command|notify|prompt|task)/i.test(haystack) || hasPromptContent(context)) {
    return "running";
  }
  return null;
}

function writeEvent(event) {
  try {
    const dir = path.join(os.homedir(), ".codex-pet-desk");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "hook-events.jsonl"), `${JSON.stringify(event)}\n`);
  } catch {}
}

function postEvent(payload) {
  const port = readPort();
  if (!port) return;
  postJson(port, "/event", payload, 800);
}

function readPort() {
  for (const file of PORT_FILES) {
    try {
      const port = Number(fs.readFileSync(file, "utf8").trim());
      if (Number.isInteger(port) && port > 0) return port;
    } catch {}
  }
  return 0;
}

function postJson(port, route, payload, timeout) {
  try {
    const body = JSON.stringify(payload);
    const request = http.request({
      host: "127.0.0.1",
      port,
      path: route,
      method: "POST",
      timeout,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    });
    request.on("error", () => {});
    request.on("timeout", () => request.destroy());
    request.end(body);
  } catch {}
}

function toCopiwaifuEvent(event) {
  if (event === "approval") return "permission_request";
  if (event === "complete") return "complete";
  return "tool_use";
}

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : "";
}

function pickText(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (text) return text;
  }
  return "";
}

function resolveTitle(context, event) {
  if (event === "approval") return "需要审批";
  return firstLine(pickText(
    context.sessionTitle,
    context.session_title,
    context.title,
    promptFromMessages(context),
    context.prompt,
    context.userPrompt,
    context.user_prompt,
    context.message
  ) || "Code 任务进行中");
}

function resolveMessage(context, event) {
  if (event === "complete") return "任务已经完成。";
  if (event === "approval") {
    return pickText(
      context.reason,
      context.message,
      context.prompt,
      context.summary,
      stringifyInput(context.tool_input || context.toolInput || context.input)
    ) || "有一个操作需要你审批。";
  }
  return pickText(
    promptFromMessages(context),
    context.prompt,
    context.userPrompt,
    context.user_prompt,
    context.summary,
    context.message,
    stringifyInput(context.tool_input || context.toolInput || context.input)
  ) || "任务正在进行中。";
}

function hasPromptContent(context) {
  return Boolean(promptFromMessages(context) || context.prompt || context.userPrompt || context.user_prompt);
}

function promptFromMessages(context) {
  const messages = context["input-messages"] || context.inputMessages || context.messages;
  if (!Array.isArray(messages)) return "";
  const userMessage = messages.find((message) => message && message.role === "user") || messages[0];
  const content = userMessage && userMessage.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content.find((item) => item && item.type === "text" && typeof item.text === "string");
    if (text) return text.text;
  }
  return "";
}

function stringifyInput(input) {
  if (!input) return "";
  if (typeof input === "string") return input;
  if (typeof input !== "object") return "";
  return pickText(input.command, input.path, input.file_path, input.prompt, input.query) || JSON.stringify(input);
}

function firstLine(value) {
  return String(value || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function truncate(value, limit) {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

function enrichContext(context, input) {
  const plainText = [input, argvText].map((value) => String(value || "").trim()).find(Boolean);
  const latestSession = latestCodexSessionContext();
  return {
    ...latestSession,
    ...context,
    message: pickText(context.message, context.summary, plainText, latestSession.message),
    prompt: pickText(context.prompt, context.userPrompt, context.user_prompt, latestSession.prompt)
  };
}

function latestCodexSessionContext() {
  try {
    const root = path.join(os.homedir(), ".codex", "sessions");
    const file = latestJsonl(root);
    if (!file) return {};
    const lines = fs.readFileSync(file, "utf8").trimEnd().split(/\r?\n/).slice(-500).reverse();
    let prompt = "";
    let title = "";
    for (const line of lines) {
      const value = parseJson(line);
      if (!title) title = textFromPath(value, ["payload", "last_agent_message"]);
      if (!prompt) prompt = findUserText(value);
      if (prompt && title) break;
    }
    return {
      sessionTitle: firstLine(prompt || title),
      prompt: prompt || title,
      message: prompt || title
    };
  } catch {
    return {};
  }
}

function latestJsonl(dir) {
  if (!fs.existsSync(dir)) return "";
  let best = "";
  let bestTime = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = latestJsonl(fullPath);
      if (nested) {
        const time = fs.statSync(nested).mtimeMs;
        if (time > bestTime) {
          best = nested;
          bestTime = time;
        }
      }
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const time = fs.statSync(fullPath).mtimeMs;
    if (time > bestTime) {
      best = fullPath;
      bestTime = time;
    }
  }
  return best;
}

function findUserText(value) {
  if (!value || typeof value !== "object") return "";
  if (value.role === "user") return stringifyContent(value.content) || pickText(value.text, value.message);
  if (value.payload) {
    const fromPayload = findUserText(value.payload);
    if (fromPayload) return fromPayload;
  }
  if (Array.isArray(value.items)) {
    const textItem = value.items.find((item) => item && (item.type === "input_text" || item.type === "text"));
    if (textItem) return pickText(textItem.text, textItem.content);
  }
  if (Array.isArray(value.content)) {
    const text = stringifyContent(value.content);
    if (text) return text;
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      const text = findUserText(child);
      if (text) return text;
    }
  }
  return "";
}

function stringifyContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => pickText(item && item.text, item && item.content))
    .filter(Boolean)
    .join("\n");
}

function textFromPath(value, keys) {
  let cursor = value;
  for (const key of keys) {
    cursor = cursor && cursor[key];
  }
  return typeof cursor === "string" ? cursor : "";
}
