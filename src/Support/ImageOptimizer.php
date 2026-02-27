<?php

namespace Vadkuz\TagFavicon\Support;

use Throwable;

class ImageOptimizer
{
    public const MAX_ICON_DIMENSION = 128;
    public const WEBP_QUALITY = 82;
    public const PNG_COMPRESSION = 7;

    /**
     * @return array{content: string, extension: string, mime: string}|null
     */
    public function optimizeRasterBinary(string $binary): ?array
    {
        if ($binary === '') {
            return null;
        }

        $imagickResult = $this->optimizeWithImagick($binary);
        if ($imagickResult !== null) {
            return $imagickResult;
        }

        return $this->optimizeWithGd($binary);
    }

    /**
     * @return array{content: string, extension: string, mime: string}|null
     */
    private function optimizeWithImagick(string $binary): ?array
    {
        if (! class_exists(\Imagick::class)) {
            return null;
        }

        try {
            $imagick = new \Imagick();
            $imagick->readImageBlob($binary);
            $imagick->setIteratorIndex(0);

            if (method_exists($imagick, 'autoOrient')) {
                $imagick->autoOrient();
            }

            $width = $imagick->getImageWidth();
            $height = $imagick->getImageHeight();
            if ($width > self::MAX_ICON_DIMENSION || $height > self::MAX_ICON_DIMENSION) {
                $imagick->thumbnailImage(self::MAX_ICON_DIMENSION, self::MAX_ICON_DIMENSION, true, true);
            }

            $imagick->stripImage();
            $imagick->setImageFormat('webp');
            $imagick->setImageCompressionQuality(self::WEBP_QUALITY);

            $optimized = $imagick->getImageBlob();

            $imagick->clear();
            $imagick->destroy();

            if (! is_string($optimized) || $optimized === '') {
                return null;
            }

            return [
                'content' => $optimized,
                'extension' => 'webp',
                'mime' => 'image/webp',
            ];
        } catch (Throwable) {
            return null;
        }
    }

    /**
     * @return array{content: string, extension: string, mime: string}|null
     */
    private function optimizeWithGd(string $binary): ?array
    {
        if (! function_exists('imagecreatefromstring')) {
            return null;
        }

        $source = @imagecreatefromstring($binary);
        if (! $source) {
            return null;
        }

        try {
            $srcWidth = imagesx($source);
            $srcHeight = imagesy($source);
            if ($srcWidth <= 0 || $srcHeight <= 0) {
                return null;
            }

            $ratio = min(
                1,
                self::MAX_ICON_DIMENSION / $srcWidth,
                self::MAX_ICON_DIMENSION / $srcHeight
            );

            $dstWidth = max(1, (int) round($srcWidth * $ratio));
            $dstHeight = max(1, (int) round($srcHeight * $ratio));

            $target = imagecreatetruecolor($dstWidth, $dstHeight);
            if (! $target) {
                return null;
            }

            imagealphablending($target, false);
            imagesavealpha($target, true);
            $transparent = imagecolorallocatealpha($target, 0, 0, 0, 127);
            imagefill($target, 0, 0, $transparent);

            imagecopyresampled(
                $target,
                $source,
                0,
                0,
                0,
                0,
                $dstWidth,
                $dstHeight,
                $srcWidth,
                $srcHeight
            );

            ob_start();
            $extension = 'png';
            $mime = 'image/png';
            $ok = imagepng($target, null, self::PNG_COMPRESSION);

            if (function_exists('imagewebp')) {
                ob_end_clean();
                ob_start();
                $extension = 'webp';
                $mime = 'image/webp';
                $ok = imagewebp($target, null, self::WEBP_QUALITY);
            }

            $optimized = ob_get_clean();
            imagedestroy($target);

            if (! $ok || ! is_string($optimized) || $optimized === '') {
                return null;
            }

            return [
                'content' => $optimized,
                'extension' => $extension,
                'mime' => $mime,
            ];
        } finally {
            imagedestroy($source);
        }
    }
}
