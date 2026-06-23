import { XMLParser } from "fast-xml-parser";
import { NextRequest, NextResponse } from "next/server";
import {
  normalizeRedditStorySettings,
  parseRedditSubredditIdList
} from "../../../lib/reddit-options";

export const runtime = "nodejs";
export const maxDuration = 20;

const MAX_STORY_CHARACTERS = 6000;
const MIN_IDEA_CHARACTERS = 500;
const FEED_CACHE_TTL_MS = 30 * 60 * 1000;
const STORY_FEEDS = [
  "top/.rss?t=week",
  "top/.rss?t=month",
  "top/.rss?t=year",
  "hot/.rss",
  "new/.rss"
] as const;
const REDDIT_USER_AGENT = "ytshort-story-maker/1.0";

type RedditStory = {
  title: string;
  story: string;
  subreddit: string;
  author: string;
  sourceUrl: string;
};

type CachedFeed = {
  stories: RedditStory[];
  fetchedAt: number;
};

const feedCache = new Map<string, CachedFeed>();

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    )
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/gi, "\"")
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&nbsp;|&#32;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function cleanRedditText(value: unknown) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/\[(.*?)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_~>#`]/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanRedditHtml(value: unknown) {
  const html = String(value || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  const withoutFooter = html.split(/\s+submitted by\s+/i)[0];

  // RSS content is entity-encoded twice in places, so decode it twice before cleanup.
  return cleanRedditText(decodeHtmlEntities(decodeHtmlEntities(withoutFooter)));
}

function truncateAtCharacterLimit(value: string, limit = MAX_STORY_CHARACTERS) {
  if (value.length <= limit) {
    return value;
  }

  const shortened = value.slice(0, limit);
  const sentenceEnd = Math.max(
    shortened.lastIndexOf("."),
    shortened.lastIndexOf("!"),
    shortened.lastIndexOf("?")
  );

  return sentenceEnd > shortened.length * 0.72
    ? shortened.slice(0, sentenceEnd + 1)
    : shortened.trimEnd();
}

function redditJsonUrl(value: string) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  if (host !== "reddit.com" && host !== "old.reddit.com" && host !== "redd.it") {
    throw new Error("Enter a valid Reddit post URL.");
  }

  if (host === "redd.it") {
    return url;
  }

  url.pathname = `${url.pathname.replace(/\/$/, "").replace(/\.json$/, "")}.json`;
  url.search = "?raw_json=1";
  return url;
}

async function fetchRedditJson(value: string) {
  const initialUrl = redditJsonUrl(value);
  let targetUrl = initialUrl;

  if (initialUrl.hostname.toLowerCase() === "redd.it") {
    const redirectResponse = await fetch(initialUrl, {
      headers: { "User-Agent": REDDIT_USER_AGENT },
      redirect: "follow",
      signal: AbortSignal.timeout(10000)
    });
    targetUrl = redditJsonUrl(redirectResponse.url);
  }

  const clientId = process.env.REDDIT_CLIENT_ID?.trim();
  const clientSecret = process.env.REDDIT_CLIENT_SECRET?.trim();
  let requestUrl = targetUrl;
  let authorization = "";

  if (clientId && clientSecret) {
    const tokenResponse = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": REDDIT_USER_AGENT
      },
      body: "grant_type=client_credentials",
      cache: "no-store",
      signal: AbortSignal.timeout(10000)
    });

    if (!tokenResponse.ok) {
      throw new Error("Reddit OAuth credentials were rejected.");
    }

    const tokenPayload = (await tokenResponse.json()) as { access_token?: string };

    if (!tokenPayload.access_token) {
      throw new Error("Reddit did not return an access token.");
    }

    authorization = `Bearer ${tokenPayload.access_token}`;
    requestUrl = new URL(
      `${targetUrl.pathname.replace(/\.json$/, "")}?raw_json=1`,
      "https://oauth.reddit.com"
    );
  }

  const response = await fetch(requestUrl, {
    headers: {
      Accept: "application/json",
      ...(authorization ? { Authorization: authorization } : {}),
      "User-Agent": REDDIT_USER_AGENT
    },
    cache: "no-store",
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    const setupHint = clientId && clientSecret
      ? "Check the Reddit app credentials."
      : "Add Reddit API credentials or paste the story manually.";
    throw new Error(`Reddit returned ${response.status}. ${setupHint}`);
  }

  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("json")) {
    throw new Error("Reddit did not return post data. Paste the story manually instead.");
  }

  return response.json();
}

