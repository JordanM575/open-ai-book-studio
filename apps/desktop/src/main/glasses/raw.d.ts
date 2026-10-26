/**
 * Vite inlines a file imported with `?raw` as a string.
 *
 * The glasses page is one HTML file, so it can be served from the studio's own backend without a
 * path to resolve at runtime and without the packager having to carry a second copy of it.
 */
declare module "*.html?raw" {
  const content: string;
  export default content;
}

declare module "*.json?raw" {
  const content: string;
  export default content;
}
