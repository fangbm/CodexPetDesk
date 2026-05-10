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
  const event = normalizeEvent(context.type || rawEvent);
  if (event !== "complete") return;

  const message = pickText(
    context.summary,
    context.message,
    context.result,
    context.description,
    context["last-assistant-message"],
    context.last_assistant_message
  ) || "任务已经完成";

  writeEvent({
    type: "complete",
    agent,
    message: truncate(message, 160),
    cwd: context.cwd || context.workingDirectory || context.working_directory || "",
    timestamp: Date.now()
  });
}

function normalizeEvent(event) {
  const value = String(event || "").trim();
  if (["Stop", "SessionEnd", "agentStop", "complete", "completed", "done"].includes(value)) {
    return "complete";
  }
  if (agent === "codex" && rawEvent === "notify") return "complete";
  return value.toLowerCase();
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
