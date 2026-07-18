export type IdeaOption = {
  id: string;
  label: string;
  value: string;
  group: string;
};

export type IdeaSearchSettingsInput = {
  creatorIds?: string[];
  titleIds?: string[];
  customTitleValues?: string[];
};

export type NormalizedIdeaSearchSettings = {
  creatorIds: string[];
  titleIds: string[];
  customTitleValues: string[];
  creators: string[];
  titleVariants: string[];
  usesCustomTitles: boolean;
  isCustom: boolean;
};

export const MAX_CUSTOM_TITLE_VALUES = 30;
export const MAX_CUSTOM_TITLE_LENGTH = 64;

const CREATOR_VALUES = [
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
  "WroeToShaw",
  "Flight",
  "FlightReacts"
];

const TITLE_VARIANT_VALUES = [
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

function optionId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function creatorGroup(value: string) {
  if (["sidemen", "amp", "beta squad", "rdcworld", "faze clan"].includes(value.toLowerCase())) {
    return "Groups";
  }

  if (/\b(flamingo|kreekcraft|preston|unspeakable|lazarbeam|lachlan|ninja|clix|fortnite|roblox|minecraft|nick eh 30|sypherpk|dantdm)\b/i.test(value)) {
    return "Gaming";
  }

  if (/\b(speed|kai|caseoh|adin|xqc|jynxzi|plaqueboymax|ronaldo|lacy|cinna|jasontheween|duke|agent|yourrage|flight|flightreacts|timthetatman|ludwig|hasanabi|asmongold|zackrawrr|valkyrae|pokimane)\b/i.test(value)) {
    return "Streamers";
  }

  return "YouTubers";
}

function titleGroup(value: string) {
  if (/\b(stream|chat|live|rage)\b/i.test(value)) {
    return "Stream";
  }

  if (/\b(irl|public|fan)\b/i.test(value)) {
    return "IRL";
  }

  if (/\b(roast|caught|crashout|awkward)\b/i.test(value)) {
    return "Drama";
  }

  if (/\b(challenge|reaction)\b/i.test(value)) {
    return "Challenge";
  }

  return "Core";
}

function makeOption(value: string, group: string): IdeaOption {
  return {
    id: optionId(value),
    label: titleCase(value),
    value,
    group
  };
}

export const CREATOR_SEARCH_OPTIONS = CREATOR_VALUES.map((value) =>
  makeOption(value, creatorGroup(value))
);

export const TITLE_SEARCH_OPTIONS = TITLE_VARIANT_VALUES.map((value) =>
  makeOption(value, titleGroup(value))
);

export const DEFAULT_IDEA_SEARCH_SETTINGS = {
  creatorIds: CREATOR_SEARCH_OPTIONS.map((option) => option.id),
  titleIds: TITLE_SEARCH_OPTIONS.map((option) => option.id),
  customTitleValues: [] as string[]
};

function uniqueValidIds(ids: unknown, options: IdeaOption[]) {
  if (!Array.isArray(ids)) {
    return [];
  }

  const validIds = new Set(options.map((option) => option.id));
  return [...new Set(ids.map((id) => String(id).trim()).filter((id) => validIds.has(id)))];
}

function valuesForIds(options: IdeaOption[], ids: string[]) {
  const selected = new Set(ids);
  return options.filter((option) => selected.has(option.id)).map((option) => option.value);
}

function normalizeCustomTitleValue(value: unknown) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CUSTOM_TITLE_LENGTH)
    .trim();
}

function uniqueCustomTitleValues(values: unknown) {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const title = normalizeCustomTitleValue(value);
    const key = title.toLowerCase();

    if (title.length < 2 || seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(title);

    if (normalized.length >= MAX_CUSTOM_TITLE_VALUES) {
      break;
    }
  }

  return normalized;
}

function isCustomSelection(ids: string[], defaultIds: string[]) {
  return ids.length !== defaultIds.length || ids.some((id) => !defaultIds.includes(id));
}

export function normalizeIdeaSearchSettings(
  input?: IdeaSearchSettingsInput | null
): NormalizedIdeaSearchSettings {
  const creatorIds = uniqueValidIds(input?.creatorIds, CREATOR_SEARCH_OPTIONS);
  const titleIds = uniqueValidIds(input?.titleIds, TITLE_SEARCH_OPTIONS);
  const customTitleValues = uniqueCustomTitleValues(input?.customTitleValues);
  const resolvedCreatorIds = creatorIds.length ? creatorIds : DEFAULT_IDEA_SEARCH_SETTINGS.creatorIds;
  const resolvedTitleIds = titleIds.length ? titleIds : DEFAULT_IDEA_SEARCH_SETTINGS.titleIds;
  const usesCustomTitles = customTitleValues.length > 0;

  return {
    creatorIds: resolvedCreatorIds,
    titleIds: resolvedTitleIds,
    customTitleValues,
    creators: valuesForIds(CREATOR_SEARCH_OPTIONS, resolvedCreatorIds),
    titleVariants: usesCustomTitles
      ? customTitleValues
      : valuesForIds(TITLE_SEARCH_OPTIONS, resolvedTitleIds),
    usesCustomTitles,
    isCustom:
      usesCustomTitles ||
      isCustomSelection(resolvedCreatorIds, DEFAULT_IDEA_SEARCH_SETTINGS.creatorIds) ||
      isCustomSelection(resolvedTitleIds, DEFAULT_IDEA_SEARCH_SETTINGS.titleIds)
  };
}

export function parseIdeaSearchIdList(value: string | undefined) {
  return String(value || "")
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseIdeaCustomTitleList(value: string | undefined) {
  const raw = String(value || "").trim();

  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      return uniqueCustomTitleValues(parsed);
    }
  } catch {
    // Fall through to the looser manual variable format below.
  }

  return uniqueCustomTitleValues(raw.split(/\r?\n|\|/));
}

export function stringifyIdeaCustomTitleList(values: string[]) {
  return JSON.stringify(uniqueCustomTitleValues(values));
}
