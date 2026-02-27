<?php

namespace Vadkuz\TagFavicon\Api\Controller;

use Flarum\Foundation\Paths;
use Laminas\Diactoros\Response;
use Laminas\Diactoros\Response\JsonResponse;
use Laminas\Diactoros\Stream;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\RequestHandlerInterface;
use RuntimeException;
use Vadkuz\TagFavicon\Support\ImageOptimizer;

class CacheController implements RequestHandlerInterface
{
    private const CACHE_TTL_SECONDS = 604800;
    private const CLIENT_CACHE_SECONDS = 86400;
    private const MAX_REMOTE_BYTES = 4194304;
    private const MAX_REDIRECTS = 5;
    private const CONNECT_TIMEOUT_SECONDS = 4;
    private const REQUEST_TIMEOUT_SECONDS = 8;

    /** @var array<string, string> */
    private const MIME_TO_EXTENSION = [
        'image/webp' => 'webp',
        'image/png' => 'png',
        'image/jpeg' => 'jpg',
        'image/jpg' => 'jpg',
        'image/gif' => 'gif',
        'image/bmp' => 'bmp',
        'image/x-icon' => 'ico',
        'image/vnd.microsoft.icon' => 'ico',
        'image/avif' => 'avif',
        'image/svg+xml' => 'svg',
    ];

    public function __construct(
        private readonly Paths $paths,
        private readonly ImageOptimizer $imageOptimizer
    ) {
    }

    public function handle(ServerRequestInterface $request): ResponseInterface
    {
        $query = $request->getQueryParams();
        $rawUrl = $this->normalizeInput($query['url'] ?? null);
        $rawSite = $this->normalizeInput($query['site'] ?? null);

        if ($rawUrl === '' && $rawSite === '') {
            return new JsonResponse(['error' => 'Missing "url" or "site" query parameter.'], 400);
        }

        if ($rawUrl !== '' && $rawSite !== '') {
            return new JsonResponse(['error' => 'Use either "url" or "site", not both.'], 400);
        }

        $sourceKey = '';
        $candidateUrls = [];

        if ($rawUrl !== '') {
            $url = $this->normalizeExternalUrl($rawUrl);
            if ($url === null) {
                return new JsonResponse(['error' => 'Invalid URL.'], 400);
            }

            $sourceKey = 'url:'.$url;
            $candidateUrls = [$url];
        } else {
            $host = $this->normalizeHostInput($rawSite);
            if ($host === '') {
                return new JsonResponse(['error' => 'Invalid site value.'], 400);
            }

            $sourceKey = 'site:'.$host;
            $candidateUrls = $this->buildSiteCandidates($host);
        }

        $cacheKey = sha1($sourceKey);
        $cacheDir = $this->ensureCacheDir();
        $cacheEntry = $this->loadCacheEntry($cacheDir, $cacheKey);

        if ($cacheEntry !== null && ! $this->isEntryExpired($cacheEntry['fetchedAt'])) {
            return $this->serveCachedFile($cacheEntry['path'], $cacheEntry['mime']);
        }

        $fresh = $this->fetchAndCache($cacheDir, $cacheKey, $sourceKey, $candidateUrls);
        if ($fresh !== null) {
            return $this->serveCachedFile($fresh['path'], $fresh['mime']);
        }

        if ($cacheEntry !== null) {
            return $this->serveCachedFile($cacheEntry['path'], $cacheEntry['mime']);
        }

        return new JsonResponse(['error' => 'Could not fetch favicon.'], 404);
    }

    private function ensureCacheDir(): string
    {
        $dir = rtrim($this->paths->public, '/').'/tag-favicon-cache';

        if (! is_dir($dir) && ! mkdir($dir, 0755, true) && ! is_dir($dir)) {
            throw new RuntimeException('Could not create tag favicon cache directory.');
        }

        return $dir;
    }

