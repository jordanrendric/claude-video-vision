export const MAX_VOCABULARY_TERMS = 100;

/**
 * Normalizes a vocabulary list for speech recognizers. Accepts an array or a
 * comma/whitespace-separated string, splits multi-word entries into single
 * words (Mistral's context_bias rejects whitespace), trims, de-duplicates and
 * caps at 100 terms.
 */
export function normalizeVocabulary(raw: string | string[] | undefined): string[] {
  if (!raw) return [];
  const source = Array.isArray(raw) ? raw.join(",") : raw;
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const term of source.split(/[,\s]+/)) {
    const clean = term.trim();
    if (clean.length === 0 || seen.has(clean)) continue;
    seen.add(clean);
    terms.push(clean);
    if (terms.length === MAX_VOCABULARY_TERMS) break;
  }
  return terms;
}

/**
 * Resolves the effective vocabulary: the config value, with the environment
 * variable (handy for one-off runs and CI) taking precedence when set.
 */
export function resolveVocabulary(configVocabulary: string[] | undefined, envVar = process.env.CVV_VOCABULARY): string[] {
  if (envVar && envVar.trim()) return normalizeVocabulary(envVar);
  return normalizeVocabulary(configVocabulary);
}
