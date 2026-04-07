/**
 * Image compression for large attachments.
 *
 * Claude Code's Read tool has a token limit (~15000 tokens for images).
 * Large images (>500KB) exceed this limit and fail silently.
 * This module compresses images before saving to disk, keeping them
 * within the Read tool's capacity while preserving visual quality.
 */
import type { ImageAttachment } from './channel.js';
/** Images larger than this (bytes) will be compressed. */
export declare const COMPRESS_THRESHOLD = 500000;
/** Max dimension (width or height) after resize. */
export declare const MAX_DIMENSION = 1024;
/** JPEG quality for compression (0-100). */
export declare const JPEG_QUALITY = 80;
/**
 * Compress an image if it exceeds the size threshold.
 * Returns the original image unchanged if it's already small enough
 * or if sharp is not available.
 */
export declare function compressImage(img: ImageAttachment): Promise<ImageAttachment>;
/**
 * Compress all images in an array that exceed the threshold.
 */
export declare function compressImages(images: ImageAttachment[]): Promise<ImageAttachment[]>;
//# sourceMappingURL=image-compress.d.ts.map