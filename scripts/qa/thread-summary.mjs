#!/usr/bin/env node

import { writeFile } from "node:fs/promises";

function usage() {
  console.error("Usage: node scripts/qa/thread-summary.mjs <thread-id> [--out <path>]");
}

function parseArgs(argv) {
  let threadId;
  let outPath;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") {
      outPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (!threadId) {
      threadId = arg;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!threadId) {
    usage();
    process.exit(1);
  }
  return { threadId, outPath };
}

async function readJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Request failed (${response.status}) for ${url}: ${body}`);
  }
  return response.json();
}

const { threadId, outPath } = parseArgs(process.argv.slice(2));
const baseUrl = process.env.BB_SERVER_URL ?? "http://127.0.0.1:4310";

const [thread, sessions, status, health] = await Promise.all([
  readJson(`${baseUrl}/api/v1/threads/${encodeURIComponent(threadId)}`),
  readJson(`${baseUrl}/api/v1/threads/${encodeURIComponent(threadId)}/environment-agent/sessions`).catch(
    () => ({ threadId, sessions: [] }),
  ),
  readJson(`${baseUrl}/api/v1/threads/${encodeURIComponent(threadId)}/events`).catch(() => []),
  readJson(`${baseUrl}/api/v1/system/health`).catch(() => null),
]);

const summary = {
  generatedAt: new Date().toISOString(),
  serverUrl: baseUrl,
  threadId,
  thread: {
    id: thread.id,
    projectId: thread.projectId,
    status: thread.status,
    environmentId: thread.environmentId ?? "local",
    updatedAt: thread.updatedAt,
  },
  recentEventTypes: Array.isArray(status)
    ? status.slice(-10).map((event) => event.type)
    : [],
  sessionCount: Array.isArray(sessions.sessions) ? sessions.sessions.length : 0,
  activeSessionCount: Array.isArray(sessions.sessions)
    ? sessions.sessions.filter((session) => session.status === "active").length
    : 0,
  latestSession:
    Array.isArray(sessions.sessions) && sessions.sessions.length > 0
      ? sessions.sessions[0]
      : null,
  serverHealth: health,
};

const payload = JSON.stringify(summary, null, 2);
if (outPath) {
  await writeFile(outPath, `${payload}\n`, "utf8");
} else {
  console.log(payload);
}
