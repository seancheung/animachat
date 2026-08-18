const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });

/**
 * Count Unicode word-like segments without assuming that words are separated by
 * spaces. Intl.Segmenter applies the appropriate boundary rules to every script.
 */
export function countWords(value: string): number {
  let words = 0;

  for (const segment of wordSegmenter.segment(value)) {
    if (segment.isWordLike) words += 1;
  }

  return words;
}
