/**
 * notation.js: pack text is typed ("x^2 . x^3", "sqrt(9+16)"); on screen it
 * is set as maths. The text is escaped first, so the result is safe as HTML.
 * Printed materials keep the typed form, which reads fine on paper.
 */

export function mathHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\^\(([^)]*)\)/g, '<sup>$1</sup>')
    .replace(/\^(-?[\w/]+)/g, '<sup>$1</sup>')
    .replace(/\bsqrt\(/g, '√(')
    .replace(/ \. /g, ' · ');
}

/** Fill `node` with `s` set as maths, and return it. */
export function setMath(node, s) {
  node.innerHTML = mathHtml(s);
  return node;
}