    /**
     * @return array{path: string, mime: string, fetchedAt: int}|null
     */
    private function loadCacheEntry(string $cacheDir, string $cacheKey): ?array
    {
        $metaPath = $cacheDir.'/'.$cacheKey.'.json';
        if (! is_file($metaPath)) {
            return null;
        }

        $raw = file_get_contents($metaPath);
        if (! is_string($raw) || $raw === '') {
            return null;
        }

        $meta = json_decode($raw, true);
        if (! is_array($meta)) {
            return null;
        }

        $extension = isset($meta['extension']) ? strtolower((string) $meta['extension']) : '';
        $mime = isset($meta['mime']) ? strtolower((string) $meta['mime']) : '';
        $fetchedAt = isset($meta['fetchedAt']) ? (int) $meta['fetchedAt'] : 0;

        if ($extension === '' || $mime === '' || $fetchedAt <= 0) {
            return null;
        }

        $path = $cacheDir.'/'.$cacheKey.'.'.$extension;
        if (! is_file($path)) {
            return null;
        }

        return [
            'path' => $path,
            'mime' => $mime,
            'fetchedAt' => $fetchedAt,
        ];
    }

    private function isEntryExpired(int $fetchedAt): bool
    {
        return $fetchedAt + self::CACHE_TTL_SECONDS < time();
    }

    /**
     * @param list<string> $candidateUrls
     * @return array{path: string, mime: string}|null
     */
    private function fetchAndCache(string $cacheDir, string $cacheKey, string $sourceKey, array $candidateUrls): ?array
    {
        foreach ($candidateUrls as $candidateUrl) {
            $download = $this->downloadWithRedirects($candidateUrl);
            if ($download === null) {
                continue;
            }

            $processed = $this->processDownloadedImage($download['body'], $download['contentType'], $download['finalUrl']);
            if ($processed === null) {
                continue;
            }

            foreach (glob($cacheDir.'/'.$cacheKey.'.*') ?: [] as $existingPath) {
                if (substr($existingPath, -5) === '.json') {
                    continue;
                }
                @unlink($existingPath);
            }

            $path = $cacheDir.'/'.$cacheKey.'.'.$processed['extension'];
            if (file_put_contents($path, $processed['content']) === false) {
                continue;
            }

            $metaPath = $cacheDir.'/'.$cacheKey.'.json';
            $meta = [
                'sourceKey' => $sourceKey,
                'sourceUrl' => $download['finalUrl'],
                'fetchedAt' => time(),
                'mime' => $processed['mime'],
                'extension' => $processed['extension'],
            ];
            @file_put_contents($metaPath, json_encode($meta, JSON_UNESCAPED_SLASHES));

            return [
                'path' => $path,
                'mime' => $processed['mime'],
            ];
        }

        return null;
    }

    /**
     * @return array{body: string, contentType: string, finalUrl: string}|null
     */
    private function downloadWithRedirects(string $initialUrl): ?array
    {
        $current = $initialUrl;

        for ($i = 0; $i <= self::MAX_REDIRECTS; $i++) {
            $safe = $this->normalizeExternalUrl($current);
            if ($safe === null || ! $this->isPublicHost($safe)) {
                return null;
            }

            $response = $this->httpGet($safe);
            if ($response === null) {
                return null;
            }

            $status = $response['status'];
            if ($status >= 300 && $status < 400) {
                $location = $response['location'];
                if ($location === '') {
                    return null;
                }

                $resolved = $this->resolveRedirectUrl($safe, $location);
                if ($resolved === null) {
                    return null;
                }

                $current = $resolved;
                continue;
            }

            if ($status >= 200 && $status < 300 && $response['body'] !== '') {
                return [
                    'body' => $response['body'],
                    'contentType' => $response['contentType'],
                    'finalUrl' => $safe,
                ];
            }

            return null;
        }

        return null;
    }

