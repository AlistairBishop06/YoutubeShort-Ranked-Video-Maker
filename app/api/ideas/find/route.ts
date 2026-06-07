import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type TikWMAuthor = {
  unique_id?: string;
  nickname?: string;
};

type TikWMVideo = {
  video_id?: string;
  title?: string;
  duration?: number;
  play_count?: number;
  digg_count?: number;
  comment_count?: number;
  share_count?: number;
  collect_count?: number;
  cover?: string;
  is_ad?: boolean;
  author?: TikWMAuthor;
};

type Candidate = {
  id: string;
  url: string;
  name: string;
  sourceTitle: string;
  creator: string;
  thumbnail: string;
  duration: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  score: number;
};

const FALLBACK_IDEAS = [
  "funny pets",
  "skiing fails",
  "gym fails",
  "cooking fails",
  "street interviews",
  "travel fails",
  "fashion transformations",
  "satisfying cleaning",
  "dance trends",
  "funny kids",
  "sports fails",
  "unexpected moments"
];

const RECENT_TOPIC_LIMIT = 8;
const SEARCH_BATCH_SIZE = 6;
const MAX_SEARCH_ATTEMPTS = 30;
const recentTopics = globalThis as typeof globalThis & {
  __ytshortRecentIdeaTopics?: Array<{ topic: string; key: string }>;
};

