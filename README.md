# flarum2-tag-favicon-and-file

Tag/category icon extension for Flarum 2.x.

Supports 3 icon sources:

- Font Awesome class
- favicon by URL or domain
- custom uploaded file (including SVG, PNG, ICO, etc.)

Also supports additional icon libraries in the `Icon` field:

- Remix Icon (`ri-*`)
- Material Design Icons (`mdi mdi-*`)
- Bootstrap Icons (`bi bi-*`)
- Iconify (`iconify:collection:icon`, for example `iconify:mdi:home`)

## Composer Package

`vadkuz/flarum2-tag-favicon-and-file`

## 🇷🇺 Русский

### Возможности

- Автоопределение favicon по домену: `whitebird.io` или `https://whitebird.io`
- Поддержка URL изображений: `.ico .png .svg .jpg .jpeg .webp .avif .gif .bmp`
- Загрузка собственного файла иконки из админки
- Автооптимизация загруженных растровых файлов (ресайз до 128px и сжатие)
- Поддержка Remix Icon, Material Design Icons, Bootstrap Icons и Iconify в поле `Иконка`
- Единый размер отображения иконки для всех вариантов
- Приоритет: загруженный файл -> favicon URL/домен -> Font Awesome
- Оптимизация: CSS-библиотеки иконок подгружаются только при необходимости

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
- `Иконка` (также: `ri-*`, `mdi mdi-*`, `bi bi-*`, `iconify:mdi:home`)
- `Favicon (URL или домен)`
- `Загрузить файл`

### Удаление

```bash
composer remove vadkuz/flarum2-tag-favicon-and-file
php flarum cache:clear
php flarum assets:publish
```

## 🇬🇧 English

### Features

- Automatic favicon detection by domain: `whitebird.io` or `https://whitebird.io`
- Supported image URL formats: `.ico .png .svg .jpg .jpeg .webp .avif .gif .bmp`
- Upload custom icon file from admin panel
- Automatic optimization for uploaded raster files (resize to 128px and compression)
- Supports Remix Icon, Material Design Icons, Bootstrap Icons, and Iconify in the `Icon` field
- Unified icon display size for all methods
- Priority: uploaded file -> favicon URL/domain -> Font Awesome
- Optimized: external icon CSS libraries are loaded only when needed

### Installation (via Packagist)

```bash
composer require vadkuz/flarum2-tag-favicon-and-file
php flarum extension:enable vadkuz-flarum2-tag-favicon-and-file
php flarum cache:clear
php flarum assets:publish
```

### Usage

Open a tag in admin panel and fill one of these fields:

- `Icon` (Font Awesome class)
- `Icon` (also: `ri-*`, `mdi mdi-*`, `bi bi-*`, `iconify:mdi:home`)
- `Favicon (URL or domain)`
- `Upload icon file`

### Removal

```bash
composer remove vadkuz/flarum2-tag-favicon-and-file
php flarum cache:clear
php flarum assets:publish
```
