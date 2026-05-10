#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const args = process.argv.slice(2);
const agent = valueAfter("--agent") || "code";
const rawEvent = valueAfter("--event") || "complete";
const argvJson = args.find((arg) => arg.trim().startsWith("{"));

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

  const context = parseJson(input);
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
