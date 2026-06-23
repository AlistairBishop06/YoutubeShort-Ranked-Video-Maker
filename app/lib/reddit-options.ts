export type RedditSubredditOption = {
  id: string;
  label: string;
  value: string;
  group: string;
};

export type RedditStorySettingsInput = {
  subredditIds?: string[];
};

const SUBREDDIT_VALUES = [
  { value: "confession", group: "Confessions" },
  { value: "TrueOffMyChest", group: "Confessions" },
  { value: "stories", group: "General" },
  { value: "tifu", group: "Fails" },
  { value: "pettyrevenge", group: "Revenge" },
  { value: "MaliciousCompliance", group: "Revenge" },
  { value: "ProRevenge", group: "Revenge" },
  { value: "entitledparents", group: "Drama" },
  { value: "AmItheAsshole", group: "Drama" },
  { value: "TalesFromRetail", group: "Work" },
  { value: "nosleep", group: "Horror" },
  { value: "LetsNotMeet", group: "Horror" },
  { value: "Glitch_in_the_Matrix", group: "Mystery" }
] as const;

function optionId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function displayName(value: string) {
  const knownLabels: Record<string, string> = {
    AmItheAsshole: "Am I The Asshole",
    Glitch_in_the_Matrix: "Glitch In The Matrix",
    LetsNotMeet: "Let's Not Meet",
    MaliciousCompliance: "Malicious Compliance",
    ProRevenge: "Pro Revenge",
    TalesFromRetail: "Tales From Retail",
    TrueOffMyChest: "True Off My Chest",
    entitledparents: "Entitled Parents",
    pettyrevenge: "Petty Revenge",
    tifu: "Today I Messed Up"
  };

  return knownLabels[value] || `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

export const REDDIT_SUBREDDIT_OPTIONS: RedditSubredditOption[] = SUBREDDIT_VALUES.map(
  ({ value, group }) => ({
    id: optionId(value),
    label: displayName(value),
    value,
    group
  })
);

export const DEFAULT_REDDIT_STORY_SETTINGS = {
  subredditIds: REDDIT_SUBREDDIT_OPTIONS.map((option) => option.id)
};

function uniqueValidIds(ids: unknown) {
  if (!Array.isArray(ids)) {
    return [];
  }

  const validIds = new Set(REDDIT_SUBREDDIT_OPTIONS.map((option) => option.id));
  return [...new Set(ids.map((id) => String(id).trim()).filter((id) => validIds.has(id)))];
}

export function normalizeRedditStorySettings(input?: RedditStorySettingsInput | null) {
  const subredditIds = uniqueValidIds(input?.subredditIds);
  const resolvedIds = subredditIds.length
    ? subredditIds
    : DEFAULT_REDDIT_STORY_SETTINGS.subredditIds;
  const selectedIds = new Set(resolvedIds);

  return {
    subredditIds: resolvedIds,
    subreddits: REDDIT_SUBREDDIT_OPTIONS.filter((option) => selectedIds.has(option.id)).map(
      (option) => option.value
    ),
    isCustom: resolvedIds.length !== DEFAULT_REDDIT_STORY_SETTINGS.subredditIds.length
  };
}

export function parseRedditSubredditIdList(value: string | undefined) {
  return String(value || "")
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}
