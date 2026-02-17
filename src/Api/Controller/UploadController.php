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

class UploadController implements RequestHandlerInterface
{
    private const MAX_FILE_SIZE = 2097152;

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

        if ($extension === 'svg') {
            $stream = $uploadedFile->getStream();
            $stream->rewind();
            $svgContent = (string) $stream->getContents();
            $stream->rewind();

            // Lightweight hardening for SVG used in CSS backgrounds.
            if (preg_match('/<\s*script|onload\s*=|onerror\s*=|<\s*foreignObject/i', $svgContent)) {
                return new JsonResponse(['error' => 'Unsafe SVG content.'], 422);
            }
        }

        $relativeDir = '/tag-favicon-uploads';
        $absoluteDir = $this->paths->public.$relativeDir;
        if (! is_dir($absoluteDir) && ! mkdir($absoluteDir, 0755, true) && ! is_dir($absoluteDir)) {
            throw new RuntimeException('Could not create upload directory.');
        }

        $fileName = 'tag-favicon-'.bin2hex(random_bytes(12)).'.'.$extension;
        $absolutePath = $absoluteDir.'/'.$fileName;
        $relativePath = $relativeDir.'/'.$fileName;

        $uploadedFile->moveTo($absolutePath);

        return new JsonResponse([
            'path' => $relativePath,
            'icon' => 'favicon:'.$relativePath,
        ], 201);
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

