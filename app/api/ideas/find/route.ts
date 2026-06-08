import { NextRequest, NextResponse } from "next/server";

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
  "sidemen irl moments",
  "sidemen challenge fails",
  "sidemen awkward moments",
  "sidemen football moments",
  "sidemen roast moments",
  "speed funny moments",
  "speed irl moments",
  "speed stream fails",
  "speed fan interactions",
  "speed rage moments",
  "speed awkward moments",
  "speed football moments",
  "speed chat moments",
  "kai cenat funny moments",
  "kai cenat stream fails",
  "kai cenat room moments",
  "kai cenat fan interactions",
  "kai cenat rage moments",
  "ishowspeed funny moments",
  "ishowspeed stream fails",
  "ishowspeed fan interactions",
  "ishowspeed irl moments",
  "ishowspeed rage moments",
  "mrbeast funny moments",
  "mrbeast challenge moments",
  "mrbeast awkward moments",
  "mrbeast contestant moments",
  "ksi funny moments",
  "ksi try not to laugh",
  "ksi roast moments",
  "ksi rage moments",
  "ksi sidemen moments",
  "logan paul funny moments",
  "logan paul podcast moments",
  "logan paul awkward moments",
  "danny aarons funny moments",
  "danny aarons rage moments",
  "danny aarons football moments",
  "adin ross funny moments",
  "adin ross stream fails",
  "adin ross fan interactions",
  "adin ross awkward moments",
  "adin ross rage moments",
  "caseoh funny moments",
  "caseoh crashout moments",
  "caseoh rage moments",
  "caseoh chat moments",
  "caseoh stream fails",
  "fanum funny moments",
  "fanum tax moments",
  "fanum stream moments",
  "beta squad funny moments",
  "beta squad public moments",
  "beta squad challenge fails",
  "beta squad roast moments",
  "amp funny moments",
  "amp stream fails",
  "amp irl moments",
  "amp challenge moments",
  "nelk boys funny moments",
  "nelk boys prank fails",
  "nelk boys public moments",
  "filly funny moments",
  "filly public moments",
  "filly roast moments",
  "chunkz funny moments",
  "chunkz public moments",
  "chunkz football moments",
  "jidion funny moments",
  "jidion prank fails",
  "jidion public moments",
  "xqc funny moments",
  "xqc rage moments",
  "xqc stream fails",
  "xqc chat moments",
  "streamer funny moments",
  "streamer rage moments",
  "streamer awkward moments",
  "streamer fan interactions",
  "youtuber funny moments",
  "youtuber irl moments",
  "youtuber challenge fails",
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

const CREATOR_NAMES = [
  "speed",
  "ishowspeed",
  "sidemen",
  "ksi",
  "kai cenat",
  "caseoh",
  "adin ross",
  "xqc",
  "amp",
  "beta squad",
  "mrbeast",
  "logan paul",
  "danny aarons",
  "fanum",
  "chunkz",
  "jidion",
  "nelk boys",
  "filly"
];

const CREATOR_VARIANTS = [
  "funny moments",
  "irl moments",
  "stream fails",
  "rage moments",
  "fan interactions",
  "awkward moments",
  "roast moments",
  "challenge fails",
  "chat moments",
  "unexpected moments",
  "caught lacking",
  "crashout moments",
  "public moments",
  "reaction moments",
  "best clips",
  "live moments"
];

const GENERAL_VARIANT_TOPICS = [
  "streamer rage moments",
  "streamer fan interactions",
  "streamer awkward moments",
  "streamer gets roasted",
  "youtuber challenge fails",
  "youtuber irl moments",
  "youtube creator awkward moments",
  "twitch chat funny moments",
  "live stream gone wrong",
  "public interview funny moments",
  "football creator funny moments",
  "gaming rage moments",
  "creator collab funny moments",
  "prank gone wrong",
  "try not to laugh streamer",
  "viral creator crashout"
];

