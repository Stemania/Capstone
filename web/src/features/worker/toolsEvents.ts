/** Fired on window after this phone borrows or returns a tool, so other tabs refresh. */
export const TOOLS_CHANGED = 'bmsc:tools-changed';

export function announceToolsChanged() {
  window.dispatchEvent(new Event(TOOLS_CHANGED));
}
