import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const VARIABLE_NAMES = {
  enabled: "UPLOAD_SCHEDULE_ENABLED",
  lastSlot: "LAST_UPLOAD_SLOT",
  times: "UPLOAD_SCHEDULE_TIMES",
  timezone: "UPLOAD_SCHEDULE_TIMEZONE"
};

function normalizeDailyTimeToken(token: string) {
  const compact = token.trim().toLowerCase().replace(/\s+/g, "");

  if (!compact) {
    return null;
  }

  const meridiemMatch = compact.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);

  if (meridiemMatch) {
    let hour = Number(meridiemMatch[1]);
    const minute = Number(meridiemMatch[2] ?? "0");
    const meridiem = meridiemMatch[3];

    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) {
      return null;
    }

    if (meridiem === "am") {
      hour = hour === 12 ? 0 : hour;
    } else {
      hour = hour === 12 ? 12 : hour + 12;
    }

    return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
  }

  const clockMatch = compact.match(/^(\d{1,2})(?::(\d{2}))?$/);

  if (!clockMatch) {
    return null;
  }

  const hour = Number(clockMatch[1]);
  const minute = Number(clockMatch[2] ?? "0");

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

function parseScheduleInput(value: string) {
  const tokens = value.split(/[\s,;]+/).filter(Boolean);
  const invalidTokens: string[] = [];
  const times = tokens
    .map((token) => {
      const normalized = normalizeDailyTimeToken(token);

      if (!normalized) {
        invalidTokens.push(token);
      }

      return normalized;
    })
    .filter((time): time is string => Boolean(time));
  const uniqueTimes = [...new Set(times)].sort();

  if (!tokens.length) {
    return { times: uniqueTimes, error: "Add at least one upload time." };
  }

  if (invalidTokens.length) {
    return { times: uniqueTimes, error: `Invalid upload time: ${invalidTokens[0]}.` };
  }

  return { times: uniqueTimes, error: "" };
}

function assertValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return value;
  } catch {
    return "";
  }
}

function githubConfig() {
  const token = process.env.GITHUB_SCHEDULE_TOKEN || process.env.GITHUB_TOKEN || "";
  const repository =
    process.env.GITHUB_REPOSITORY ||
    (process.env.GITHUB_OWNER && process.env.GITHUB_REPO
      ? `${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}`
      : "");
  const missing = [
    token ? "" : "GITHUB_SCHEDULE_TOKEN",
    repository ? "" : "GITHUB_REPOSITORY or GITHUB_OWNER/GITHUB_REPO"
  ].filter(Boolean);

  return { token, repository, missing };
}

async function githubRequest(path: string, init: RequestInit = {}) {
  const { token, repository, missing } = githubConfig();

  if (missing.length) {
    throw new Error(`GitHub schedule is not configured. Missing: ${missing.join(", ")}.`);
  }

  return fetch(`https://api.github.com/repos/${repository}/actions/variables${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...init.headers
    }
  });
}

async function readVariable(name: string) {
  const response = await githubRequest(`/${name}`);

  if (response.status === 404) {
    return "";
  }

  if (!response.ok) {
    throw new Error(`Could not read GitHub variable ${name}.`);
  }

  const payload = (await response.json()) as { value?: string };
  return payload.value ?? "";
}

async function upsertVariable(name: string, value: string) {
  const patchResponse = await githubRequest(`/${name}`, {
    method: "PATCH",
    body: JSON.stringify({ name, value })
  });

  if (patchResponse.status !== 404) {
    if (!patchResponse.ok) {
      throw new Error(`Could not update GitHub variable ${name}.`);
    }

    return;
  }

  const createResponse = await githubRequest("", {
    method: "POST",
    body: JSON.stringify({ name, value })
  });

  if (!createResponse.ok) {
    throw new Error(`Could not create GitHub variable ${name}.`);
  }
}

export async function GET() {
  const { missing } = githubConfig();

  if (missing.length) {
    return NextResponse.json({
      configured: false,
      missing,
      schedule: {
        enabled: false,
        times: [],
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        lastSlot: ""
      }
    });
  }

  try {
    const [enabled, times, timezone, lastSlot] = await Promise.all([
      readVariable(VARIABLE_NAMES.enabled),
      readVariable(VARIABLE_NAMES.times),
      readVariable(VARIABLE_NAMES.timezone),
      readVariable(VARIABLE_NAMES.lastSlot)
    ]);

    return NextResponse.json({
      configured: true,
      missing: [],
      schedule: {
        enabled: enabled === "true",
        times: times.split(",").filter(Boolean),
        timezone: timezone || "UTC",
        lastSlot
      }
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not read GitHub schedule settings.";
    return NextResponse.json({ configured: false, missing: [message] }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      enabled?: boolean;
      times?: string;
      timezone?: string;
    };
    const parsed = parseScheduleInput(body.times ?? "");
    const timezone = assertValidTimeZone(body.timezone || "UTC");

    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    if (!timezone) {
      return NextResponse.json({ error: "Choose a valid timezone." }, { status: 400 });
    }

    await Promise.all([
      upsertVariable(VARIABLE_NAMES.enabled, body.enabled ? "true" : "false"),
      upsertVariable(VARIABLE_NAMES.times, parsed.times.join(",")),
      upsertVariable(VARIABLE_NAMES.timezone, timezone)
    ]);

    return NextResponse.json({
      configured: true,
      schedule: {
        enabled: Boolean(body.enabled),
        times: parsed.times,
        timezone
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save GitHub schedule.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