const RECENT_TOPIC_LIMIT = 18;
const RECENT_CANDIDATE_LIMIT = 120;
const SEARCH_BATCH_SIZE = 6;
const MAX_SEARCH_ATTEMPTS = 42;
const SEARCH_CANDIDATE_COUNT = 30;
const PREFERRED_MAX_SOURCE_SECONDS = 60;
const HARD_MAX_SOURCE_SECONDS = 90;
const recentTopics = globalThis as typeof globalThis & {
  __ytshortRecentIdeaTopics?: Array<{ topic: string; key: string }>;
  __ytshortRecentCandidateIds?: string[];
};

const REJECT_SOURCE_PATTERNS = [
  /\btop\s*\d+\b/i,
  /\brank(?:ing|ed|s)?\b/i,
  /\bcompilation\b/i,
  /\bcomp\b/i,
  /\bbest\s+tiktoks?\b/i,
  /\btiktok\s+compilation\b/i,
  /\btry\s+not\s+to\s+laugh\s+compilation\b/i,
  /\bfull\s+(?:video|stream|episode)\b/i,
  /\bpart\s*\d+\b/i,
  /\breupload\b/i
];

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
  "absolute violation",
  "instant regret",
  "he crashed out",
  "chat went silent",
  "chat was screaming",
  "caught lacking",
  "bro lost it",
  "that was personal",
  "he was not ready",
  "absolute chaos",
  "he knew he messed up",
  "that escalated fast",
  "the room went silent",
  "everyone lost it",
  "instant karma",
  "too far",
  "wild reaction",
  "awkward silence",
  "bro folded instantly",
  "no way this happened",
  "this got personal",
  "unreal timing"
];

