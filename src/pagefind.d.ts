// Ambient type declaration for Pagefind's default UI package, which ships
// without TypeScript types. Used by `Search.astro`'s client script (Task 8 /
// 需求 9). This gives `astro check` a declaration so the import is not an
// implicit `any` (ts7016), without pulling in a non-existent @types package.
declare module '@pagefind/default-ui' {
  /** Pagefind's default search UI widget. */
  export class PagefindUI {
    constructor(options: Record<string, unknown>);
  }
}
