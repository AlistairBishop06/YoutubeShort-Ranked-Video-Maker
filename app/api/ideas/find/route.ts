import { NextRequest, NextResponse } from "next/server";
import {
  normalizeIdeaSearchSettings,
  type IdeaSearchSettingsInput,
  type NormalizedIdeaSearchSettings
} from "../../../lib/idea-options";

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

type CachedIdea = {
  topic: string;
  key: string;
  candidates: Candidate[];
  cachedAt: number;
};

type TikWMCooldown = {
  blockedUntil: number;
  reason: string;
  status: number;
};

type SearchAttempt = {
  query: string;
  count: number;
  error?: string;
  source?: string;
};

class TikWMBlockedError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "TikWMBlockedError";
    this.status = status;
  }
}

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
  "jynxzi rage moments",
  "jynxzi funny moments",
  "plaqueboymax stream moments",
  "plaqueboymax funny moments",
  "stable ronaldo rage moments",
  "sketch funny moments",
  "duke dennis funny moments",
  "duke dennis amp moments",
  "agent 00 funny moments",
  "rdcworld funny moments",
  "rdcworld skits",
  "niko omilana public moments",
  "max fosh awkward moments",
  "faze rug prank fails",
  "stokes twins funny moments",
  "ryan trahan challenge moments",
  "dude perfect trickshot fails",
  "flamingo roblox funny moments",
  "kreekcraft roblox moments",
  "preston funny moments",
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
  "filly",
  "jynxzi",
  "plaqueboymax",
  "stable ronaldo",
  "sketch",
  "lacy",
  "cinna",
  "ray asianboy",
  "jasontheween",
  "duke dennis",
  "agent 00",
  "yourrage",
  "chrisnxtdoor",
  "imdavisss",
  "rdcworld",
  "niko omilana",
  "max fosh",
  "faze rug",
  "faze clan",
  "stokes twins",
  "ryan trahan",
  "airrack",
  "dude perfect",
  "mark rober",
  "flamingo",
  "kreekcraft",
  "preston",
  "unspeakable",
  "lazarbeam",
  "lachlan",
  "ninja",
  "clix",
  "nick eh 30",
  "sypherpk",
  "timthetatman",
  "ludwig",
  "hasanabi",
  "asmongold",
  "zackrawrr",
  "valkyrae",
  "pokimane",
  "coryxkenshin",
  "markiplier",
  "jacksepticeye",
  "dantdm",
  "chris md",
  "willne",
  "calfreezy",
  "deji",
  "sharky",
  "aj shabeel",
  "miniminter",
  "zerkaa",
  "vikkstar",
  "W2S",
  "WroeToShaw"
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
  "viral creator crashout",
  "roblox streamer funny moments",
  "fortnite streamer rage moments",
  "youtube group challenge fails",
  "creator public prank moments",
  "creator charity challenge moments",
  "streamer donation reactions",
  "tiktok live funny moments",
  "gaming creator rage moments",
  "content house funny moments",
  "youtube prank gone wrong",
  "creator football challenge moments",
  "roblox voice chat funny moments"
];

