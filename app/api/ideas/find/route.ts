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
  "sidemen funny moments",
  "speed funny moments",
  "kai cenat funny moments",
  "ishowspeed funny moments",
  "mrbeast funny moments",
  "ksi funny moments",
  "logan paul funny moments",
  "danny aarons funny moments",
  "adin ross funny moments",
  "caseoh funny moments",
  "fanum funny moments",
  "beta squad funny moments",
  "amp funny moments",
  "nelk boys funny moments",
  "filly funny moments",
  "chunkz funny moments",
  "jidion funny moments",
  "xqc funny moments",
  "streamer funny moments",
  "youtuber funny moments",
  "youtube funny moments",
  "twitch funny moments",
  "creator funny moments",
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
const CREATOR_IDEA_COUNT = 23;
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
  "game",
  "gamer",
  "games",
  "have",
  "highlight",
  "highlights",
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
  "official",
  "one",
  "only",
  "part",
  "prank",
  "pranks",
  "real",
  "shorts",
  "streamer",
  "streamers",
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

const HANDLE_WORD_PATTERNS = [
  "clip",
  "clips",
  "funny",
  "moment",
  "moments",
  "official",
  "stream",
  "streamer",
  "tiktok",
  "twitch",
  "youtube"
];

const REACTION_LABELS = [
  "no way he said that",
  "violation",
  "instant regret",
  "he crashed out",
  "chat went silent",
  "caught lacking",
  "bro lost it",
  "that was personal",
  "he was not ready",
  "absolute chaos",
  "rage moment",
  "too far",
  "wild reaction",
  "awkward silence",
  "unreal timing"
];

const CREATOR_LABELS: Record<string, string[]> = {
  caseoh: ["caseoh crashout", "caseoh got violated", "caseoh rage moment", "chat cooked him"],
  speed: ["speed lost it", "speed crashout", "speed went crazy", "no way speed said that"],
  ishowspeed: ["speed lost it", "speed crashout", "speed went crazy", "no way speed said that"],
  sidemen: ["sidemen violation", "sidemen chaos", "the boys lost it", "sidemen cooked him"],
  ksi: ["ksi got violated", "ksi crashout", "ksi lost it", "no way ksi said that"],
  xqc: ["xqc crashout", "xqc lost it", "chat cooked him", "xqc rage moment"],
  "kai cenat": ["kai lost it", "kai crashout", "kai got violated", "no way kai said that"],
  mrbeast: ["mrbeast chaos", "no way he did that", "mrbeast went too far", "wild mrbeast moment"],
  "logan paul": ["logan got cooked", "logan crashout", "no way logan said that", "logan went too far"],
  "adin ross": ["adin got cooked", "adin crashout", "no way adin said that", "chat cooked him"],
  "beta squad": ["beta squad violation", "chunkz got cooked", "the room went silent", "they took it too far"],
  "nelk boys": ["full send chaos", "nelk went too far", "steve got cooked", "prank went wrong"],
  streamer: ["streamer crashout", "chat went silent", "no way he said that", "live on stream"],
  youtuber: ["youtuber crashout", "no way he posted that", "creator got cooked", "comments went wild"],
  youtube: ["youtube chaos", "creator got cooked", "no way he posted that", "comments went wild"],
  twitch: ["twitch crashout", "chat went silent", "live on stream", "stream went wrong"]
};

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
    .replace(
      /\b(funny|moments|reaction|reactions|streamer|streamers|youtuber|youtubers|youtube|twitch|tiktok|tiktoks|clips|videos)\b/g,
      " "
    )
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

