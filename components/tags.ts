/** Tags that look like version numbers (v1.2.0, 2.0, 1.0.0-rc1) are treated as release markers. */
export function isReleaseTag(name: string): boolean {
  return /^v?\d+(\.\d+){1,3}([-+][\w.-]+)?$/i.test(name);
}