const RANK_COUNT = 5;
const RECENT_TOPIC_LIMIT = 18;
const RECENT_CANDIDATE_LIMIT = 120;
const MAX_SEARCH_ATTEMPTS = 6;
const SEARCH_CANDIDATE_COUNT = 18;
const SEARCH_REQUEST_DELAY_MS = 1400;
const TIKWM_COOLDOWN_MS = 60 * 60 * 1000;
const IDEA_CACHE_LIMIT = 48;
const IDEA_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PREFERRED_MAX_SOURCE_SECONDS = 60;
const HARD_MAX_SOURCE_SECONDS = 90;
const recentTopics = globalThis as typeof globalThis & {
  __ytshortRecentIdeaTopics?: Array<{ topic: string; key: string }>;
  __ytshortRecentCandidateIds?: string[];
  __ytshortIdeaCandidateCache?: CachedIdea[];
  __ytshortTikWMCooldown?: TikWMCooldown;
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
  jynxzi: ["jynxzi got cooked", "jynxzi lost it", "chat roasted jynxzi", "jynxzi rage moment", "jynxzi went silent"],
  plaqueboymax: ["max got cooked", "max lost it", "chat had max crying", "max was not ready", "plaqueboymax chaos"],
  "stable ronaldo": ["ronaldo crashout", "stable got cooked", "ronaldo lost it", "chat cooked stable", "stable was not ready"],
  sketch: ["sketch went too far", "sketch got caught", "sketch had them crying", "no way sketch said that", "sketch chaos"],
  lacy: ["lacy got cooked", "lacy lost it", "chat cooked lacy", "lacy went silent", "lacy crashout"],
  cinna: ["cinna got cooked", "cinna lost it", "chat had cinna crying", "cinna was not ready", "cinna chaos"],
  "ray asianboy": ["ray got cooked", "ray lost it", "chat cooked ray", "ray was not ready", "ray chaos"],
  jasontheween: ["jason got cooked", "jason lost it", "chat cooked jason", "jason went silent", "jason chaos"],
  "duke dennis": ["duke got cooked", "duke lost it", "duke was not ready", "amp cooked duke", "duke chaos"],
  "agent 00": ["agent got cooked", "agent lost it", "amp cooked agent", "agent was not ready", "agent chaos"],
  yourrage: ["rage got cooked", "rage lost it", "chat cooked rage", "rage was not ready", "yourrage chaos"],
  chrisnxtdoor: ["chris got cooked", "chris lost it", "amp cooked chris", "chris was not ready", "chris chaos"],
  imdavisss: ["davis got cooked", "davis lost it", "amp cooked davis", "davis was not ready", "davis chaos"],
  rdcworld: ["rdcworld chaos", "mark got cooked", "rdc had them crying", "rdcworld went too far", "the skit got real"],
  "niko omilana": ["niko went too far", "niko got caught", "niko had them panicking", "niko public chaos", "instant regret"],
  "max fosh": ["max made it awkward", "max went too far", "max got caught", "the room froze", "max fosh chaos"],
  "faze rug": ["rug prank went wrong", "rug got cooked", "faze rug chaos", "no way rug did that", "instant regret"],
  "faze clan": ["faze chaos", "faze got cooked", "faze prank went wrong", "no way faze did that", "the room froze"],
  "stokes twins": ["stokes prank went wrong", "the twins got caught", "stokes chaos", "instant regret", "no way they did that"],
  "ryan trahan": ["ryan got humbled", "ryan challenge chaos", "ryan was not ready", "instant regret", "ryan had them crying"],
  airrack: ["airrack went too far", "airrack challenge chaos", "airrack got caught", "instant regret", "no way airrack did that"],
  "dude perfect": ["trickshot chaos", "dude perfect fail", "no way that missed", "everyone panicked", "instant regret"],
  "mark rober": ["mark rober chaos", "experiment went wrong", "no way that worked", "everyone panicked", "science got wild"],
  flamingo: ["flamingo roblox chaos", "albert lost it", "roblox got wild", "flamingo got cooked", "no way flamingo did that"],
  kreekcraft: ["kreekcraft got cooked", "kreek lost it", "roblox chaos", "kreek was not ready", "chat cooked kreek"],
  preston: ["preston got cooked", "preston challenge chaos", "preston was not ready", "instant regret", "preston had them crying"],
  unspeakable: ["unspeakable chaos", "challenge went wrong", "no way he did that", "instant regret", "everyone panicked"],
  lazarbeam: ["lazarbeam lost it", "lazar got cooked", "fortnite chaos", "lazar was not ready", "no way lazar did that"],
  lachlan: ["lachlan got cooked", "fortnite chaos", "lachlan lost it", "lachlan was not ready", "no way lachlan did that"],
  ninja: ["ninja lost it", "ninja got cooked", "fortnite chaos", "chat cooked ninja", "ninja went silent"],
  clix: ["clix rage moment", "clix got cooked", "clix lost it", "fortnite chaos", "chat cooked clix"],
  "nick eh 30": ["nick eh 30 chaos", "nick got cooked", "fortnite got wild", "nick was not ready", "no way nick did that"],
  sypherpk: ["sypher got cooked", "sypher lost it", "fortnite chaos", "sypher was not ready", "chat cooked sypher"],
  timthetatman: ["tim got cooked", "tim lost it", "chat cooked tim", "tim was not ready", "timthetatman chaos"],
  ludwig: ["ludwig got cooked", "ludwig lost it", "chat cooked ludwig", "ludwig was not ready", "ludwig chaos"],
  hasanabi: ["hasan got cooked", "hasan lost it", "chat cooked hasan", "hasan went silent", "hasan chaos"],
  asmongold: ["asmongold got cooked", "asmongold lost it", "chat cooked asmon", "asmon went silent", "asmon chaos"],
  zackrawrr: ["asmon got cooked", "asmon lost it", "chat cooked asmon", "asmon went silent", "asmon chaos"],
  valkyrae: ["rae got cooked", "rae lost it", "chat cooked rae", "rae was not ready", "valkyrae chaos"],
  pokimane: ["poki got cooked", "poki lost it", "chat cooked poki", "poki went silent", "pokimane chaos"],
  coryxkenshin: ["cory got scared", "cory lost it", "cory had them crying", "cory was not ready", "coryxkenshin chaos"],
  markiplier: ["markiplier screamed", "mark lost it", "mark got scared", "mark was not ready", "markiplier chaos"],
  jacksepticeye: ["jack lost it", "jack got scared", "jack had them crying", "jack was not ready", "jacksepticeye chaos"],
  dantdm: ["dantdm chaos", "dan got cooked", "dan lost it", "dan was not ready", "minecraft got wild"],
  "chris md": ["chrismd got cooked", "chris md chaos", "football challenge fail", "chris was not ready", "the shot went wrong"],
  willne: ["willne got cooked", "willne lost it", "willne chaos", "will was not ready", "the room froze"],
  calfreezy: ["calfreezy got cooked", "freezy lost it", "freezy chaos", "cal was not ready", "football chaos"],
  deji: ["deji got cooked", "deji lost it", "deji was not ready", "no way deji said that", "deji chaos"],
  sharky: ["sharky got cooked", "sharky lost it", "sharky was not ready", "the room went silent", "sharky chaos"],
  "aj shabeel": ["aj got cooked", "aj lost it", "aj was not ready", "beta squad chaos", "aj shabeel violation"],
  miniminter: ["simon got cooked", "simon lost it", "sidemen cooked simon", "simon was not ready", "miniminter chaos"],
  zerkaa: ["zerkaa got cooked", "josh lost it", "sidemen cooked josh", "josh was not ready", "zerkaa chaos"],
  vikkstar: ["vikk got cooked", "vikk lost it", "sidemen cooked vikk", "vikk was not ready", "vikkstar chaos"],
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

function buildSearchIdeas(trendingTerms: string[], ideaSearch: NormalizedIdeaSearchSettings) {
  const creatorVariants = ideaSearch.titleVariants.length ? ideaSearch.titleVariants : CREATOR_VARIANTS;
  const creatorNames = ideaSearch.creators.length ? ideaSearch.creators : CREATOR_NAMES;
  const creatorIdeas = creatorNames.flatMap((creator) =>
    shuffle(creatorVariants).slice(0, Math.min(10, creatorVariants.length)).map((variant) => `${creator} ${variant}`)
  );
  const trendIdeas = ideaSearch.isCustom ? [] : trendingTerms.flatMap((term) => [
    `${term} moments`,
    `${term} funny moments`,
    `${term} reaction`,
    `${term} awkward moments`,
    `${term} fails`,
    `${term} fan reaction`
  ]);
  const fallbackIdeas = ideaSearch.isCustom ? [] : FALLBACK_IDEAS;
  const generalTopics = ideaSearch.isCustom ? [] : GENERAL_VARIANT_TOPICS;

  return [...new Set([...creatorIdeas, ...fallbackIdeas, ...generalTopics, ...trendIdeas])];
}

function shuffle<T>(items: T[]) {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function delay(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function getRecentTopics() {
  recentTopics.__ytshortRecentIdeaTopics ??= [];
  return recentTopics.__ytshortRecentIdeaTopics;
}

function getRecentCandidateIds() {
  recentTopics.__ytshortRecentCandidateIds ??= [];
  return recentTopics.__ytshortRecentCandidateIds;
}

function getIdeaCache() {
  const now = Date.now();
  recentTopics.__ytshortIdeaCandidateCache = (recentTopics.__ytshortIdeaCandidateCache ?? [])
    .filter((item) => now - item.cachedAt <= IDEA_CACHE_TTL_MS && item.candidates.length >= RANK_COUNT)
    .slice(0, IDEA_CACHE_LIMIT);

  return recentTopics.__ytshortIdeaCandidateCache;
}

function rememberIdeaCache(topic: string, candidates: Candidate[]) {
  if (candidates.length < RANK_COUNT) {
    return;
  }

  const key = topicKey(topic);
  const cache = getIdeaCache().filter((item) => item.key !== key);
  cache.unshift({
    topic,
    key,
    candidates: candidates.slice(0, 24),
    cachedAt: Date.now()
  });
  recentTopics.__ytshortIdeaCandidateCache = cache.slice(0, IDEA_CACHE_LIMIT);
}

function activeTikWMCooldown() {
  const cooldown = recentTopics.__ytshortTikWMCooldown;

  if (!cooldown || cooldown.blockedUntil <= Date.now()) {
    return null;
  }

  return cooldown;
}

function startTikWMCooldown(error: TikWMBlockedError) {
  const cooldown: TikWMCooldown = {
    blockedUntil: Date.now() + TIKWM_COOLDOWN_MS,
    reason: error.message,
    status: error.status
  };
  recentTopics.__ytshortTikWMCooldown = cooldown;
  return cooldown;
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

function isCloudflareChallenge(value: string) {
  const lower = value.toLowerCase();
  return (
    lower.includes("just a moment") ||
    lower.includes("challenges.cloudflare.com") ||
    lower.includes("cf-chl") ||
    lower.includes("cloudflare")
  );
}

async function searchTikWMCandidates(query: string, cursor = 0) {
  const url = new URL("https://www.tikwm.com/api/feed/search");
  url.searchParams.set("keywords", query);
  url.searchParams.set("count", String(SEARCH_CANDIDATE_COUNT));
  url.searchParams.set("cursor", String(cursor));

  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" }
  });
  const responseText = await response.text();

  if (!response.ok) {
    if (response.status === 403 || response.status === 429 || isCloudflareChallenge(responseText)) {
      throw new TikWMBlockedError(
        response.status,
        `TikWM blocked search with HTTP ${response.status}. Cooling down before trying again.`
      );
    }

    return [];
  }

  if (isCloudflareChallenge(responseText)) {
    throw new TikWMBlockedError(
      response.status,
      "TikWM returned a Cloudflare challenge. Cooling down before trying again."
    );
  }

  let payload: {
    code?: number;
    data?: { videos?: TikWMVideo[] };
  };

  try {
    payload = JSON.parse(responseText) as typeof payload;
  } catch {
    return [];
  }

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
  const primaryCandidates = await searchTikWMCandidates(query, 0);

  if (primaryCandidates.length >= 8) {
    return uniqueCandidates(primaryCandidates);
  }

  await delay(SEARCH_REQUEST_DELAY_MS);

  const relatedQuery = shuffle([
    `${query} clips`,
    `${query} tiktok`,
    `${query} viral`,
    `${query} best moments`
  ])[0];
  const relatedCandidates = await searchTikWMCandidates(relatedQuery, 0);

  return uniqueCandidates([...primaryCandidates, ...relatedCandidates]);
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

function candidateSimilarityWords(candidate: Candidate) {
  const text = cleanTopic(`${candidate.sourceTitle} ${candidate.name}`);

  return new Set(
    text
      .split(/\s+/)
      .map((word) => word.replace(/['-]/g, ""))
      .filter(
        (word) =>
          word.length >= 4 &&
          !IMPORTANT_WORD_STOPWORDS.has(word) &&
          !HANDLE_WORD_PATTERNS.some((pattern) => word.includes(pattern)) &&
          !/^\d+$/.test(word)
      )
  );
}

function wordSetSimilarity(first: Set<string>, second: Set<string>) {
  if (!first.size || !second.size) {
    return 0;
  }

  let intersection = 0;

  for (const word of first) {
    if (second.has(word)) {
      intersection += 1;
    }
  }

  return intersection / Math.min(first.size, second.size);
}

function likelySameClip(first: Candidate, second: Candidate) {
  const firstDuration = first.duration || 0;
  const secondDuration = second.duration || 0;
  const durationClose =
    firstDuration > 0 &&
    secondDuration > 0 &&
    Math.abs(firstDuration - secondDuration) <= 2;
  const sameThumbnail = Boolean(first.thumbnail && first.thumbnail === second.thumbnail);

  if (sameThumbnail && durationClose) {
    return true;
  }

  const firstWords = candidateSimilarityWords(first);
  const secondWords = candidateSimilarityWords(second);
  const similarity = wordSetSimilarity(firstWords, secondWords);

  return similarity >= 0.72 && (durationClose || similarity >= 0.9);
}

function removeNearDuplicateCandidates(candidates: Candidate[]) {
  const unique: Candidate[] = [];

  for (const candidate of candidates) {
    if (unique.some((selected) => likelySameClip(candidate, selected))) {
      continue;
    }

    unique.push(candidate);
  }

  return unique;
}

function weightedSample(candidates: Candidate[], count: number) {
  const remaining = [...candidates];
  const selected: Candidate[] = [];
  const usedCreators = new Set<string>();

  while (remaining.length && selected.length < count) {
    const contentDiverseRemaining = remaining.filter(
      (candidate) => !selected.some((selectedCandidate) => likelySameClip(candidate, selectedCandidate))
    );
    const candidatePool = contentDiverseRemaining.length >= count - selected.length
      ? contentDiverseRemaining
      : remaining;
    const creatorDiversePool = candidatePool.filter((candidate) => !usedCreators.has(candidate.creator));
    const pool =
      creatorDiversePool.length >= count - selected.length ? creatorDiversePool : candidatePool;
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
  const dedupedFreshCandidates = removeNearDuplicateCandidates(freshCandidates);
  const dedupedScoreSorted = removeNearDuplicateCandidates(scoreSorted);
  const primaryPool = (dedupedFreshCandidates.length >= 5 ? dedupedFreshCandidates : dedupedScoreSorted).slice(0, 24);
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

function cachedIdeaForSearch(orderedIdeas: string[], excludedIds: Set<string>, recentKeys: Set<string>) {
  const orderedKeys = new Set(orderedIdeas.map(topicKey));
  const candidates = shuffle(getIdeaCache())
    .filter((item) => orderedKeys.has(item.key))
    .sort((a, b) => {
      const aRecentPenalty = recentKeys.has(a.key) ? 1 : 0;
      const bRecentPenalty = recentKeys.has(b.key) ? 1 : 0;
      return aRecentPenalty - bRecentPenalty;
    });

  for (const cachedIdea of candidates) {
    const rotated = rotateCandidates(cachedIdea.candidates, excludedIds);

    if (rotated.length >= RANK_COUNT) {
      return {
        idea: cachedIdea.topic,
        candidates: rotated,
        isTrend: false
      };
    }
  }

  return null;
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

function manualSearchLinks(topic: string) {
  const queries = [
    topic,
    `${topic} clips`,
    `${topic} tiktok`,
    `${topic} viral`,
    `${topic} best moments`
  ];

  return [...new Set(queries.map(cleanTopic).filter(Boolean))].slice(0, 5).map((query) => ({
    label: titleCase(query),
    query,
    url: `https://www.tiktok.com/search?q=${encodeURIComponent(query)}`
  }));
}

function manualFallbackIdea({
  attempts,
  cooldown,
  reason,
  topic
}: {
  attempts: SearchAttempt[];
  cooldown?: TikWMCooldown | null;
  reason: string;
  topic: string;
}) {
  const title = generatedViralTitle(topic);
  const { description, hashtags } = buildViralDescription(title, topic, []);

  return {
    topic,
    title,
    source: cooldown
      ? "Manual fallback - TikWM cooldown active"
      : "Manual fallback - TikWM search unavailable",
    description,
    hashtags,
    candidates: [],
    manualSearchLinks: manualSearchLinks(topic),
    rateLimited: Boolean(cooldown),
    cooldownUntil: cooldown ? new Date(cooldown.blockedUntil).toISOString() : null,
    searchLimited: true,
    message: reason,
    attempts,
    recentTopics: getRecentTopics().map((recentTopic) => recentTopic.topic),
    generatedAt: new Date().toISOString()
  };
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    excludeIds?: string[];
    ideaSearch?: IdeaSearchSettingsInput;
  };
  const ideaSearch = normalizeIdeaSearchSettings(body.ideaSearch);
  const excludedIds = new Set([
    ...getRecentCandidateIds(),
    ...(Array.isArray(body.excludeIds) ? body.excludeIds : [])
  ]);
  const trendingTerms = await fetchTrendingTerms();
  const recent = getRecentTopics();
  const recentKeys = new Set(recent.map((recentTopic) => recentTopic.key));
  const ideas = shuffle(buildSearchIdeas(trendingTerms, ideaSearch));
  const nonRecentIdeas = ideas.filter((idea) => !recentKeys.has(topicKey(idea)));
  const recentIdeas = ideas.filter((idea) => recentKeys.has(topicKey(idea)));
  const orderedIdeas = [...nonRecentIdeas, ...recentIdeas].slice(0, MAX_SEARCH_ATTEMPTS);
  const fallbackTopic = orderedIdeas[0] ?? FALLBACK_IDEAS[Math.floor(Math.random() * FALLBACK_IDEAS.length)];
  const attempts: SearchAttempt[] = [];
  const cachedIdea = cachedIdeaForSearch(orderedIdeas, excludedIds, recentKeys);
  const viableIdeas: Array<{
    idea: string;
    candidates: Candidate[];
    isTrend: boolean;
    cacheHit?: boolean;
  }> = [];

  if (cachedIdea) {
    viableIdeas.push({ ...cachedIdea, cacheHit: true });
  }

  const cooldown = activeTikWMCooldown();

  if (!viableIdeas.length && cooldown) {
    return NextResponse.json(
      manualFallbackIdea({
        attempts,
        cooldown,
        reason: `${cooldown.reason} Try again after the cooldown, or use the manual search links below.`,
        topic: fallbackTopic
      })
    );
  }

  if (!viableIdeas.length) {
    for (const idea of orderedIdeas) {
      try {
        const candidates = rotateCandidates(await searchVariedCandidates(idea), excludedIds);
        attempts.push({ query: idea, count: candidates.length, source: "tikwm" });

        if (candidates.length >= RANK_COUNT) {
          rememberIdeaCache(idea, candidates);
          viableIdeas.push({
            idea,
            candidates,
            isTrend: trendingTerms.includes(idea)
          });
          break;
        }
      } catch (error) {
        if (error instanceof TikWMBlockedError) {
          const nextCooldown = startTikWMCooldown(error);
          attempts.push({
            query: idea,
            count: 0,
            error: error.message,
            source: "tikwm"
          });

          return NextResponse.json(
            manualFallbackIdea({
              attempts,
              cooldown: nextCooldown,
              reason: `${error.message} Automated TikTok search is paused to avoid repeated rate-limit hits.`,
              topic: idea
            })
          );
        }

        attempts.push({
          query: idea,
          count: 0,
          error: error instanceof Error ? error.message : "Search failed.",
          source: "tikwm"
        });
      }

      await delay(SEARCH_REQUEST_DELAY_MS);
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
        : selectedIdea.cacheHit
          ? "Cached TikTok candidates"
          : "Viral topic fallback + TikWM search",
      description,
      hashtags,
      candidates: selectedIdea.candidates.slice(0, 12),
      cacheHit: Boolean(selectedIdea.cacheHit),
      manualSearchLinks: manualSearchLinks(selectedIdea.idea),
      rateLimited: false,
      cooldownUntil: activeTikWMCooldown()
        ? new Date(activeTikWMCooldown()!.blockedUntil).toISOString()
        : null,
      attempts,
      recentTopics: getRecentTopics().map((recentTopic) => recentTopic.topic),
      generatedAt: new Date().toISOString()
    });
  }

  return NextResponse.json(
    manualFallbackIdea({
      attempts,
      cooldown: null,
      reason:
        "TikWM did not return five usable candidates within the safe search limit. Use the manual search links below instead of retrying repeatedly.",
      topic: fallbackTopic
    })
  );
}
