/**
 * Author-side preflight (S1 §6.6): lint v2 + sample-file import. Server / scripts only —
 * deliberately NOT re-exported from the rules root so the offline play package never bundles it.
 */
export { btgWorldFileToContent, isBtgWorldFile } from './btg-world-file.js';
export { lintWorld, lintStory, VOLUME_TIERS, type LintOptions, type VolumeTarget } from './lint.js';
export { DEFAULT_BANNED_PHRASES, textLength, jaccard, shingles, similarPairs, frequentFragments, type TextUnit } from './text-metrics.js';
export { lintStateVariants, GONE_WORDS, type StateVariantIssue } from './state-variants.js';
