import 'server-only';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const BUCKET = process.env.R2_BUCKET_NAME ?? 'ifms-photos';
const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;

const configured = !!(ACCOUNT_ID && ACCESS_KEY && SECRET_KEY);

/** Lazy-initialised S3 client (R2-compatible endpoint). */
let _client: S3Client | null = null;
function client(): S3Client {
  if (!_client) {
    if (!configured) throw new Error(
      'R2 not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY in .env'
    );
    _client = new S3Client({
      region: 'auto',
      endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: ACCESS_KEY!, secretAccessKey: SECRET_KEY! },
      // R2 doesn't need sigv4 in all regions, but 'auto' + standard S3 works.
    });
  }
  return _client;
}

/** Check if R2 is configured (env vars present). */
export function isStorageConfigured(): boolean {
  return configured;
}

/**
 * Upload a photo (raw bytes) to R2.
 * @param key  e.g. `"tenant_uuid/photo_uuid.jpg"`
 * @param body  Raw image bytes
 * @param contentType  e.g. `"image/jpeg"`
 */
export async function uploadPhoto(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  await client().send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
}

/**
 * Generate a signed GET URL for a photo, expiring after `ttlSeconds`.
 * Returns `null` if the key is empty (no photo).
 */
export async function getPhotoUrl(
  key: string,
  ttlSeconds = 3600,
): Promise<string | null> {
  if (!key) return null;
  const url = await getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn: ttlSeconds },
  );
  return url;
}

/**
 * Delete a photo from R2.
 */
export async function deletePhoto(key: string): Promise<void> {
  if (!key) return;
  await client().send(new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: key,
  }));
}
