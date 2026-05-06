// Vite's `?raw` suffix loads a file's content as a string at build/test time.
// Used by structural lint-style tests that audit our own CSS/source files
// without reaching for `node:fs` (which would force node types into a
// browser-bound package).
declare module "*?raw" {
  const content: string;
  export default content;
}
