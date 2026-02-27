<?php

namespace Vadkuz\TagFavicon\Api\Controller;

use Flarum\Foundation\Paths;
use Flarum\Http\RequestUtil;
use Laminas\Diactoros\Response\JsonResponse;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Message\UploadedFileInterface;
use Psr\Http\Server\RequestHandlerInterface;
use RuntimeException;
use Throwable;

class UploadController implements RequestHandlerInterface
{
    private const MAX_FILE_SIZE = 2097152;
    private const MAX_ICON_DIMENSION = 128;
    private const WEBP_QUALITY = 82;
    private const PNG_COMPRESSION = 7;

    private const ALLOWED_EXTENSIONS = [
        'ico',
        'png',
        'svg',
        'jpg',
        'jpeg',
        'webp',
        'avif',
        'gif',
        'bmp',
    ];

    public function __construct(private readonly Paths $paths)
    {
    }

    public function handle(ServerRequestInterface $request): ResponseInterface
    {
        $actor = RequestUtil::getActor($request);
        $actor->assertAdmin();

        $uploadedFile = $this->extractUploadedFile($request);
        if (! $uploadedFile) {
            return new JsonResponse(['error' => 'No file uploaded.'], 422);
        }

        if ($uploadedFile->getError() !== UPLOAD_ERR_OK) {
            return new JsonResponse(['error' => 'Upload failed.'], 422);
        }

        if ($uploadedFile->getSize() <= 0 || $uploadedFile->getSize() > self::MAX_FILE_SIZE) {
            return new JsonResponse(['error' => 'File size must be between 1B and 2MB.'], 422);
        }

        $originalName = (string) $uploadedFile->getClientFilename();
        $extension = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
        if (! in_array($extension, self::ALLOWED_EXTENSIONS, true)) {
            return new JsonResponse(['error' => 'Unsupported file format.'], 422);
        }

        $targetExtension = $extension;
        $contentToWrite = null;
        $optimized = false;

        if ($extension === 'svg') {
            $stream = $uploadedFile->getStream();
            $stream->rewind();
            $svgContent = (string) $stream->getContents();
            $stream->rewind();

            // Lightweight hardening for SVG used in CSS backgrounds.
            if (preg_match('/<\s*script|onload\s*=|onerror\s*=|<\s*foreignObject/i', $svgContent)) {
                return new JsonResponse(['error' => 'Unsafe SVG content.'], 422);
            }

            $contentToWrite = $svgContent;
        } else {
            $processed = $this->optimizeRasterImage($uploadedFile);
            if ($processed !== null) {
                $contentToWrite = $processed['content'];
                $targetExtension = $processed['extension'];
                $optimized = true;
            }
        }

        $relativeDir = '/tag-favicon-uploads';
        $absoluteDir = $this->paths->public.$relativeDir;
        if (! is_dir($absoluteDir) && ! mkdir($absoluteDir, 0755, true) && ! is_dir($absoluteDir)) {
            throw new RuntimeException('Could not create upload directory.');
        }

        $fileName = 'tag-favicon-'.bin2hex(random_bytes(12)).'.'.$targetExtension;
        $absolutePath = $absoluteDir.'/'.$fileName;
        $relativePath = $relativeDir.'/'.$fileName;

        if ($contentToWrite !== null) {
            if (file_put_contents($absolutePath, $contentToWrite) === false) {
                throw new RuntimeException('Could not write uploaded file.');
            }
        } else {
            $uploadedFile->moveTo($absolutePath);
        }

        return new JsonResponse([
            'path' => $relativePath,
            'icon' => 'favicon:'.$relativePath,
            'optimized' => $optimized,
        ], 201);
    }

    /**
     * @return array{content: string, extension: string}|null
     */
    private function optimizeRasterImage(UploadedFileInterface $uploadedFile): ?array
    {
        $stream = $uploadedFile->getStream();
        $stream->rewind();
        $binary = (string) $stream->getContents();
        $stream->rewind();

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
     * @return array{content: string, extension: string}|null
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
            ];
        } catch (Throwable) {
            return null;
        }
    }

    /**
     * @return array{content: string, extension: string}|null
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
            $ok = imagepng($target, null, self::PNG_COMPRESSION);

            if (function_exists('imagewebp')) {
                ob_end_clean();
                ob_start();
                $extension = 'webp';
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
            ];
        } finally {
            imagedestroy($source);
        }
    }

    private function extractUploadedFile(ServerRequestInterface $request): ?UploadedFileInterface
    {
        $uploadedFiles = $request->getUploadedFiles();

        if (isset($uploadedFiles['file']) && $uploadedFiles['file'] instanceof UploadedFileInterface) {
            return $uploadedFiles['file'];
        }

        foreach ($uploadedFiles as $file) {
            if ($file instanceof UploadedFileInterface) {
                return $file;
            }
        }

        return null;
    }
}
