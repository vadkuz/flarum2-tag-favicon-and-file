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
  var IMAGE_EXTENSIONS = /\.(?:ico|png|svg|jpe?g|webp|avif|gif|bmp)(?:$|[?#])/i;
  var RULES_STYLE_ID = 'tag-favicon-rules';
  var rulesAdded = Object.create(null);

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

  function tryBoot() {
    if (booted || !ext || !Tag || !Tag.prototype) return;
    booted = true;

    ext.override(Tag.prototype, 'icon', function (original) {
      var iconValue = original.call(this);
      var favicon = parseFavicon(iconValue);

      if (!favicon) return iconValue;

      var dynamicClass = ensureRule(favicon.key, favicon.cssValue);
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