const IMPORTANT_WORD_STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "all",
  "also",
  "and",
  "are",
  "because",
  "best",
  "bro",
  "but",
  "can",
  "cant",
  "could",
  "day",
  "did",
  "dont",
  "edit",
  "editing",
  "ever",
  "for",
  "from",
  "funny",
  "fyp",
  "foryou",
  "foryoupage",
  "have",
  "how",
  "just",
  "like",
  "let",
  "lol",
  "more",
  "new",
  "not",
  "now",
  "of",
  "off",
  "one",
  "only",
  "part",
  "real",
  "shorts",
  "that",
  "the",
  "this",
  "tiktok",
  "top",
  "viral",
  "video",
  "videos",
  "was",
  "what",
  "when",
  "who",
  "why",
  "with",
  "you",
  "your"
]);

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cleanTopic(value: string) {
  return value
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function topicKey(value: string) {
  return cleanTopic(value)
    .replace(/\b(funny|moments|reaction|reactions|tiktok|tiktoks|clips|videos)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function hashtagFromText(value: string) {
  const tag = titleCase(cleanTopic(value))
    .replace(/['-]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "");

  return tag.length >= 3 ? `#${tag}` : "";
}

function sourceHashtags(value: string) {
  return [...value.matchAll(/#([\p{L}\p{N}_-]{3,32})/gu)]
    .map((match) => hashtagFromText(match[1]))
    .filter(Boolean);
}

function sourceTitle(video: TikWMVideo) {
  const title = video.title?.replace(/\s+/g, " ").trim();

  if (title) {
    return title;
  }

  if (video.author?.nickname) {
    return `@${video.author.unique_id ?? video.author.nickname}`;
  }

  return "Viral TikTok";
}

function importantWord(video: TikWMVideo, query: string) {
  const title = sourceTitle(video);
  const topicWords = new Set(cleanTopic(query).split(/\s+/).filter(Boolean));
  const compactTopic = cleanTopic(query).replace(/\s+/g, "");
  const rawWords = [...title.matchAll(/#?[\p{L}\p{N}][\p{L}\p{N}'-]*/gu)].map((match) => match[0]);
  const scored = rawWords
    .map((rawWord, index) => {
      const wasHashtag = rawWord.startsWith("#");
      const normalized = cleanTopic(rawWord.replace(/^#/, ""))
        .replace(/['-]/g, "")
        .replace(/\s+/g, "");

      if (
        normalized.length < 4 ||
        IMPORTANT_WORD_STOPWORDS.has(normalized) ||
        normalized === compactTopic ||
        compactTopic.includes(normalized) ||
        /\d/.test(normalized)
      ) {
        return null;
      }

      const repeatedTopicPenalty = topicWords.has(normalized) ? -2 : 0;
      const hashtagBonus = wasHashtag ? 4 : 0;
      const lengthScore = Math.min(normalized.length, 12);
      const earlyTitleBonus = Math.max(0, 4 - index);

      return {
        word: titleCase(normalized),
        score: lengthScore + hashtagBonus + earlyTitleBonus + repeatedTopicPenalty
      };
    })
    .filter((item): item is { word: string; score: number } => Boolean(item))
    .sort((a, b) => b.score - a.score);

  return scored[0]?.word ?? titleCase(video.author?.unique_id ?? "Viral");
}

function scoreVideo(video: TikWMVideo) {
  const views = video.play_count ?? 0;
  const likes = video.digg_count ?? 0;
  const comments = video.comment_count ?? 0;
  const shares = video.share_count ?? 0;
  const saves = video.collect_count ?? 0;

  // Engagement is weighted higher than raw views so the selected clips are more
  // likely to feel worth ranking instead of merely being broad search matches.
  return views + likes * 8 + comments * 18 + shares * 24 + saves * 12;
}

async function fetchTrendingTerms() {
  try {
    const response = await fetch("https://trends.google.com/trending/rss?geo=US", {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 900 }
    });

    if (!response.ok) {
      return [];
    }

    const xml = await response.text();
    const titles = [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g)]
      .map((match) => cleanTopic(decodeXml(match[1])))
      .filter((term) => term.length >= 3 && term.length <= 48);

    return [...new Set(titles)].slice(0, 10);
  } catch {
    return [];
  }
}

function buildSearchIdeas(trendingTerms: string[]) {
  const trendIdeas = trendingTerms.flatMap((term) => [
    term,
    `${term} funny`,
    `${term} moments`,
    `${term} reaction`
  ]);

  return [...new Set([...trendIdeas, ...FALLBACK_IDEAS])].slice(0, 28);
}

function shuffle<T>(items: T[]) {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function getRecentTopics() {
  recentTopics.__ytshortRecentIdeaTopics ??= [];
  return recentTopics.__ytshortRecentIdeaTopics;
}

function rememberTopic(topic: string) {
  const key = topicKey(topic);
  const recent = getRecentTopics().filter((recentTopic) => recentTopic.key !== key);
  recent.unshift({ topic, key });
  recentTopics.__ytshortRecentIdeaTopics = recent.slice(0, RECENT_TOPIC_LIMIT);
}

async function searchTikWMCandidates(query: string) {
  const url = new URL("https://www.tikwm.com/api/feed/search");
  url.searchParams.set("keywords", query);
  url.searchParams.set("count", "18");
  url.searchParams.set("cursor", "0");

  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" }
  });

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as {
    code?: number;
    data?: { videos?: TikWMVideo[] };
  };

  if (payload.code !== 0 || !Array.isArray(payload.data?.videos)) {
    return [];
  }

  return payload.data.videos
    .filter((video) => {
      const duration = video.duration ?? 0;
      return (
        !video.is_ad &&
        Boolean(video.video_id) &&
        Boolean(video.author?.unique_id) &&
        duration >= 3 &&
        duration <= 120
      );
    })
    .map<Candidate>((video) => {
      const creator = video.author?.unique_id ?? "creator";
      const id = video.video_id ?? "";

      return {
        id,
        url: `https://www.tiktok.com/@${creator}/video/${id}`,
        name: importantWord(video, query),
        sourceTitle: sourceTitle(video),
        creator,
        thumbnail: video.cover ?? "",
        duration: video.duration ?? 0,
        views: video.play_count ?? 0,
        likes: video.digg_count ?? 0,
        comments: video.comment_count ?? 0,
        shares: video.share_count ?? 0,
        score: scoreVideo(video)
      };
    });
}

function uniqueCandidates(candidates: Candidate[]) {
  const seen = new Set<string>();
  const unique: Candidate[] = [];

  for (const candidate of candidates) {
    if (seen.has(candidate.id)) {
      continue;
    }

    seen.add(candidate.id);
    unique.push(candidate);
  }

  return unique;
}

function buildHashtags(topic: string, candidates: Candidate[]) {
  const topicWords = cleanTopic(topic)
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !IMPORTANT_WORD_STOPWORDS.has(word));
  const relatedTags = [
    hashtagFromText(topic),
    ...topicWords.map(hashtagFromText),
    ...candidates.slice(0, 5).map((candidate) => hashtagFromText(candidate.name)),
    ...candidates.slice(0, 5).flatMap((candidate) => sourceHashtags(candidate.sourceTitle)),
    "#TikTokRankings",
    "#Top5",
    "#ViralTikTok",
    "#Shorts",
    "#YouTubeShorts",
    "#FYP",
    "#Trending"
  ].filter(Boolean);

  return [...new Set(relatedTags)].slice(0, 14);
}

function buildDescription(title: string, topic: string, candidates: Candidate[]) {
  const selectedCandidates = candidates.slice(0, 5);
  const featureWords = selectedCandidates
    .map((candidate) => candidate.name)
    .filter(Boolean)
    .slice(0, 4)
    .join(", ");
  const hashtags = buildHashtags(topic, selectedCandidates);

  return {
    hashtags,
    description: [
      `${title} ranked from #5 to #1.`,
      featureWords
        ? `Featuring ${featureWords}. Which clip deserves the top spot?`
        : "Which clip deserves the top spot?",
      "Watch until the end and comment your winner.",
      "",
      hashtags.join(" ")
    ].join("\n")
  };
}

export async function POST() {
  const trendingTerms = await fetchTrendingTerms();
  const recent = getRecentTopics();
  const recentKeys = new Set(recent.map((recentTopic) => recentTopic.key));
  const ideas = shuffle(buildSearchIdeas(trendingTerms));
  const nonRecentIdeas = ideas.filter((idea) => !recentKeys.has(topicKey(idea)));
  const recentIdeas = ideas.filter((idea) => recentKeys.has(topicKey(idea)));
  const orderedIdeas = [...nonRecentIdeas, ...recentIdeas].slice(0, MAX_SEARCH_ATTEMPTS);
  const attempts: Array<{ query: string; count: number }> = [];
  const viableIdeas: Array<{
    idea: string;
    candidates: Candidate[];
    isTrend: boolean;
  }> = [];

  for (let index = 0; index < orderedIdeas.length; index += SEARCH_BATCH_SIZE) {
    const batch = orderedIdeas.slice(index, index + SEARCH_BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (idea) => ({
        idea,
        candidates: uniqueCandidates(await searchTikWMCandidates(idea)).sort(
          (a, b) => b.score - a.score
        )
      }))
    );

    for (const result of batchResults) {
      if (result.status === "rejected") {
        continue;
      }

      const { idea, candidates } = result.value;
      attempts.push({ query: idea, count: candidates.length });

      if (candidates.length >= 5) {
        viableIdeas.push({
          idea,
          candidates,
          isTrend: trendingTerms.includes(idea)
        });
      }
    }

    if (viableIdeas.some(({ idea }) => !recentKeys.has(topicKey(idea)))) {
      break;
    }
  }

  const unusedViableIdeas = viableIdeas.filter(({ idea }) => !recentKeys.has(topicKey(idea)));
  const selectedIdea =
    unusedViableIdeas[Math.floor(Math.random() * unusedViableIdeas.length)] ??
    viableIdeas[Math.floor(Math.random() * viableIdeas.length)];

  if (selectedIdea) {
    rememberTopic(selectedIdea.idea);
    const title = `Top 5 ${titleCase(selectedIdea.idea)} TikToks`;
    const { description, hashtags } = buildDescription(
      title,
      selectedIdea.idea,
      selectedIdea.candidates
    );

    return NextResponse.json({
      topic: selectedIdea.idea,
      title,
      source: selectedIdea.isTrend
        ? "Google Trends + TikWM search"
        : "Viral topic fallback + TikWM search",
      description,
      hashtags,
      candidates: selectedIdea.candidates.slice(0, 12),
      attempts,
      recentTopics: getRecentTopics().map((recentTopic) => recentTopic.topic),
      generatedAt: new Date().toISOString()
    });
  }

  return NextResponse.json(
    {
      error: "Could not find five downloadable TikTok candidates for the current topic set.",
      attempts
    },
    { status: 502 }
  );
}
