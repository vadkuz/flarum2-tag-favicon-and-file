(function () {
  function unwrapModule(module) {
    if (!module) return null;
    return module.default || module;
  }

  var reg = flarum.reg;
  var app = null;
  var ext = null;
  var Stream = null;
  var EditTagModal = null;
  var Tag = null;
  var booted = false;

  var PREFIX = 'favicon:';
  var SITE_PREFIX = 'site:';
  var ICONIFY_PREFIX = 'iconify:';
  var ICONIFY_ICON_RE = /^[a-z0-9]+:[a-z0-9]+(?:-[a-z0-9]+)*$/i;
  var IMAGE_EXTENSIONS = /\.(?:ico|png|svg|jpe?g|webp|avif|gif|bmp)(?:$|[?#])/i;
  var RULES_STYLE_ID = 'tag-favicon-rules';
  var LIBRARY_STYLE_BY_NAME = {
    remix: 'https://cdn.jsdelivr.net/npm/remixicon@4.3.0/fonts/remixicon.css',
    mdi: 'https://cdn.jsdelivr.net/npm/@mdi/font@7.4.47/css/materialdesignicons.min.css',
    bootstrap: 'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css',
  };

  var rulesAdded = Object.create(null);
  var styleLinksRequested = Object.create(null);
  var librariesByIconCache = Object.create(null);
  var FILE_ACCEPT = '.ico,.png,.svg,.jpg,.jpeg,.webp,.avif,.gif,.bmp,image/*';

  function normalizeUrl(url) {
    return String(url || '').trim();
  }

  function getApiBaseUrl() {
    try {
      if (app && app.forum && typeof app.forum.attribute === 'function') {
        var apiUrl = normalizeUrl(app.forum.attribute('apiUrl'));
        if (apiUrl) {
          return apiUrl.replace(/\/+$/, '');
        }
      }
    } catch (_e) {}

    return '/api';
  }

  function buildCacheProxyUrl(params) {
    var query = [];
    if (params && params.url) {
      query.push('url=' + encodeURIComponent(params.url));
    }
    if (params && params.site) {
      query.push('site=' + encodeURIComponent(params.site));
    }

    return getApiBaseUrl() + '/tag-favicon/cache' + (query.length ? '?' + query.join('&') : '');
  }

  function stripFaviconPrefix(value) {
    var raw = normalizeUrl(value);
    if (raw.toLowerCase().indexOf(PREFIX) === 0) {
      return normalizeUrl(raw.slice(PREFIX.length));
    }

    return raw;
  }

  function parseAbsoluteUrl(value) {
    var raw = normalizeUrl(value);
    if (!raw) return null;

    try {
      if (/^https?:\/\//i.test(raw)) {
        return new URL(raw);
      }

      if (/^\/\//.test(raw)) {
        return new URL(window.location.protocol + raw);
      }
    } catch (_e) {
      return null;
    }

    return null;
  }

  function isLikelyImageUrl(value) {
    var raw = normalizeUrl(value);
    if (!raw) return false;

    if (/^data:image\//i.test(raw)) return true;

    if (/^\//.test(raw) && !/^\/\//.test(raw)) {
      return IMAGE_EXTENSIONS.test(raw);
    }

    var parsed = parseAbsoluteUrl(raw);
    if (parsed) {
      return IMAGE_EXTENSIONS.test(parsed.pathname || '');
    }

    return false;
  }

  function extractHost(value) {
    var raw = normalizeUrl(value);
    if (!raw) return '';

    var parsed = parseAbsoluteUrl(raw);
    if (parsed && parsed.hostname) {
      return parsed.hostname.toLowerCase();
    }

    if (/^[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(raw)) {
      return raw.split(/[/:?#]/)[0].toLowerCase();
    }

    return '';
  }

  function escapeCssUrl(url) {
    return String(url || '')
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\r/g, '')
      .replace(/\n/g, '');
  }

  function buildSiteCssValue(host) {
    var safeHost = extractHost(host);
    if (!safeHost) return '';

    return 'url("' + escapeCssUrl(buildCacheProxyUrl({ site: safeHost })) + '")';
  }

  function parseFaviconForIcon(iconValue) {
    var value = stripFaviconPrefix(iconValue);
    if (!value) return null;

    if (isLikelyImageUrl(value)) {
      if (/^data:image\//i.test(value)) {
        return {
          key: 'url:' + value,
          cssValue: 'url("' + escapeCssUrl(value) + '")',
        };
      }

      if (/^\//.test(value) && !/^\/\//.test(value)) {
        return {
          key: 'url:' + value,
          cssValue: 'url("' + escapeCssUrl(value) + '")',
        };
      }

      var parsed = parseAbsoluteUrl(value);
      if (parsed && parsed.origin === window.location.origin) {
        return {
          key: 'url:' + value,
          cssValue: 'url("' + escapeCssUrl(value) + '")',
        };
      }

      return {
        key: 'url:' + value,
        cssValue: 'url("' + escapeCssUrl(buildCacheProxyUrl({ url: value })) + '")',
      };
    }

    if (value.toLowerCase().indexOf(SITE_PREFIX) === 0) {
      var hostFromSite = extractHost(value.slice(SITE_PREFIX.length));
      if (!hostFromSite) return null;

      return {
        key: 'site:' + hostFromSite,
        cssValue: buildSiteCssValue(hostFromSite),
      };
    }

    var host = extractHost(value);
    if (host) {
      return {
        key: 'site:' + host,
        cssValue: buildSiteCssValue(host),
      };
    }

    return null;
  }

  function parseIconify(iconValue) {
    var raw = normalizeUrl(iconValue);
    if (!raw || raw.toLowerCase().indexOf(ICONIFY_PREFIX) !== 0) {
      return null;
    }

    var iconName = normalizeUrl(raw.slice(ICONIFY_PREFIX.length)).toLowerCase();
    if (!ICONIFY_ICON_RE.test(iconName)) {
      return null;
    }

    var apiUrl = 'https://api.iconify.design/' + iconName + '.svg';
    return {
      key: ICONIFY_PREFIX + iconName,
      cssValue: 'url("' + escapeCssUrl(apiUrl) + '")',
    };
  }

  function hashString(input) {
    var str = String(input || '');
    var hash = 5381;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & 0xffffffff;
    }

    return Math.abs(hash).toString(36);
  }

  function ensureStyleNode() {
    var style = document.getElementById(RULES_STYLE_ID);
    if (style) return style;

    style = document.createElement('style');
    style.id = RULES_STYLE_ID;
    document.head.appendChild(style);

    return style;
  }

  function ensureRule(ruleKey, cssValue) {
    var key = normalizeUrl(ruleKey);
    var cssUrl = normalizeUrl(cssValue);
    if (!key || !cssUrl) return '';

    var className = 'tag-favicon-' + hashString(key);
    if (rulesAdded[className]) return className;

    var style = ensureStyleNode();
    var css = '.' + className + '{--tag-favicon-url:' + cssUrl + ';}';

    if (style.sheet && style.sheet.insertRule) {
      try {
        style.sheet.insertRule(css, style.sheet.cssRules.length);
      } catch (_e) {
        style.appendChild(document.createTextNode(css));
      }
    } else {
      style.appendChild(document.createTextNode(css));
    }

    rulesAdded[className] = true;
    return className;
  }

  function splitClassNames(value) {
    var raw = normalizeUrl(value);
    if (!raw) return [];

    return raw.split(/\s+/).filter(Boolean);
  }

  function detectLibrariesForIcon(iconValue) {
    var icon = normalizeUrl(iconValue);
    if (!icon) return [];
    if (librariesByIconCache[icon]) return librariesByIconCache[icon];

    var tokens = splitClassNames(icon);
    var libs = [];

    var hasRemix = tokens.some(function (token) {
      return /^ri-[a-z0-9-]+$/i.test(token);
    });
    if (hasRemix) libs.push('remix');

    var hasMdi = tokens.some(function (token) {
      return token === 'mdi' || /^mdi-[a-z0-9-]+$/i.test(token);
    });
    if (hasMdi) libs.push('mdi');

    var hasBootstrap = tokens.some(function (token) {
      return token === 'bi' || /^bi-[a-z0-9-]+$/i.test(token);
    });
    if (hasBootstrap) libs.push('bootstrap');

    librariesByIconCache[icon] = libs;
    return libs;
  }

  function hasStylesheet(href) {
    var links = document.querySelectorAll('link[rel="stylesheet"]');
    for (var i = 0; i < links.length; i++) {
      if (normalizeUrl(links[i].href) === href) return true;
    }

    return false;
  }

  function ensureLibraryStylesheet(url) {
    var href = normalizeUrl(url);
    if (!href || styleLinksRequested[href]) return;

    styleLinksRequested[href] = true;
    if (hasStylesheet(href)) return;

    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-tag-favicon-lib', href);

    link.onload = function () {
      if (typeof m !== 'undefined' && m.redraw) {
        m.redraw();
      }
    };

    document.head.appendChild(link);
  }

  function ensureIconLibraries(iconValue) {
    detectLibrariesForIcon(iconValue).forEach(function (library) {
      ensureLibraryStylesheet(LIBRARY_STYLE_BY_NAME[library] || '');
    });
  }

  function normalizeFaviconInput(value) {
    var raw = stripFaviconPrefix(value);
    if (!raw) return '';

    if (raw.toLowerCase().indexOf(SITE_PREFIX) === 0) {
      raw = normalizeUrl(raw.slice(SITE_PREFIX.length));
    }

    if (isLikelyImageUrl(raw)) {
      return PREFIX + raw;
    }

    var host = extractHost(raw);
    if (host) {
      return PREFIX + SITE_PREFIX + host;
    }

    return '';
  }

  function parseFaviconUrl(iconValue) {
    var raw = normalizeUrl(iconValue);
    if (!raw) return '';

    var value = stripFaviconPrefix(raw);
    if (!value) return '';

    var hasPrefix = raw.toLowerCase().indexOf(PREFIX) === 0;
    if (!hasPrefix && !isLikelyImageUrl(value) && !extractHost(value)) {
      return '';
    }

    if (value.toLowerCase().indexOf(SITE_PREFIX) === 0) {
      return normalizeUrl(value.slice(SITE_PREFIX.length));
    }

    return value;
  }

  async function uploadFaviconFile(file) {
    var apiUrl = app.forum.attribute('apiUrl');
    var formData = new FormData();
    formData.append('file', file);

    var headers = {};
    if (app.session && app.session.csrfToken) {
      headers['X-CSRF-Token'] = app.session.csrfToken;
    }

    var response = await fetch(apiUrl + '/tag-favicon/upload', {
      method: 'POST',
      credentials: 'same-origin',
      headers: headers,
      body: formData,
    });

    var payload = null;
    try {
      payload = await response.json();
    } catch (_e) {
      payload = null;
    }

    if (!response.ok) {
      var message = payload && payload.error ? payload.error : null;
      throw new Error(message || app.translator.trans('vadkuz-flarum2-tag-favicon-and-file.admin.edit_tag.upload_error_default'));
    }

    if (!payload || typeof payload.path !== 'string' || !payload.path.trim()) {
      throw new Error(app.translator.trans('vadkuz-flarum2-tag-favicon-and-file.admin.edit_tag.upload_error_default'));
    }

    return payload.path.trim();
  }

  function tryBoot() {
    if (booted || !app || !ext || !Stream || !EditTagModal || !Tag) return;
    booted = true;

    ext.override(Tag.prototype, 'icon', function (original) {
      var iconValue = original.call(this);
      var favicon = parseFaviconForIcon(iconValue);
      var iconify = parseIconify(iconValue);

      if (!favicon && !iconify) {
        ensureIconLibraries(iconValue);
        return iconValue;
      }

      var resolved = favicon || iconify;
      var dynamicClass = ensureRule(resolved.key, resolved.cssValue);
      return dynamicClass ? 'tag-favicon-icon ' + dynamicClass : 'tag-favicon-icon';
    });

    ext.extend(EditTagModal.prototype, 'oninit', function () {
      var currentIcon = typeof this.icon === 'function' ? this.icon() : '';
      var faviconUrl = parseFaviconUrl(currentIcon);

      this.faviconUrl = Stream(faviconUrl);
      this.faviconUploadLoading = Stream(false);
      this.faviconUploadError = Stream('');

      if (faviconUrl && typeof this.icon === 'function') {
        this.icon('');
      }
    });

    ext.extend(EditTagModal.prototype, 'fields', function (items) {
      if (!this.faviconUrl) {
        this.faviconUrl = Stream('');
      }

      // Replace the default "Icon" help text with a combined one that also
      // documents other supported icon libraries + provides quick pick links.
      try {
        if (items && typeof items.add === 'function') {
          items.add(
            'icon',
            m('div', { className: 'Form-group' }, [
              m('label', app.translator.trans('flarum-tags.admin.edit_tag.icon_label')),
              m(
                'div',
                { className: 'helpText' },
                app.translator.trans('vadkuz-flarum2-tag-favicon-and-file.admin.edit_tag.icon_help', {
                  fa: m('a', {
                    href: 'https://fontawesome.com/v6/icons?o=r&m=free',
                    tabindex: '-1',
                    target: '_blank',
                    rel: 'noopener noreferrer',
                  }),
                  remix: m('a', {
                    href: 'https://remixicon.com/',
                    tabindex: '-1',
                    target: '_blank',
                    rel: 'noopener noreferrer',
                  }),
                  mdi: m('a', {
                    href: 'https://pictogrammers.com/library/mdi/',
                    tabindex: '-1',
                    target: '_blank',
                    rel: 'noopener noreferrer',
                  }),
                  bi: m('a', {
                    href: 'https://icons.getbootstrap.com/',
                    tabindex: '-1',
                    target: '_blank',
                    rel: 'noopener noreferrer',
                  }),
                  iconify: m('a', {
                    href: 'https://icon-sets.iconify.design/',
                    tabindex: '-1',
                    target: '_blank',
                    rel: 'noopener noreferrer',
                  }),
                })
              ),
              m('input', { className: 'FormControl', placeholder: 'fas fa-bolt', bidi: this.icon }),
            ]),
            10
          );
        }
      } catch (_e) {
        // This must never break the tag modal.
      }

      items.add(
        'faviconUrl',
        m('div', { className: 'Form-group' }, [
          m('label', app.translator.trans('vadkuz-flarum2-tag-favicon-and-file.admin.edit_tag.favicon_label')),
          m('div', { className: 'helpText' }, app.translator.trans('vadkuz-flarum2-tag-favicon-and-file.admin.edit_tag.favicon_help')),
          m('input', {
            className: 'FormControl',
            placeholder: app.translator.trans('vadkuz-flarum2-tag-favicon-and-file.admin.edit_tag.favicon_placeholder'),
            value: this.faviconUrl(),
            oninput: (e) => this.faviconUrl(e.target.value),
          }),
          m('label', { style: { marginTop: '12px', display: 'block' } }, app.translator.trans('vadkuz-flarum2-tag-favicon-and-file.admin.edit_tag.upload_label')),
          m('div', { className: 'helpText' }, app.translator.trans('vadkuz-flarum2-tag-favicon-and-file.admin.edit_tag.upload_help')),
          m('input', {
            className: 'FormControl',
            type: 'file',
            accept: FILE_ACCEPT,
            disabled: this.faviconUploadLoading(),
            onchange: async (e) => {
              var file = e.target && e.target.files ? e.target.files[0] : null;
              if (!file) return;

              this.faviconUploadLoading(true);
              this.faviconUploadError('');

              if (typeof m !== 'undefined' && m.redraw) {
                m.redraw();
              }

              try {
                var uploadedPath = await uploadFaviconFile(file);
                this.faviconUrl(uploadedPath);

                if (typeof this.icon === 'function') {
                  this.icon('');
                }
              } catch (error) {
                var message = error && error.message ? error.message : app.translator.trans('vadkuz-flarum2-tag-favicon-and-file.admin.edit_tag.upload_error_default');
                this.faviconUploadError(message);
              } finally {
                this.faviconUploadLoading(false);
                if (e.target) {
                  e.target.value = '';
                }

                if (typeof m !== 'undefined' && m.redraw) {
                  m.redraw();
                }
              }
            },
          }),
          this.faviconUploadLoading()
            ? m('div', { className: 'helpText' }, app.translator.trans('vadkuz-flarum2-tag-favicon-and-file.admin.edit_tag.uploading'))
            : null,
          this.faviconUploadError()
            ? m('div', { className: 'helpText', style: { color: '#b72f2f' } }, this.faviconUploadError())
            : null,
        ]),
        11
      );
    });

    ext.override(EditTagModal.prototype, 'submitData', function (original) {
      var data = original();
      var faviconUrl = this.faviconUrl ? normalizeFaviconInput(this.faviconUrl()) : '';

      if (faviconUrl) {
        data.icon = faviconUrl;
      } else if (typeof data.icon === 'string' && data.icon.trim().toLowerCase().indexOf(PREFIX) === 0) {
        data.icon = '';
      }

      if (typeof this.icon === 'function') {
        this.icon(data.icon || '');
      }

      if (this.tag && typeof this.tag.pushData === 'function') {
        this.tag.pushData({
          attributes: {
            icon: data.icon || '',
          },
        });
      }

      if (typeof m !== 'undefined' && m.redraw) {
        m.redraw();
      }

      return data;
    });
  }

  function loadModule(namespace, id, assign) {
    var current = unwrapModule(reg.get(namespace, id));
    if (current) {
      assign(current);
      tryBoot();
      return;
    }

    reg.onLoad(namespace, id, function (module) {
      assign(unwrapModule(module));
      tryBoot();
    });
  }

  loadModule('core', 'admin/app', function (module) {
    app = module;
  });

  loadModule('core', 'common/extend', function (module) {
    ext = module;
  });

  loadModule('core', 'common/utils/Stream', function (module) {
    Stream = module;
  });

  loadModule('flarum-tags', 'admin/components/EditTagModal', function (module) {
    EditTagModal = module;
  });

  loadModule('flarum-tags', 'common/models/Tag', function (module) {
    Tag = module;
  });
})();

module.exports = { extend: [] };