    /**
     * @return array{status: int, body: string, contentType: string, location: string}|null
     */
    private function httpGet(string $url): ?array
    {
        if (! function_exists('curl_init')) {
            return null;
        }

        $body = '';
        $bodySize = 0;
        $contentType = '';
        $location = '';

        $ch = curl_init($url);
        if ($ch === false) {
            return null;
        }

        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'GET');
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, self::CONNECT_TIMEOUT_SECONDS);
        curl_setopt($ch, CURLOPT_TIMEOUT, self::REQUEST_TIMEOUT_SECONDS);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, false);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
        curl_setopt($ch, CURLOPT_USERAGENT, 'Flarum Tag Favicon Cache');
        curl_setopt($ch, CURLOPT_ENCODING, '');

        curl_setopt($ch, CURLOPT_HEADERFUNCTION, static function ($curl, string $line) use (&$contentType, &$location): int {
            $trim = trim($line);
            if ($trim === '') {
                return strlen($line);
            }

            if (str_starts_with($trim, 'HTTP/')) {
                $contentType = '';
                $location = '';

                return strlen($line);
            }

            $pos = strpos($trim, ':');
            if ($pos === false) {
                return strlen($line);
            }

            $name = strtolower(trim(substr($trim, 0, $pos)));
            $value = trim(substr($trim, $pos + 1));

            if ($name === 'content-type') {
                $contentType = strtolower(trim(explode(';', $value)[0] ?? $value));
            }

            if ($name === 'location') {
                $location = $value;
            }

            return strlen($line);
        });

        curl_setopt($ch, CURLOPT_WRITEFUNCTION, static function ($curl, string $chunk) use (&$body, &$bodySize): int {
            $length = strlen($chunk);
            $bodySize += $length;
            if ($bodySize > self::MAX_REMOTE_BYTES) {
                return 0;
            }

            $body .= $chunk;

            return $length;
        });

        $ok = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $errno = curl_errno($ch);
        curl_close($ch);

        if ($ok === false || $errno !== 0) {
            return null;
        }

        return [
            'status' => $status,
            'body' => $body,
            'contentType' => $contentType,
            'location' => $location,
        ];
    }

    /**
     * @return array{content: string, extension: string, mime: string}|null
     */
    private function processDownloadedImage(string $binary, string $contentType, string $sourceUrl): ?array
    {
        $optimized = $this->imageOptimizer->optimizeRasterBinary($binary);
        if ($optimized !== null) {
            return $optimized;
        }

        if ($this->isLikelySafeSvg($binary, $contentType)) {
            return [
                'content' => $binary,
                'extension' => 'svg',
                'mime' => 'image/svg+xml',
            ];
        }

        $mime = $this->detectMime($binary, $contentType);
        if ($mime === '' || ! str_starts_with($mime, 'image/')) {
            return null;
        }

        $extension = self::MIME_TO_EXTENSION[$mime] ?? $this->detectExtensionFromUrl($sourceUrl);
        if ($extension === '') {
            return null;
        }

        return [
            'content' => $binary,
            'extension' => $extension,
            'mime' => $mime,
        ];
    }

    private function detectMime(string $binary, string $contentType): string
    {
        $ct = strtolower(trim($contentType));
        if (isset(self::MIME_TO_EXTENSION[$ct])) {
            return $ct;
        }

        if (function_exists('finfo_open') && function_exists('finfo_buffer')) {
            $finfo = finfo_open(FILEINFO_MIME_TYPE);
            if ($finfo !== false) {
                $detected = finfo_buffer($finfo, $binary);
                finfo_close($finfo);

                if (is_string($detected)) {
                    $detected = strtolower(trim($detected));
                    if (isset(self::MIME_TO_EXTENSION[$detected])) {
                        return $detected;
                    }
                }
            }
        }

        return '';
    }

    private function isLikelySafeSvg(string $binary, string $contentType): bool
    {
        $ct = strtolower(trim($contentType));
        $head = strtolower(substr($binary, 0, 2048));

        if ($ct !== 'image/svg+xml' && ! str_contains($head, '<svg')) {
            return false;
        }

        if (preg_match('/<\s*script|onload\s*=|onerror\s*=|<\s*foreignObject/i', $binary)) {
            return false;
        }

        return true;
    }

    private function detectExtensionFromUrl(string $url): string
    {
        $path = (string) (parse_url($url, PHP_URL_PATH) ?: '');
        $ext = strtolower((string) pathinfo($path, PATHINFO_EXTENSION));

        return in_array($ext, ['ico', 'png', 'svg', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp'], true) ? $ext : '';
    }

    private function resolveRedirectUrl(string $baseUrl, string $location): ?string
    {
        $location = trim($location);
        if ($location === '') {
            return null;
        }

        if (preg_match('~^https?://~i', $location)) {
            return $location;
        }

        $base = parse_url($baseUrl);
        if (! is_array($base) || ! isset($base['scheme'], $base['host'])) {
            return null;
        }

        if (str_starts_with($location, '//')) {
            return $base['scheme'].':'.$location;
        }

        $port = isset($base['port']) ? ':'.$base['port'] : '';

        if (str_starts_with($location, '/')) {
            return $base['scheme'].'://'.$base['host'].$port.$location;
        }

        $path = isset($base['path']) ? (string) $base['path'] : '/';
        $path = preg_replace('~/[^/]*$~', '/', $path) ?: '/';

        return $base['scheme'].'://'.$base['host'].$port.$path.$location;
    }

    private function normalizeExternalUrl(string $url): ?string
    {
        $trimmed = trim($url);
        if ($trimmed === '') {
            return null;
        }

        $parts = parse_url($trimmed);
        if (! is_array($parts)) {
            return null;
        }

        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        if (! in_array($scheme, ['http', 'https'], true)) {
            return null;
        }

        $host = strtolower((string) ($parts['host'] ?? ''));
        if ($host === '') {
            return null;
        }

        $path = isset($parts['path']) && $parts['path'] !== '' ? (string) $parts['path'] : '/';
        $query = isset($parts['query']) && $parts['query'] !== '' ? '?'.$parts['query'] : '';
        $port = isset($parts['port']) ? ':'.$parts['port'] : '';

        return $scheme.'://'.$host.$port.$path.$query;
    }

    private function normalizeHostInput(string $value): string
    {
        $value = trim($value);
        if ($value === '') {
            return '';
        }

        if (preg_match('~^https?://~i', $value)) {
            $host = parse_url($value, PHP_URL_HOST);
            $value = is_string($host) ? $host : '';
        }

        $value = strtolower(trim($value));
        $value = preg_replace('~[:/\\?#].*$~', '', $value) ?: '';

        if ($value === '' || ! preg_match('/^[a-z0-9.-]+$/i', $value)) {
            return '';
        }

        return $value;
    }

    /**
     * @return list<string>
     */
    private function buildSiteCandidates(string $host): array
    {
        $encoded = rawurlencode($host);

        return [
            'https://www.google.com/s2/favicons?domain='.$encoded.'&sz=128',
            'https://'.$host.'/favicon.ico',
            'https://'.$host.'/favicon.png',
            'https://'.$host.'/favicon.svg',
            'https://'.$host.'/apple-touch-icon.png',
        ];
    }

    private function isPublicHost(string $url): bool
    {
        $host = parse_url($url, PHP_URL_HOST);
        if (! is_string($host) || $host === '') {
            return false;
        }

        $host = strtolower($host);
        if ($host === 'localhost' || str_ends_with($host, '.local') || str_ends_with($host, '.internal')) {
            return false;
        }

        $ips = [];
        if (filter_var($host, FILTER_VALIDATE_IP)) {
            $ips[] = $host;
        } else {
            $v4 = gethostbynamel($host);
            if (is_array($v4)) {
                $ips = array_merge($ips, $v4);
            }

            if (function_exists('dns_get_record')) {
                $v6 = dns_get_record($host, DNS_AAAA);
                if (is_array($v6)) {
                    foreach ($v6 as $record) {
                        if (isset($record['ipv6']) && is_string($record['ipv6'])) {
                            $ips[] = $record['ipv6'];
                        }
                    }
                }
            }
        }

        if ($ips === []) {
            return false;
        }

        foreach ($ips as $ip) {
            if (! filter_var($ip, FILTER_VALIDATE_IP)) {
                return false;
            }

            $public = filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE);
            if ($public === false) {
                return false;
            }
        }

        return true;
    }

    private function normalizeInput(mixed $value): string
    {
        return is_string($value) ? trim($value) : '';
    }

    private function serveCachedFile(string $path, string $mime): ResponseInterface
    {
        if (! is_file($path)) {
            return new JsonResponse(['error' => 'Cached file not found.'], 404);
        }

        $stream = new Stream($path, 'r');
        $headers = [
            'Content-Type' => $mime,
            'Cache-Control' => 'public, max-age='.self::CLIENT_CACHE_SECONDS.', stale-while-revalidate='.self::CACHE_TTL_SECONDS,
            'X-Tag-Favicon-Cache' => 'HIT',
        ];

        return new Response($stream, 200, $headers);
    }
}