const CREATOR_LABELS: Record<string, string[]> = {
  caseoh: ["caseoh got pressed", "caseoh almost lost it", "chat roasted caseoh", "caseoh got humbled", "caseoh crashout"],
  speed: ["speed saw red", "speed started screaming", "speed got humbled", "speed went silent", "no way speed said that"],
  ishowspeed: ["speed saw red", "speed started screaming", "speed got humbled", "speed went silent", "no way speed said that"],
  sidemen: ["sidemen violation", "the boys lost it", "sidemen cooked him", "sidemen chaos", "the room went silent"],
  ksi: ["ksi got humbled", "ksi started laughing", "ksi got violated", "ksi lost it", "no way ksi said that"],
  xqc: ["xqc saw red", "xqc lost it", "chat cooked him", "xqc rage moment", "xqc got humbled"],
  "kai cenat": ["kai lost it", "kai got humbled", "kai got violated", "chat had kai crying", "no way kai said that"],
  mrbeast: ["mrbeast chaos", "no way he did that", "mrbeast went too far", "wild mrbeast moment", "everyone panicked"],
  "logan paul": ["logan got cooked", "logan got humbled", "no way logan said that", "logan went too far", "the room froze"],
  "adin ross": ["adin got cooked", "adin got humbled", "no way adin said that", "chat cooked him", "adin lost it"],
  "beta squad": ["beta squad violation", "chunkz got cooked", "the room went silent", "they took it too far", "everyone folded"],
  "nelk boys": ["full send chaos", "nelk went too far", "steve got cooked", "prank went wrong", "instant regret"],
  streamer: ["streamer crashout", "chat went silent", "chat was screaming", "live on stream", "stream went wrong"],
  youtuber: ["creator got humbled", "no way he posted that", "creator got cooked", "comments went wild", "instant regret"],
  youtube: ["youtube chaos", "creator got humbled", "no way he posted that", "comments went wild", "instant regret"],
  twitch: ["twitch crashout", "chat went silent", "chat was screaming", "live on stream", "stream went wrong"]
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

function displayCreatorName(value: string) {
  return titleCase(value).toLowerCase();
}

function labelOptionsForCue(title: string, creator: string) {
  const name = creator ? displayCreatorName(creator) : "";

  if (/\b(scream|screaming|yell|yelling|shout|rage|mad|angry)\b/.test(title)) {
    return name
      ? [`${name} saw red`, `${name} started screaming`, `${name} lost it`, "chat was screaming"]
      : ["he started screaming", "chat was screaming", "everyone lost it", "bro lost it"];
  }

  if (/\b(laugh|laughing|crying|cried|funny|hilarious)\b/.test(title)) {
    return name
      ? [`${name} had them crying`, `${name} could not stop laughing`, "everyone was crying", "chat was crying"]
      : ["everyone was crying", "chat was crying", "he could not stop laughing", "no way this happened"];
  }

  if (/\b(awkward|silent|silence|speechless|quiet)\b/.test(title)) {
    return ["the room went silent", "awkward silence", "he was not ready", "that got awkward fast"];
  }

  if (/\b(fail|fails|wrong|regret|karma)\b/.test(title)) {
    return ["instant regret", "instant karma", "he knew he messed up", "that escalated fast"];
  }

  if (/\b(roast|cooked|violation|violated|humbled|clowned)\b/.test(title)) {
    return name
      ? [`${name} got humbled`, `${name} got cooked`, `${name} got violated`, "absolute violation"]
      : ["absolute violation", "he got cooked", "he got humbled", "that was personal"];
  }

  if (/\b(chat|stream|live)\b/.test(title)) {
    return ["chat was screaming", "chat went silent", "live on stream", "stream went wrong"];
  }

  if (/\b(no\s*way|wild|crazy|insane|unreal)\b/.test(title)) {
    return ["no way this happened", "absolute chaos", "unreal timing", "everyone lost it"];
  }

  return null;
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
  const cueLabels = labelOptionsForCue(title, creator);

  if (cueLabels) {
    return pickBySeed(cueLabels, seed);
  }

  if (title.includes("violation") || title.includes("violated") || title.includes("roast") || title.includes("cooked")) {
    return creator ? `${displayCreatorName(creator)} got violated` : "absolute violation";
  }

  if (title.includes("crashout") || title.includes("crash out")) {
    return creator ? `${displayCreatorName(creator)} crashout` : "he crashed out";
  }

  if (title.includes("said") || title.includes("says") || title.includes("speechless")) {
    return creator ? `no way ${displayCreatorName(creator)} said that` : "no way he said that";
  }

  if (title.includes("reaction") || title.includes("reacts")) {
    return creator ? `${displayCreatorName(creator)} lost it` : "wild reaction";
  }

  if (title.includes("fail") || title.includes("fails")) {
    return "instant regret";
  }

  if (topWord && !creatorLabels) {
    return pickBySeed([`${topWord} moment`, `${topWord} chaos`, `${topWord} reaction`], seed).toLowerCase();
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
  const duration = video.duration ?? 0;
  const durationMultiplier = duration > PREFERRED_MAX_SOURCE_SECONDS ? 0.42 : duration > 45 ? 0.72 : 1;

  // Engagement is weighted higher than raw views so the selected clips are more
  // likely to feel worth ranking instead of merely being broad search matches.
  return (views + likes * 8 + comments * 18 + shares * 24 + saves * 12) * durationMultiplier;
}

function isRejectedSourceVideo(video: TikWMVideo) {
  const title = sourceTitle(video);
  const duration = video.duration ?? 0;

  if (duration < 3 || duration > HARD_MAX_SOURCE_SECONDS) {
    return true;
  }

  return REJECT_SOURCE_PATTERNS.some((pattern) => pattern.test(title));
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
  const creatorIdeas = CREATOR_NAMES.flatMap((creator) =>
    shuffle(CREATOR_VARIANTS).slice(0, 10).map((variant) => `${creator} ${variant}`)
  );
  const trendIdeas = trendingTerms.flatMap((term) => [
    `${term} moments`,
    `${term} funny moments`,
    `${term} reaction`,
    `${term} awkward moments`,
    `${term} fails`,
    `${term} fan reaction`
  ]);

  return [...new Set([...creatorIdeas, ...FALLBACK_IDEAS, ...GENERAL_VARIANT_TOPICS, ...trendIdeas])];
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

function getRecentCandidateIds() {
  recentTopics.__ytshortRecentCandidateIds ??= [];
  return recentTopics.__ytshortRecentCandidateIds;
}

function rememberTopic(topic: string) {
  const key = topicKey(topic);
  const recent = getRecentTopics().filter((recentTopic) => recentTopic.key !== key);
  recent.unshift({ topic, key });
  recentTopics.__ytshortRecentIdeaTopics = recent.slice(0, RECENT_TOPIC_LIMIT);
}

function rememberCandidateIds(ids: string[]) {
  const recent = getRecentCandidateIds().filter((id) => !ids.includes(id));
  recent.unshift(...ids);
  recentTopics.__ytshortRecentCandidateIds = recent.slice(0, RECENT_CANDIDATE_LIMIT);
}

async function searchTikWMCandidates(query: string, cursor = 0) {
  const url = new URL("https://www.tikwm.com/api/feed/search");
  url.searchParams.set("keywords", query);
  url.searchParams.set("count", String(SEARCH_CANDIDATE_COUNT));
  url.searchParams.set("cursor", String(cursor));

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
        !isRejectedSourceVideo(video) &&
        duration >= 3 &&
        duration <= HARD_MAX_SOURCE_SECONDS
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

async function searchVariedCandidates(query: string) {
  const relatedQuery = shuffle([
    `${query} clips`,
    `${query} tiktok`,
    `${query} viral`,
    `${query} best moments`
  ])[0];
  const cursor = shuffle([0, 12, 24])[0];
  const results = await Promise.allSettled(
    [
      searchTikWMCandidates(query, 0),
      cursor === 0 ? Promise.resolve([]) : searchTikWMCandidates(query, cursor),
      searchTikWMCandidates(relatedQuery, 0)
    ]
  );

  return uniqueCandidates(
    results.flatMap((result) => (result.status === "fulfilled" ? result.value : []))
  );
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

function weightedSample(candidates: Candidate[], count: number) {
  const remaining = [...candidates];
  const selected: Candidate[] = [];
  const usedCreators = new Set<string>();

  while (remaining.length && selected.length < count) {
    const creatorDiversePool = remaining.filter((candidate) => !usedCreators.has(candidate.creator));
    const pool =
      creatorDiversePool.length >= count - selected.length ? creatorDiversePool : remaining;
    const weights = pool.map((candidate) => Math.max(1, Math.log10(candidate.score + 10)));
    const totalWeight = weights.reduce((total, weight) => total + weight, 0);
    let cursor = Math.random() * totalWeight;
    let pickedIndex = 0;

    for (let index = 0; index < pool.length; index += 1) {
      cursor -= weights[index];

      if (cursor <= 0) {
        pickedIndex = index;
        break;
      }
    }

    const picked = pool[pickedIndex];
    selected.push(picked);
    usedCreators.add(picked.creator);

    const removeIndex = remaining.findIndex((candidate) => candidate.id === picked.id);

    if (removeIndex >= 0) {
      remaining.splice(removeIndex, 1);
    }
  }

  return selected;
}

function rotateCandidates(candidates: Candidate[], excludedIds: Set<string>) {
  const scoreSorted = [...candidates].sort((a, b) => b.score - a.score);
  const freshCandidates = scoreSorted.filter((candidate) => !excludedIds.has(candidate.id));
  const primaryPool = (freshCandidates.length >= 5 ? freshCandidates : scoreSorted).slice(0, 24);
  const selected = weightedSample(primaryPool, 5).sort((a, b) => b.score - a.score);
  const selectedIds = new Set(selected.map((candidate) => candidate.id));
  const filler = scoreSorted
    .filter((candidate) => !selectedIds.has(candidate.id))
    .map((candidate) => ({
      candidate,
      sortScore: candidate.score * (0.85 + Math.random() * 0.3)
    }))
    .sort((a, b) => b.sortScore - a.sortScore)
    .map(({ candidate }) => candidate);

  return [...selected, ...filler];
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
    "#ViralClips",
    "#FunnyClips",
    "#FunnyMoments",
    "#WatchTillTheEnd",
    "#ComedyShorts",
    "#StreamerMoments",
    "#MustWatch",
    "#Shorts",
    "#YouTubeShorts",
    "#FYP",
    "#Trending"
  ].filter(Boolean);

  return [...new Set(relatedTags)].slice(0, 14);
}

function emojiPack(topic: string) {
  const clean = cleanTopic(topic);

  if (clean.includes("fail") || clean.includes("crashout")) {
    return ["💀", "😂", "🔥"];
  }

  if (clean.includes("stream") || clean.includes("twitch") || clean.includes("youtube")) {
    return ["🎮", "😂", "🔥"];
  }

  if (clean.includes("pet") || clean.includes("kid")) {
    return ["😂", "😱", "🏆"];
  }

  return ["😂", "🔥", "😱"];
}

function buildDescription(title: string, topic: string, candidates: Candidate[]) {
  const selectedCandidates = candidates.slice(0, 5);
  const [laughEmoji, fireEmoji, shockEmoji] = emojiPack(topic);
  const featureWords = selectedCandidates
    .map((candidate) => candidate.name)
    .filter(Boolean)
    .slice(0, 4)
    .join(", ");
  const hashtags = buildHashtags(topic, selectedCandidates);

  return {
    hashtags,
    description: [
      `${laughEmoji} ${title} ranked from #5 to #1 ${fireEmoji}`,
      `${shockEmoji} Wait for #1... it gets WILD.`,
      featureWords
        ? `Best moments: ${featureWords} ${laughEmoji}`
        : `Which clip deserves the top spot? ${laughEmoji}`,
      `Who got cooked the hardest? Comment your winner 👇`,
      `Subscribe for more funny moments 🏆`,
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

function topicSubject(topic: string) {
  const subject = cleanTopic(topic)
    .replace(/\b(funny|moments?|clips?|best|viral)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return titleCase(subject || topic);
}

function generatedViralTitle(topic: string) {
  const subject = topicSubject(topic);
  const clean = cleanTopic(topic);
  const templates = [
    `Top 5 ${subject} Clips That Got Worse`,
    `Top 5 ${subject} Moments You Can't Skip`,
    `Top 5 ${subject} Clips That Had Everyone Crying`,
    `Top 5 ${subject} Moments That Went Too Far`,
    `Top 5 ${subject} Clips That Get Wilder`
  ];

  if (clean.includes("stream") || clean.includes("twitch") || clean.includes("chat")) {
    templates.push(
      `Top 5 ${subject} Moments That Had Chat Screaming`,
      `Top 5 ${subject} Clips That Went Wild Live`
    );
  }

  if (clean.includes("fail") || clean.includes("rage") || clean.includes("crashout")) {
    templates.push(
      `Top 5 ${subject} Moments That Got Worse`,
      `Top 5 ${subject} Clips They Instantly Regretted`
    );
  }

  if (clean.includes("fan") || clean.includes("public") || clean.includes("awkward")) {
    templates.push(
      `Top 5 ${subject} Moments That Got Awkward Fast`,
      `Top 5 ${subject} Clips That Made Everyone Freeze`
    );
  }

  return pickBySeed(templates, `${topic}:${Date.now()}:${Math.random()}`);
}

function buildViralDescription(title: string, topic: string, candidates: Candidate[]) {
  const selectedCandidates = candidates.slice(0, 5);
  const [laughEmoji, fireEmoji, shockEmoji] = emojiPack(topic);
  const featureWords = selectedCandidates
    .map((candidate) => candidate.name)
    .filter(Boolean)
    .slice(0, 5)
    .join(", ");
  const hashtags = buildHashtags(topic, selectedCandidates);

  return {
    hashtags,
    description: [
      `${laughEmoji} ${title} ${fireEmoji}`,
      `${shockEmoji} The countdown gets crazier every clip. Wait for #1.`,
      featureWords
        ? `Featured moments: ${featureWords} ${laughEmoji}`
        : `Which moment deserves the top spot? ${laughEmoji}`,
      "Comment the funniest clip and share this with someone who would replay #1.",
      `New creator rankings dropping soon. Subscribe for more ${fireEmoji}`,
      "",
      hashtags.join(" ")
    ].join("\n")
  };
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { excludeIds?: string[] };
  const excludedIds = new Set([
    ...getRecentCandidateIds(),
    ...(Array.isArray(body.excludeIds) ? body.excludeIds : [])
  ]);
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
        candidates: rotateCandidates(await searchVariedCandidates(idea), excludedIds)
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
    rememberCandidateIds(selectedIdea.candidates.slice(0, 5).map((candidate) => candidate.id));
    const title = generatedViralTitle(selectedIdea.idea);
    const { description, hashtags } = buildViralDescription(
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
