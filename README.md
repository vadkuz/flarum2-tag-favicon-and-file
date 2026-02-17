# flarum2-tag-favicon-and-file

Tag/category icon extension for Flarum 2.x.

Supports 3 icon sources:

- Font Awesome class
- favicon by URL or domain
- custom uploaded file (including SVG, PNG, ICO, etc.)

## Composer Package

`vadkuz/flarum2-tag-favicon-and-file`

## Русский

### Возможности

- Автоопределение favicon по домену: `whitebird.io` или `https://whitebird.io`
- Поддержка URL изображений: `.ico .png .svg .jpg .jpeg .webp .avif .gif .bmp`
- Загрузка собственного файла иконки из админки
- Единый размер отображения иконки для всех вариантов
- Приоритет: загруженный файл -> favicon URL/домен -> Font Awesome

### Установка (через Packagist)

```bash
composer require vadkuz/flarum2-tag-favicon-and-file
php flarum extension:enable vadkuz-flarum2-tag-favicon-and-file
php flarum cache:clear
php flarum assets:publish
```

### Использование

Откройте тег в админке и заполните одно из полей:

- `Иконка` (Font Awesome класс)
- `Favicon (URL или домен)`
- `Загрузить файл`

### Удаление

```bash
composer remove vadkuz/flarum2-tag-favicon-and-file
php flarum cache:clear
php flarum assets:publish
```

## English

### Features

- Automatic favicon detection by domain: `whitebird.io` or `https://whitebird.io`
- Supported image URL formats: `.ico .png .svg .jpg .jpeg .webp .avif .gif .bmp`
- Upload custom icon file from admin panel
- Unified icon display size for all methods
- Priority: uploaded file -> favicon URL/domain -> Font Awesome

### Installation (via Packagist)

```bash
composer require vadkuz/flarum2-tag-favicon-and-file
php flarum extension:enable vadkuz-flarum2-tag-favicon-and-file
php flarum cache:clear
php flarum assets:publish
```

### Usage

Open a tag in admin panel and fill one of these fields:

- `Иконка` (Font Awesome class)
- `Favicon (URL или домен)`
- `Загрузить файл`

### Removal

```bash
composer remove vadkuz/flarum2-tag-favicon-and-file
php flarum cache:clear
php flarum assets:publish
```
