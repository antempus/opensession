/** Private media needs owner-bound storage and serving, not the shared uploads
 * path. Until that contract exists, reject requested images before any effects.
 * Do not parse/filter them: missing or malformed attachments must not disappear.
 */
export function assertPersonalImagesAbsent(images: unknown): void {
  if (images === undefined || (Array.isArray(images) && images.length === 0))
    return;
  throw new Error("Image attachments are unavailable in private sessions");
}
