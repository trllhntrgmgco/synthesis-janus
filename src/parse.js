// Pulls the hidden tags out of a fluent reply. The user sees only the remaining text.
const config = require('./config');
const TAG = /^\s*\[(EXPRESS|OBJECT|HYPOTHESIS|REVIEW|OVERRULE)\b([^\]]*)\]\s*$/gim;

function parse(text) {
  const r = { visible: '', express: null, objections: [], hypotheses: [], reviews: [], overrules: [] };
  for (const m of (text || '').matchAll(TAG)) {
    const kind = m[1].toUpperCase(), body = m[2].replace(/^\s*:?\s*/, '');
    const [a, ...rest] = body.split('|').map(x => x.trim()); const b = rest.join(' | ');
    if (kind === 'EXPRESS') { const t = a.toLowerCase(); if (config.EXPRESSIONS.includes(t)) r.express = t; }
    if (kind === 'OBJECT' && a) r.objections.push({ reason: a, source: b || null });
    if (kind === 'HYPOTHESIS' && a) r.hypotheses.push({ claim: a, reasoning: b });
    if (kind === 'REVIEW') { const m2 = body.match(/H#(\d+)\s*:?\s*(endorse|challenge)\s*\|?\s*(.*)/i); if (m2) r.reviews.push({ hypothesisId: +m2[1], action: m2[2].toLowerCase(), reasoning: m2[3] }); }
    if (kind === 'OVERRULE') { const m3 = body.match(/^\s*(memory|information)\s*:\s*([^|]*)\|?\s*(.*)$/i); if (m3) r.overrules.push({ target: m3[1].toLowerCase(), evidence: m3[2].trim(), cites: m3[3].trim() }); }
  }
  r.visible = (text || '').replace(TAG, '').replace(/\n{3,}/g, '\n\n').trim();
  return r;
}
module.exports = { parse };
