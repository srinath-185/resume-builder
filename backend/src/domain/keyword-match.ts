export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whole-term match that works for terms with symbols ("node.js", "c++", "c#"),
 * where \b fails because the term does not end on a word character.
 */
export function containsTerm(haystackLower: string, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return false;
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegex(needle)}($|[^a-z0-9+#])`, 'i');
  return pattern.test(haystackLower);
}

export interface KeywordScore {
  score: number;
  matched: string[];
  missing: string[];
}

const MAX_SKILLS_CONSIDERED = 15;

/**
 * Cheap, deterministic pre-filter: how many of the candidate's skills appear in
 * the job text, plus whether the title resembles a target title. Only jobs
 * passing this reach the LLM, which is what keeps free-tier budgets intact.
 */
export function keywordScore(jobText: string, jobTitle: string, skills: string[], targetTitles: string[]): KeywordScore {
  const text = jobText.toLowerCase();
  const considered = skills.slice(0, MAX_SKILLS_CONSIDERED);
  const matched = considered.filter(skill => containsTerm(text, skill));
  const missing = considered.filter(skill => !matched.includes(skill));
  const skillScore = considered.length ? matched.length / considered.length : 0;

  const titleTokens = new Set(jobTitle.toLowerCase().split(/[^a-z0-9+#]+/).filter(token => token.length > 2));
  const titleScore = targetTitles.reduce((best, target) => {
    const tokens = target.toLowerCase().split(/[^a-z0-9+#]+/).filter(token => token.length > 2);
    if (!tokens.length) return best;
    const overlap = tokens.filter(token => titleTokens.has(token)).length / tokens.length;
    return Math.max(best, overlap);
  }, 0);

  return { score: Math.round(100 * (0.7 * skillScore + 0.3 * titleScore)), matched, missing };
}