function xmlText(value: unknown) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (value && typeof value === "object" && "#text" in value) {
    return String((value as { "#text"?: unknown })["#text"] || "");
  }

  return "";
}

function storyFromFeedFields({
  title: rawTitle,
  content,
  author: rawAuthor,
  sourceUrl,
  subreddit
}: {
  title: unknown;
  content: unknown;
  author: unknown;
  sourceUrl: string;
  subreddit: string;
}): RedditStory | null {
  const title = cleanRedditText(rawTitle);
  const story = cleanRedditHtml(content);

  if (
    !title ||
    !story ||
    story.length < MIN_IDEA_CHARACTERS ||
    story.length > MAX_STORY_CHARACTERS ||
    /\bnsfw\b/i.test(`${title} ${story}`)
  ) {
    return null;
  }

  return {
    title,
    story,
    subreddit: `r/${subreddit}`,
    author: cleanRedditText(rawAuthor),
    sourceUrl
  };
}

function rssEntryToStory(entry: Record<string, unknown>, subreddit: string) {
  const authorNode = entry.author as { name?: unknown } | undefined;
  const linkNodes = Array.isArray(entry.link) ? entry.link : [entry.link];
  const sourceUrl = linkNodes
    .map((link) => (link && typeof link === "object" ? String((link as { "@_href"?: unknown })["@_href"] || "") : ""))
    .find((link) => link.includes("reddit.com/r/")) || "";

  return storyFromFeedFields({
    title: xmlText(entry.title),
    content: xmlText(entry.content),
    author: authorNode?.name,
    sourceUrl,
    subreddit
  });
}

