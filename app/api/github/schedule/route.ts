import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_IDEA_SEARCH_SETTINGS,
  normalizeIdeaSearchSettings,
  parseIdeaSearchIdList,
  type IdeaSearchSettingsInput
} from "../../../lib/idea-options";
import {
  DEFAULT_REDDIT_STORY_SETTINGS,
  normalizeRedditStorySettings,
  parseRedditSubredditIdList,
  type RedditStorySettingsInput
} from "../../../lib/reddit-options";

export const runtime = "nodejs";

const VARIABLE_NAMES = {
  enabled: "UPLOAD_SCHEDULE_ENABLED",
  ideaCreators: "UPLOAD_IDEA_CREATOR_IDS",
  ideaTitles: "UPLOAD_IDEA_TITLE_IDS",
  redditSubreddits: "UPLOAD_STORY_SUBREDDIT_IDS",
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

async function variableExists(name: string) {
  const response = await githubRequest(`/${name}`);

  if (response.status === 404) {
    return false;
  }

  if (!response.ok) {
    throw await githubResponseError("read", name, response);
  }

  return true;
}

async function githubResponseError(action: string, name: string, response: Response) {
  const details = await response.text();
  const suffix = details ? ` ${details}` : "";

  return new Error(
    `Could not ${action} GitHub variable ${name}. GitHub returned ${response.status}.${suffix}`
  );
}

async function readOptionalVariable(name: string) {
  try {
    return await readVariable(name);
  } catch {
    return "";
  }
}

async function upsertVariable(name: string, value: string) {
  const exists = await variableExists(name);

  if (!exists) {
    const createResponse = await githubRequest("", {
      method: "POST",
      body: JSON.stringify({ name, value })
    });

    if (createResponse.status === 409) {
      const retryResponse = await githubRequest(`/${name}`, {
        method: "PATCH",
        body: JSON.stringify({ name, value })
      });

      if (!retryResponse.ok) {
        throw await githubResponseError("update", name, retryResponse);
      }

      return;
    }

    if (!createResponse.ok) {
      throw await githubResponseError("create", name, createResponse);
    }

    return;
  }

  const patchResponse = await githubRequest(`/${name}`, {
    method: "PATCH",
    body: JSON.stringify({ name, value })
  });

  if (!patchResponse.ok) {
    throw await githubResponseError("update", name, patchResponse);
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
        ideaSearch: DEFAULT_IDEA_SEARCH_SETTINGS,
        redditStory: DEFAULT_REDDIT_STORY_SETTINGS,
        times: [],
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        lastSlot: ""
      }
    });
  }

  try {
    const [enabled, times, timezone, ideaCreators, ideaTitles, redditSubreddits] = await Promise.all([
      readOptionalVariable(VARIABLE_NAMES.enabled),
      readOptionalVariable(VARIABLE_NAMES.times),
      readOptionalVariable(VARIABLE_NAMES.timezone),
      readOptionalVariable(VARIABLE_NAMES.ideaCreators),
      readOptionalVariable(VARIABLE_NAMES.ideaTitles),
      readOptionalVariable(VARIABLE_NAMES.redditSubreddits)
    ]);
    const lastSlot = await readOptionalVariable(VARIABLE_NAMES.lastSlot);
    const ideaSearch = normalizeIdeaSearchSettings({
      creatorIds: parseIdeaSearchIdList(ideaCreators),
      titleIds: parseIdeaSearchIdList(ideaTitles)
    });
    const redditStory = normalizeRedditStorySettings({
      subredditIds: parseRedditSubredditIdList(redditSubreddits)
    });

    return NextResponse.json({
      configured: true,
      missing: [],
      schedule: {
        enabled: enabled === "true",
        ideaSearch: {
          creatorIds: ideaSearch.creatorIds,
          titleIds: ideaSearch.titleIds
        },
        redditStory: {
          subredditIds: redditStory.subredditIds
        },
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
      ideaSearch?: IdeaSearchSettingsInput;
      redditStory?: RedditStorySettingsInput;
      times?: string;
      timezone?: string;
    };
    const parsed = parseScheduleInput(body.times ?? "");
    const timezone = assertValidTimeZone(body.timezone || "UTC");
    const ideaSearch = normalizeIdeaSearchSettings(body.ideaSearch);
    const redditStory = normalizeRedditStorySettings(body.redditStory);

    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    if (!timezone) {
      return NextResponse.json({ error: "Choose a valid timezone." }, { status: 400 });
    }

    await upsertVariable(VARIABLE_NAMES.enabled, body.enabled ? "true" : "false");
    await upsertVariable(VARIABLE_NAMES.ideaCreators, ideaSearch.creatorIds.join(","));
    await upsertVariable(VARIABLE_NAMES.ideaTitles, ideaSearch.titleIds.join(","));
    await upsertVariable(VARIABLE_NAMES.redditSubreddits, redditStory.subredditIds.join(","));
    await upsertVariable(VARIABLE_NAMES.times, parsed.times.join(","));
    await upsertVariable(VARIABLE_NAMES.timezone, timezone);

    return NextResponse.json({
      configured: true,
      schedule: {
        enabled: Boolean(body.enabled),
        ideaSearch: {
          creatorIds: ideaSearch.creatorIds,
          titleIds: ideaSearch.titleIds
        },
        redditStory: {
          subredditIds: redditStory.subredditIds
        },
        times: parsed.times,
        timezone
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save GitHub schedule.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
