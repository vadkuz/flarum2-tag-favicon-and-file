# flarum2-tag-favicon-and-file

Расширение для иконок тегов/категорий в Flarum 2.x.

Поддерживает 3 варианта иконок:

- класс Font Awesome
- favicon по URL или домену
- загрузка собственного файла (включая SVG, PNG, ICO и др.)

## Пакет Composer

`vadkuz/flarum2-tag-favicon-and-file`

## Возможности

- Автоопределение favicon по домену: `whitebird.io` или `https://whitebird.io`
- Поддержка URL изображений: `.ico .png .svg .jpg .jpeg .webp .avif .gif .bmp`
- Загрузка собственного файла иконки из админки
- Единый размер отображения иконки для всех вариантов
- Приоритет: загруженный файл -> favicon URL/домен -> Font Awesome

## Установка (рекомендуется, через Packagist)

```bash
composer require vadkuz/flarum2-tag-favicon-and-file
php flarum extension:enable vadkuz-flarum2-tag-favicon-and-file
php flarum cache:clear
php flarum assets:publish
```

Для установки через Packagist GitHub-токен не требуется.

## Использование

Откройте тег в админке и заполните одно из полей:

- `Иконка` (Font Awesome класс)
- `Favicon (URL или домен)`
- `Загрузить файл`

## Удаление

```bash
composer remove vadkuz/flarum2-tag-favicon-and-file
php flarum cache:clear
php flarum assets:publish
```
