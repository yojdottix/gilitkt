/**
 * Single source of truth for GILI's version.
 *
 * Bump the PATCH number by one on every build that gets handed over
 * (1.0.15 -> 1.0.16 -> 1.0.17 ...), and the MINOR when a release is big enough
 * to be worth calling out. Keep this in sync with the version in package.json
 * and the delivered zip filename.
 */
export const APP_VERSION = "2.0.2";
