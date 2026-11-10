/** Pure presentation rules. The server remains the authorization authority. */
export function availableOutreachActions(draft, approval, intent) {
  const active = Boolean(approval);
  const hasIntent = Boolean(intent);
  return {
    approve: draft?.status === 'draft' && !active && !hasIntent,
    queue: draft?.status === 'approved' && active && !hasIntent,
    revoke: active || intent?.status === 'pending',
  };
}
