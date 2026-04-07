/**
 * Image compression for large attachments.
 *
 * Claude Code's Read tool has a token limit (~15000 tokens for images).
 * Large images (>500KB) exceed this limit and fail silently.
 * This module compresses images before saving to disk, keeping them
 * within the Read tool's capacity while preserving visual quality.
 */
/** Images larger than this (bytes) will be compressed. */
export const COMPRESS_THRESHOLD = 500_000; // 500KB
/** Max dimension (width or height) after resize. */
export const MAX_DIMENSION = 1024;
/** JPEG quality for compression (0-100). */
export const JPEG_QUALITY = 80;
/**
 * Compress an image if it exceeds the size threshold.
 * Returns the original image unchanged if it's already small enough
 * or if sharp is not available.
 */
export async function compressImage(img) {
    // Skip small images
    if (img.data.length <= COMPRESS_THRESHOLD) {
        return img;
    }
    // Skip non-raster formats
    if (img.mimeType === 'image/svg+xml' || img.mimeType === 'image/gif') {
        return img;
    }
    let sharp;
    try {
        sharp = (await import('sharp')).default;
    }
    catch {
        // sharp not installed — return original with a console warning
        console.warn('[image-compress] sharp not available, skipping compression for large image');
        return img;
    }
    try {
        const pipeline = sharp(img.data)
            .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: JPEG_QUALITY });
        const compressed = await pipeline.toBuffer();
        // Only use compressed version if it's actually smaller
        if (compressed.length >= img.data.length) {
            return img;
        }
        const ext = img.fileName ? img.fileName.replace(/\.[^.]+$/, '.jpg') : undefined;
        return {
            mimeType: 'image/jpeg',
            data: compressed,
            fileName: ext || img.fileName,
        };
    }
    catch (e) {
        console.warn(`[image-compress] compression failed, using original: ${e.message}`);
        return img;
    }
}
/**
 * Compress all images in an array that exceed the threshold.
 */
export async function compressImages(images) {
    return Promise.all(images.map(compressImage));
}
//# sourceMappingURL=image-compress.js.map