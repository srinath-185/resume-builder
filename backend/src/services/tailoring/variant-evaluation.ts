import { diffResumes, keywordCoverage, KeywordCoverage, ResumeChange } from '../../domain/resume-diff';
import { ResumeDocument } from '../../domain/resume-document';
import { factCheck, FactCheckResult } from '../../domain/resume-fact-check';

export interface VariantEvaluation {
  factCheck: FactCheckResult;
  keywordCoverage: KeywordCoverage;
  changes: ResumeChange[];
}

/** Everything the reviewer sees next to a tailored resume, recomputed after every edit. */
export function evaluateVariant(
  master: ResumeDocument,
  masterText: string,
  tailored: ResumeDocument,
  keywords: string[],
  reasons: Array<{ path: string; reason: string }> = [],
): VariantEvaluation {
  return {
    factCheck: factCheck(master, masterText, tailored),
    keywordCoverage: keywordCoverage(keywords, master, tailored),
    changes: diffResumes(master, tailored, reasons),
  };
}
