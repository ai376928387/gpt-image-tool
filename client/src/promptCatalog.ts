import promptCatalogJson from "./data/promptCatalog.json";

export type PromptCatalogEntry = {
  id: string;
  number: number;
  title: string;
  category: string;
  tags: string[];
  sizeLabel?: string | null;
  resolution?: string | null;
  sourceType?: "curated" | "external" | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  previewImage?: string | null;
  promptText: string;
};

type PromptCatalogData = {
  sourceRepo: string;
  entryCount: number;
  categories: string[];
  entries: PromptCatalogEntry[];
};

const promptCatalog = promptCatalogJson as PromptCatalogData;

export const promptCatalogSourceRepo = promptCatalog.sourceRepo;
export const promptCatalogEntryCount = promptCatalog.entryCount;
export const promptCatalogEntries = [...promptCatalog.entries].sort((left, right) => {
  const categoryComparison = left.category.localeCompare(right.category);

  if (categoryComparison !== 0) {
    return categoryComparison;
  }

  return left.number - right.number;
});

export const promptCatalogCategories = [...promptCatalog.categories].sort((left, right) => left.localeCompare(right));

export function filterPromptCatalog(entries: PromptCatalogEntry[], query: string, category: string) {
  const normalizedQuery = query.trim().toLowerCase();

  return entries.filter((entry) => {
    if (category !== "all" && entry.category !== category) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const haystack = [entry.title, entry.category, entry.tags.join(" "), entry.promptText].join(" ").toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}
