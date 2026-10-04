/** E-11: thrown by every decoder on owner / discriminator / size mismatch. The app enters read-only Maintenance mode. */
export class LayoutMismatch extends Error {
  constructor(
    public readonly account: string,
    public readonly reason: 'owner' | 'discriminator' | 'size',
    public readonly detail: string,
  ) {
    super(`LayoutMismatch(${account}): ${reason} — ${detail}`);
    this.name = 'LayoutMismatch';
  }
}
