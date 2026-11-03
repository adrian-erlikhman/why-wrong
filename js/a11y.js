/**
 * a11y.js -- keyboard support shared by the dialogs.
 * ---------------------------------------------------------------------------
 * A dialog marked aria-modal promises that focus stays inside it, and a teacher
 * using a keyboard or a screen reader is relying on that promise. Each dialog
 * keeps focus inside while it is open and hands it back to whatever opened it.
 */

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type=hidden])',
  'select:not([disabled])', 'textarea:not([disabled])', 'summary', '[tabindex]:not([tabindex="-1"])'
].join(',');

function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter(n => n.getClientRects().length > 0);
}

/** Keep Tab inside `root`. Call from a keydown handler. */
export function trapTab(root, e) {
  if (e.key !== 'Tab') return;
  const nodes = focusables(root);
  if (!nodes.length) { e.preventDefault(); root.focus(); return; }
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const at = document.activeElement;
  if (e.shiftKey && (at === first || !root.contains(at))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (at === last || !root.contains(at))) { e.preventDefault(); first.focus(); }
}

/** Move focus into a dialog, unless something inside already holds it. */
export function focusInto(root) {
  if (root.contains(document.activeElement)) return;
  (focusables(root)[0] ?? root).focus();
}
