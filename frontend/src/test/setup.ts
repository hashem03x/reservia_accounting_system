// jsdom implements neither API - Mantine's ScrollArea/Select (color-scheme/media-query hooks and
// dropdown positioning) call both unconditionally on mount, so any component test that renders
// something inside MantineProvider needs these polyfills, not just tests that exercise theming or
// scrolling directly.
// jsdom doesn't implement it either - Mantine's Select/Combobox calls it on its highlighted
// option on a timer regardless of whether a test ever opens the dropdown.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});

globalThis.ResizeObserver =
  globalThis.ResizeObserver ||
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
