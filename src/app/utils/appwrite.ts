/* Appwrite client configuration.
   These values come from your Appwrite project's Settings page, and from
   the Database / Table you create for the "assets" table. */

import { Client, Databases, Storage, ID, Query } from 'appwrite';

export const APPWRITE_ENDPOINT =
  import.meta.env.VITE_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1';
export const APPWRITE_PROJECT_ID = import.meta.env.VITE_APPWRITE_PROJECT_ID as string;
export const APPWRITE_DATABASE_ID = import.meta.env.VITE_APPWRITE_DATABASE_ID as string;
// Hardcoded, not read from env — the "assets" table's ID in Appwrite is
// literally the string "assets" (set when the table was created), so this
// removes one env var you'd otherwise have to set correctly in Vercel.
// If you ever recreate the table with a different ID, update this value.
export const APPWRITE_ASSETS_COLLECTION_ID = 'assets';

/**
 * Which required variables are missing, or null when the config is complete.
 *
 * Vite inlines import.meta.env at build time, so an unset variable becomes the
 * literal `undefined` in the bundle. Appwrite then sends requests with no
 * project header and the failure comes back as a generic network/authorisation
 * error, which reads as "the database is down" rather than "this build was
 * compiled without credentials". Naming it here keeps that distinction.
 *
 * Because the value is baked in at build time, setting the variables on the
 * host is not enough on its own — the app has to be rebuilt or redeployed.
 */
const missingConfig = [
  !APPWRITE_PROJECT_ID && 'VITE_APPWRITE_PROJECT_ID',
  !APPWRITE_DATABASE_ID && 'VITE_APPWRITE_DATABASE_ID',
].filter(Boolean) as string[];

export const APPWRITE_CONFIG_ERROR: string | null = missingConfig.length
  ? `This build has no Appwrite credentials: ${missingConfig.join(' and ')} ${
      missingConfig.length > 1 ? 'were' : 'was'
    } not set when it was compiled. Set ${
      missingConfig.length > 1 ? 'them' : 'it'
    } in .env.local for local development, or in the host's environment variables, then rebuild.`
  : null;

if (APPWRITE_CONFIG_ERROR) {
  console.error(`🚨 ${APPWRITE_CONFIG_ERROR}`);
}

// Storage bucket holding app settings: the About-dialog image and the Superuser
// credential. Named "gili-settings" in the console; this is its generated ID.
//
// Appwrite assigns an ID when you leave the Bucket ID field blank, and the ID —
// not the display name — is what the API takes. Renaming the bucket is fine;
// changing its ID means updating this line.
//
// Bucket settings this code assumes:
//   File security  off, so the bucket-level permissions apply
//   Permissions    Any → Create, Read, Update, Delete
export const APPWRITE_SETTINGS_BUCKET_ID = '6a664fbd002089a25aa0';

// Fixed file IDs, so each setting is always the same object — saving replaces it
// instead of piling up orphans.
export const ABOUT_IMAGE_FILE_ID = 'about_image';
export const SUPERUSER_CREDENTIAL_FILE_ID = 'superuser_auth';
// The published library. Viewers read this instead of the database, which is what
// keeps database reads flat as the number of users grows. See librarySnapshot.ts.
export const LIBRARY_SNAPSHOT_FILE_ID = 'library_snapshot';
// The Harbor: the superuser's published collections, for everyone to read. Same
// bucket and same publish mechanics as the library snapshot, but a separate file:
// it is a few kilobytes against the library's ~1.8 MB, and it changes on a
// completely different schedule. See harbor.ts.
export const HARBOR_FILE_ID = 'harbor';

const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID);

export const databases = new Databases(client);
export const storage = new Storage(client);
export { ID, Query };
