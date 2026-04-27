export const oauthStateStore = new Map<string, {
  userId: number;
  codeVerifier: string;
  state: string;
  expiresAt: Date;
}>();
