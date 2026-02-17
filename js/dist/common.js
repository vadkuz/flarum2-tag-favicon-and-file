(function () {
  function unwrapModule(module) {
    if (!module) return null;
    return module.default || module;
  }

  var reg = flarum.reg;
  var ext = null;
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

  function normalizeUrl(url) {
    return String(url || '').trim();
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

  function buildSiteCssValue(host) {
    var safeHost = extractHost(host);
    if (!safeHost) return '';

    var encodedHost = encodeURIComponent(safeHost);
    var urls = [
      'https://www.google.com/s2/favicons?domain=' + encodedHost + '&sz=64',
      'https://' + safeHost + '/favicon.ico',
      'https://' + safeHost + '/favicon.png',
      'https://' + safeHost + '/favicon.svg',
      'https://' + safeHost + '/apple-touch-icon.png',
    ];

    return urls
      .map(function (url) {
        return 'url("' + escapeCssUrl(url) + '")';
      })
      .join(',');
  }

  function parseFavicon(iconValue) {
    var value = stripFaviconPrefix(iconValue);
    if (!value) return null;

    if (isLikelyImageUrl(value)) {
      return {
        key: 'url:' + value,
        cssValue: 'url("' + escapeCssUrl(value) + '")',
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

  function escapeCssUrl(url) {
    return String(url || '')
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\r/g, '')
      .replace(/\n/g, '');
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

  function tryBoot() {
    if (booted || !ext || !Tag || !Tag.prototype) return;
    booted = true;

    ext.override(Tag.prototype, 'icon', function (original) {
      var iconValue = original.call(this);
      var favicon = parseFavicon(iconValue);
      var iconify = parseIconify(iconValue);

      if (!favicon && !iconify) {
        ensureIconLibraries(iconValue);
        return iconValue;
      }

      var resolved = favicon || iconify;
      var dynamicClass = ensureRule(resolved.key, resolved.cssValue);
      return dynamicClass ? 'tag-favicon-icon ' + dynamicClass : 'tag-favicon-icon';
    });

    if (typeof m !== 'undefined' && m.redraw) {
      m.redraw();
    }
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

  loadModule('core', 'common/extend', function (module) {
    ext = module;
  });

  loadModule('flarum-tags', 'common/models/Tag', function (module) {
    Tag = module;
  });
})();

module.exports = { extend: [] };