async function fetchStoriesThroughRssRelay(subreddit: string, feed: string) {
  const redditFeed = `https://www.reddit.com/r/${subreddit}/${feed}`;
  const relayUrl = new URL("https://api.rss2json.com/v1/api.json");
  relayUrl.searchParams.set("rss_url", redditFeed);
  const response = await fetch(relayUrl, {
    headers: { "User-Agent": REDDIT_USER_AGENT },
    next: { revalidate: FEED_CACHE_TTL_MS / 1000 },
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as {
    status?: string;
    items?: Array<{
      title?: unknown;
      description?: unknown;
      content?: unknown;
      author?: unknown;
      link?: unknown;
    }>;
  };

  if (payload.status !== "ok" || !Array.isArray(payload.items)) {
    return [];
  }

  return payload.items
    .map((item) =>
      storyFromFeedFields({
        title: item.title,
        content: item.content || item.description,
        author: item.author,
        sourceUrl: String(item.link || ""),
        subreddit
      })
    )
    .filter((story): story is RedditStory => Boolean(story));
}

function redditStoryId(sourceUrl: string) {
  return sourceUrl.match(/\/comments\/([a-z0-9]+)\//i)?.[1] || sourceUrl;
}

function pickStory(stories: RedditStory[], excludedIds: Set<string>) {
  const unseenStories = stories.filter((story) => !excludedIds.has(redditStoryId(story.sourceUrl)));
  const pool = unseenStories.length ? unseenStories : stories;
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

async function findRedditStoryIdea(subreddits: string[], excludedIds = new Set<string>()) {
  const attempts = [...subreddits]
    .sort(() => Math.random() - 0.5)
    .map((subreddit) => ({
      subreddit,
      feed: STORY_FEEDS[Math.floor(Math.random() * STORY_FEEDS.length)]
    }));

  for (const { subreddit, feed } of attempts) {
    const cacheKey = `${subreddit}:${feed}`;
    const cached = feedCache.get(cacheKey);

    if (cached && Date.now() - cached.fetchedAt < FEED_CACHE_TTL_MS) {
      const cachedStory = pickStory(cached.stories, excludedIds);

      if (cachedStory) {
        return cachedStory;
      }
    }

    try {
      let entries: RedditStory[] = [];
      const response = await fetch(`https://www.reddit.com/r/${subreddit}/${feed}`, {
        headers: {
          Accept: "application/atom+xml, application/xml, text/xml",
          "User-Agent": REDDIT_USER_AGENT
        },
        next: { revalidate: FEED_CACHE_TTL_MS / 1000 },
        signal: AbortSignal.timeout(12000)
      });

      if (response.ok) {
        const xml = await response.text();
        const parsed = new XMLParser({ ignoreAttributes: false, processEntities: true }).parse(xml);
        const rawEntries = parsed?.feed?.entry;
        entries = (Array.isArray(rawEntries) ? rawEntries : [rawEntries])
          .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"))
          .map((entry) => rssEntryToStory(entry, subreddit))
          .filter((story): story is RedditStory => Boolean(story));
      }

      if (!entries.length) {
        entries = await fetchStoriesThroughRssRelay(subreddit, feed);
      }

      if (entries.length) {
        feedCache.set(cacheKey, { stories: entries, fetchedAt: Date.now() });
        const story = pickStory(entries, excludedIds);

        if (story) {
          return story;
        }
      }

      if (cached?.stories.length) {
        const staleStory = pickStory(cached.stories, excludedIds);

        if (staleStory) {
          return staleStory;
        }
      }
    } catch {
      if (cached?.stories.length) {
        const staleStory = pickStory(cached.stories, excludedIds);

        if (staleStory) {
          return staleStory;
        }
      }
      // Try the next allowed subreddit when one feed is temporarily unavailable.
    }
  }

  throw new Error("Reddit did not return a suitable story. Try again in a moment.");
}

export async function GET(request: NextRequest) {
  try {
    const storySettings = normalizeRedditStorySettings({
      subredditIds: parseRedditSubredditIdList(
        request.nextUrl.searchParams.get("subredditIds") || undefined
      )
    });
    const excludedIds = new Set(
      String(request.nextUrl.searchParams.get("excludeIds") || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    );
    return NextResponse.json(await findRedditStoryIdea(storySettings.subreddits, excludedIds));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not find a Reddit story.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as { url?: string };
    const url = String(payload.url || "").trim();

    if (!url) {
      return NextResponse.json({ error: "Enter a Reddit post URL." }, { status: 400 });
    }

    const data = await fetchRedditJson(url);
    const post = data?.[0]?.data?.children?.[0]?.data;

    if (!post) {
      throw new Error("Could not find a story in that Reddit post.");
    }

    if (post.over_18) {
      return NextResponse.json(
        { error: "NSFW Reddit posts are not supported by this mode." },
        { status: 400 }
      );
    }

    const topComment = data?.[1]?.data?.children?.find(
      (child: { kind?: string; data?: { body?: string } }) =>
        child?.kind === "t1" && child?.data?.body
    )?.data?.body;
    const title = cleanRedditText(post.title);
    const body = cleanRedditText(post.selftext || topComment);

    if (!title || !body) {
      throw new Error("This post has no readable story text. Paste the story manually instead.");
    }

    return NextResponse.json({
      title,
      story: truncateAtCharacterLimit(body),
      subreddit: cleanRedditText(post.subreddit_name_prefixed || post.subreddit),
      author: cleanRedditText(post.author),
      sourceUrl: String(post.url || url)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not import the Reddit story.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
