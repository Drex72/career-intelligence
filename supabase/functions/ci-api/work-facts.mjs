/** Strict explicit work-mode and visa-sponsorship facts from the quoted ATS evidence.
 * Never interpret global remote, Nigeria eligibility, or role titles as sponsorship.
 */
export function classifyWorkFacts(raw) {
  const text=String(raw||'').slice(0,2000);
  let workMode='unknown';
  const modePatterns=[
    ['remote',/\b(?:this (?:position|role|job) is (?:fully |100% )?remote|work arrangement\s*[:\-]\s*remote|workplace type\s*[:\-]\s*remote|location\s*[:\-]\s*remote)\b/i],
    ['hybrid',/\b(?:this (?:position|role|job) is hybrid|work arrangement\s*[:\-]\s*hybrid|workplace type\s*[:\-]\s*hybrid|hybrid work model)\b/i],
    ['onsite',/\b(?:this (?:position|role|job) is (?:on[ -]?site|in[ -]?office)|work arrangement\s*[:\-]\s*(?:on[ -]?site|in[ -]?office)|workplace type\s*[:\-]\s*(?:on[ -]?site|in[ -]?office))\b/i]
  ];
  const modes=modePatterns.filter(([,re])=>re.test(text)).map(([mode])=>mode);
  if(modes.length===1)workMode=modes[0];
  // Visa sponsorship is a relocation/employment permission, NOT the same as remote eligibility.
  // Negatives and contradictions always win; generic "visa" mentions are insufficient.
  const noVisa=/\b(?:visa sponsorship (?:is )?(?:not available|not provided|unavailable)|(?:we|this (?:role|position|company)) (?:do|does) not (?:offer|provide|support) (?:visa |immigration )?sponsorship|no visa sponsorship)\b/i;
  const yesVisa=/\b(?:visa sponsorship (?:is )?(?:available|provided|offered)|(?:we|the company|this employer) (?:offer|offers|provide|provides) visa sponsorship|visa sponsorship\s*[:\-]\s*yes)\b/i;
  const sponsorship=noVisa.test(text)?'not_offered':yesVisa.test(text)?'confirmed':'unknown';
  return {workMode,sponsorship};
}
