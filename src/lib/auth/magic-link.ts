export function magicLinkOptions(origin: string) {
  return {
    emailRedirectTo: origin,
    shouldCreateUser: false,
  } as const;
}