function labelSeed(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function pickBySeed<T>(items: T[], seed: string) {
  return items[labelSeed(seed) % items.length];
}

function creatorFromQuery(query: string) {
  const clean = cleanTopic(query);

  for (const creator of Object.keys(CREATOR_LABELS)) {
    if (clean.includes(creator)) {
      return creator;
    }
  }

  return "";
}

function importantWords(video: TikWMVideo, query: string) {
  const title = sourceTitle(video);
  const topicWords = new Set(cleanTopic(query).split(/\s+/).filter(Boolean));
  const compactTopic = cleanTopic(query).replace(/\s+/g, "");
  const rawWords = [...title.matchAll(/#?[\p{L}\p{N}][\p{L}\p{N}'-]*/gu)].map((match) => match[0]);
  return rawWords
    .map((rawWord, index) => {
      const wasHashtag = rawWord.startsWith("#");
      const normalized = cleanTopic(rawWord.replace(/^#/, ""))
        .replace(/['-]/g, "")
        .replace(/\s+/g, "");

      if (
        normalized.length < 4 ||
        normalized.length > 14 ||
        IMPORTANT_WORD_STOPWORDS.has(normalized) ||
        HANDLE_WORD_PATTERNS.some((pattern) => normalized.includes(pattern)) ||
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
        raw: normalized,
        score: lengthScore + hashtagBonus + earlyTitleBonus + repeatedTopicPenalty
      };
    })
    .filter((item): item is { word: string; raw: string; score: number } => Boolean(item))
    .sort((a, b) => b.score - a.score);
}

function viralClipLabel(video: TikWMVideo, query: string) {
  const title = cleanTopic(sourceTitle(video));
  const seed = `${video.video_id ?? ""}:${sourceTitle(video)}:${query}`;
  const creator = creatorFromQuery(query);
  const creatorLabels = creator ? CREATOR_LABELS[creator] : null;
  const words = importantWords(video, query);
  const topWord = words[0]?.raw ?? "";

  if (creatorLabels && (title.includes("rage") || title.includes("mad") || title.includes("angry"))) {
    return pickBySeed(creatorLabels.filter((label) => label.includes("crashout") || label.includes("rage")), seed);
  }

  if (title.includes("violation") || title.includes("violated") || title.includes("roast") || title.includes("cooked")) {
    return creator ? `${titleCase(creator).toLowerCase()} got violated` : "violation";
  }

  if (title.includes("crashout") || title.includes("crash out")) {
    return creator ? `${titleCase(creator).toLowerCase()} crashout` : "he crashed out";
  }

  if (title.includes("said") || title.includes("says") || title.includes("speechless")) {
    return creator ? `no way ${titleCase(creator).toLowerCase()} said that` : "no way he said that";
  }

  if (title.includes("reaction") || title.includes("reacts")) {
    return creator ? `${titleCase(creator).toLowerCase()} lost it` : "wild reaction";
  }

  if (title.includes("fail") || title.includes("fails")) {
    return "instant regret";
  }

  if (creatorLabels) {
    return pickBySeed(creatorLabels, seed);
  }

  return pickBySeed(REACTION_LABELS, seed);
}

function deDuplicateLabels(candidates: Candidate[]) {
  const used = new Set<string>();

  return candidates.map((candidate) => {
    if (!used.has(candidate.name)) {
      used.add(candidate.name);
      return candidate;
    }

    const fallback = REACTION_LABELS.find((label) => !used.has(label)) ?? `${candidate.name} moment`;
    used.add(fallback);
    return { ...candidate, name: fallback };
  });
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
    `${term} moments`,
    `${term} funny moments`,
    `${term} reaction`
  ]);

  return [...new Set([...FALLBACK_IDEAS, ...trendIdeas])].slice(0, 44);
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

  const candidates = payload.data.videos
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
        name: viralClipLabel(video, query),
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

  return deDuplicateLabels(candidates);
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

function generatedTitle(topic: string) {
  const titled = titleCase(topic);

  if (/\b(funny|moments|fails|reaction|reactions)\b/i.test(topic)) {
    return `Top 5 ${titled}`;
  }

  return `Top 5 ${titled} Funny Moments`;
}

export async function POST() {
  const trendingTerms = await fetchTrendingTerms();
  const recent = getRecentTopics();
  const recentKeys = new Set(recent.map((recentTopic) => recentTopic.key));
  const allIdeas = buildSearchIdeas(trendingTerms);
  const ideas = [
    ...shuffle(allIdeas.slice(0, CREATOR_IDEA_COUNT)),
    ...shuffle(allIdeas.slice(CREATOR_IDEA_COUNT))
  ];
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
    const title = generatedTitle(selectedIdea.idea);
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
