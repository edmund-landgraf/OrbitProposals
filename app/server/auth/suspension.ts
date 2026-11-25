/** True when an admin has suspended the account. Callers must treat this like an unknown email. */
export function userIsSuspended(user: { suspendedAt?: Date | string | null } | null | undefined): boolean {
  if (!user?.suspendedAt) return false;
  const at = user.suspendedAt instanceof Date ? user.suspendedAt.getTime() : new Date(user.suspendedAt).getTime();
  return !Number.isNaN(at);
}
