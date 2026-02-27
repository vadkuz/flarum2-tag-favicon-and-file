<?php

use Flarum\Extend;
use Vadkuz\TagFavicon\Api\Controller\CacheController;
use Vadkuz\TagFavicon\Api\Controller\UploadController;

return [
    (new Extend\Frontend('forum'))
        ->js(__DIR__.'/js/dist/common.js')
        ->css(__DIR__.'/less/common.css'),

    (new Extend\Frontend('admin'))
        ->js(__DIR__.'/js/dist/admin.js')
        ->css(__DIR__.'/less/common.css'),

    (new Extend\Routes('api'))
        ->get('/tag-favicon/cache', 'vadkuz.tag-favicon.cache', CacheController::class)
        ->post('/tag-favicon/upload', 'vadkuz.tag-favicon.upload', UploadController::class),

    new Extend\Locales(__DIR__.'/locale'),
];
