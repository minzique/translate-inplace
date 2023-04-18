// Copyright 2014 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// This code is used in conjunction with the Google Translate Element script.
// It is executed in an isolated world of a page to translate it from one
// language to another.
// It should be included in the page before the Translate Element script.
try {
  var translateApiKey = "";
  var serverParams = "";
  var gtTimeInfo = {};

  // eslint-disable-next-line no-var
  var cr = cr || {};

  /**
   * An object to provide functions to interact with the Translate library.
   * @type {object}
   */
  cr.googleTranslate = (function () {
    /**
     * The Translate Element library's instance.
     * @type {object}
     */
    let lib;

    /**
     * A flag representing if the Translate Element library is initialized.
     * @type {boolean}
     */
    let libReady = false;

    /**
     * Error definitions for |errorCode|. See chrome/common/translate_errors.h
     * to modify the definition.
     * @const
     */
    const ERROR = {
      NONE: 0,
      INITIALIZATION_ERROR: 2,
      UNSUPPORTED_LANGUAGE: 4,
      TRANSLATION_ERROR: 6,
      TRANSLATION_TIMEOUT: 7,
      UNEXPECTED_SCRIPT_ERROR: 8,
      BAD_ORIGIN: 9,
      SCRIPT_LOAD_ERROR: 10,
    };

    /**
     * Error code map from te.dom.DomTranslator.Error to |errorCode|.
     * See also go/dom_translator.js in google3.
     * @const
     */
    const TRANSLATE_ERROR_TO_ERROR_CODE_MAP = {
      0: ERROR["NONE"],
      1: ERROR["TRANSLATION_ERROR"],
      2: ERROR["UNSUPPORTED_LANGUAGE"],
    };

    /**
     * An error code happened in translate.js and the Translate Element library.
     */
    let errorCode = ERROR["NONE"];

    /**
     * A flag representing if the Translate Element has finished a translation.
     * @type {boolean}
     */
    let finished = false;

    /**
     * Counts how many times the checkLibReady function is called. The function
     * is called in every 100 msec and counted up to 6.
     * @type {number}
     */
    let checkReadyCount = 0;

    /**
     * Time in msec when this script is injected.
     * @type {number}
     */
    const injectedTime = performance.now();

    /**
     * Time in msec when the Translate Element library is loaded completely.
     * @type {number}
     */
    let loadedTime = 0.0;

    /**
     * Time in msec when the Translate Element library is initialized and ready
     * for performing translation.
     * @type {number}
     */
    let readyTime = 0.0;

    /**
     * Time in msec when the Translate Element library starts a translation.
     * @type {number}
     */
    let startTime = 0.0;

    /**
     * Time in msec when the Translate Element library ends a translation.
     * @type {number}
     */
    let endTime = 0.0;

    /**
     * Callback invoked when Translate Element's ready state is known.
     * Will only be invoked once to indicate successful or failed initialization.
     * In the failure case, errorCode() and error() will indicate the reason.
     * Only used on iOS.
     * @type {function}
     */
    let readyCallback;

    /**
     * Callback invoked when Translate Element's translation result is known.
     * Will only be invoked once to indicate successful or failed translation.
     * In the failure case, errorCode() and error() will indicate the reason.
     * Only used on iOS.
     * @type {function}
     */
    let resultCallback;

    /**
     * Callback invoked when Translate Element requests load of javascript files.
     * Currently main.js and element_main.js are expected to be loaded.
     * @type {function(string)}
     */
    let loadJavascriptCallback;

    function checkLibReady() {
      if (lib.isAvailable()) {
        readyTime = performance.now();
        libReady = true;
        invokeReadyCallback();
        return;
      }
      if (checkReadyCount++ > 5) {
        errorCode = ERROR["TRANSLATION_TIMEOUT"];
        invokeReadyCallback();
        return;
      }
      setTimeout(checkLibReady, 100);
    }

    function onTranslateProgress(progress, opt_finished, opt_error) {
      finished = opt_finished;
      // opt_error can be 'undefined'.
      if (typeof opt_error === "boolean" && opt_error) {
        // TODO(toyoshim): Remove boolean case once a server is updated.
        errorCode = ERROR["TRANSLATION_ERROR"];
        // We failed to translate, restore so the page is in a consistent state.
        lib.restore();
        invokeResultCallback();
      } else if (typeof opt_error === "number" && opt_error !== 0) {
        errorCode = TRANSLATE_ERROR_TO_ERROR_CODE_MAP[opt_error];
        lib.restore();
        invokeResultCallback();
      }
      // Translate works differently depending on the prescence of the native
      // IntersectionObserver APIs.
      // If it is available, translate will occur incrementally as the user
      // scrolls elements into view, and this method will be called continuously
      // with |opt_finished| always set as true.
      // On the other hand, if it is unavailable, the entire page will be
      // translated at once in a piece meal manner, and this method may still be
      // called several times, though only the last call will have |opt_finished|
      // set as true.
      if (finished) {
        endTime = performance.now();
        invokeResultCallback();
      }
    }

    function invokeReadyCallback() {
      if (readyCallback) {
        readyCallback();
        readyCallback = null;
      }
    }

    function invokeResultCallback() {
      if (resultCallback) {
        resultCallback();
        resultCallback = null;
      }
    }

    // Public API.
    return {
      /**
       * Setter for readyCallback. No op if already set.
       * @param {function} callback The function to be invoked.
       */
      set readyCallback(callback) {
        if (!readyCallback) {
          readyCallback = callback;
        }
      },

      /**
       * Setter for resultCallback. No op if already set.
       * @param {function} callback The function to be invoked.
       */
      set resultCallback(callback) {
        if (!resultCallback) {
          resultCallback = callback;
        }
      },

      /**
       * Setter for loadJavascriptCallback. No op if already set.
       * @param {function(string)} callback The function to be invoked.
       */
      set loadJavascriptCallback(callback) {
        if (!loadJavascriptCallback) {
          loadJavascriptCallback = callback;
        }
      },

      /**
       * Whether the library is ready.
       * The translate function should only be called when |libReady| is true.
       * @type {boolean}
       */
      get libReady() {
        return libReady;
      },

      /**
       * Whether the current translate has finished successfully.
       * @type {boolean}
       */
      get finished() {
        return finished;
      },

      /**
       * Whether an error occured initializing the library of translating the
       * page.
       * @type {boolean}
       */
      get error() {
        return errorCode !== ERROR["NONE"];
      },

      /**
       * Returns a number to represent error type.
       * @type {number}
       */
      get errorCode() {
        return errorCode;
      },

      /**
       * The language the page translated was in. Is valid only after the page
       * has been successfully translated and the original language specified to
       * the translate function was 'auto'. Is empty otherwise.
       * Some versions of Element library don't provide |getDetectedLanguage|
       * function. In that case, this function returns 'und'.
       * @type {boolean}
       */
      get sourceLang() {
        if (!libReady || !finished || errorCode !== ERROR["NONE"]) {
          return "";
        }
        if (!lib.getDetectedLanguage) {
          return "und";
        } // Defined as translate::kUnknownLanguageCode in C++.
        return lib.getDetectedLanguage();
      },

      /**
       * Time in msec from this script being injected to all server side scripts
       * being loaded.
       * @type {number}
       */
      get loadTime() {
        if (loadedTime === 0) {
          return 0;
        }
        return loadedTime - injectedTime;
      },

      /**
       * Time in msec from this script being injected to the Translate Element
       * library being ready.
       * @type {number}
       */
      get readyTime() {
        if (!libReady) {
          return 0;
        }
        return readyTime - injectedTime;
      },

      /**
       * Time in msec to perform translation.
       * @type {number}
       */
      get translationTime() {
        if (!finished) {
          return 0;
        }
        return endTime - startTime;
      },

      /**
       * Translate the page contents.  Note that the translation is asynchronous.
       * You need to regularly check the state of |finished| and |errorCode| to
       * know if the translation finished or if there was an error.
       * @param {string} sourceLang The language the page is in.
       * @param {string} targetLang The language the page should be translated to.
       * @return {boolean} False if the translate library was not ready, in which
       *                   case the translation is not started.  True otherwise.
       */
      translate(sourceLang, targetLang) {
        finished = false;
        errorCode = ERROR["NONE"];
        if (!libReady) {
          return false;
        }
        startTime = performance.now();
        try {
          lib.translatePage(sourceLang, targetLang, onTranslateProgress);
        } catch (err) {
          console.error("Translate: " + err);
          errorCode = ERROR["UNEXPECTED_SCRIPT_ERROR"];
          invokeResultCallback();
          return false;
        }
        return true;
      },

      /**
       * Reverts the page contents to its original value, effectively reverting
       * any performed translation.  Does nothing if the page was not translated.
       */
      revert() {
        lib.restore();
      },

      /**
       * Called when an error is caught while executing script fetched in
       * translate_script.cc.
       */
      onTranslateElementError(error) {
        errorCode = ERROR["UNEXPECTED_SCRIPT_ERROR"];
        invokeReadyCallback();
      },

      /**
       * Entry point called by the Translate Element once it has been injected in
       * the page.
       */
      onTranslateElementLoad() {
        loadedTime = performance.now();
        try {
          lib = google.translate.TranslateService({
            // translateApiKey is predefined by translate_script.cc.

            // TODO: ADD these to config.js
            // key: "AIzaSyBOti4mM-6x9WDnZIjIeyEU21OpBXqWBgw",
            // 'serverParams': serverParams,
            // 'timeInfo': gtTimeInfo,
            useSecureConnection: true,
          });
          translateApiKey = undefined;
          serverParams = undefined;
          gtTimeInfo = undefined;
        } catch (err) {
          console.log(err);
          errorCode = ERROR["INITIALIZATION_ERROR"];
          translateApiKey = undefined;
          serverParams = undefined;
          gtTimeInfo = undefined;
          invokeReadyCallback();
          return;
        }
        // The TranslateService is not available immediately as it needs to start
        // Flash.  Let's wait until it is ready.
        checkLibReady();
      },

      /**
       * Entry point called by the Translate Element when it want to load an
       * external CSS resource into the page.
       * @param {string} url URL of an external CSS resource to load.
       */
      onLoadCSS(url) {
        // fetch(url)
        //   .then((d) => d.text())
        //   .then((text) => {
        //     const element = document.createElement("style");
        //     element.type = "text/css";
        //     element.charset = "UTF-8";
        //     element.innerText = text;
        //     document.head.appendChild(element);
        //   });

        const element = document.createElement("link");
        element.type = "text/css";
        element.rel = "stylesheet";
        element.charset = "UTF-8";
        element.href = url;
        document.head.appendChild(element);
      },

      /**
       * Entry point called by the Translate Element when it want to load and run
       * an external JavaScript on the page.
       * @param {string} url URL of an external JavaScript to load.
       */
      onLoadJavascript(url) {
        // securityOrigin is predefined by translate_script.cc.
        // FIXME
        // if (!url.startsWith(securityOrigin)) {
        //   console.error('Translate: ' + url + ' is not allowed to load.');
        //   errorCode = ERROR['BAD_ORIGIN'];
        //   return;
        // }

        if (loadJavascriptCallback) {
          loadJavascriptCallback(url);
          return;
        }

        // fetch(url)
        //   .then((data) => data.text())
        //   .then((d) => {
        //     console.log(url);
        //     const fetch_func = new Function(d);
        //     fetch_func();
        //   });

        const xhr = new XMLHttpRequest();
        xhr.open("GET", url, true);
        xhr.onreadystatechange = function () {
          if (this.readyState !== this.DONE) {
            return;
          }
          if (this.status !== 200) {
            errorCode = ERROR["SCRIPT_LOAD_ERROR"];
            return;
          }
          // Execute translate script using an anonymous function on the window,
          // this prevents issues with the code being inside of the scope of the
          // XHR request.
          new Function(this.responseText).call(window);
        };
        xhr.send();
      },
    };
  })();

  cr.googleTranslate.readyCallback = () => {
    cr.googleTranslate.translate("auto", 'en');
  };

  // go/mss-setup#7-load-the-js-or-css-from-your-initial-page
  if (!window["_DumpException"]) {
    const _DumpException =
      window["_DumpException"] ||
      function (e) {
        throw e;
      };
    window["_DumpException"] = _DumpException;
  }
  ("use strict");
  this.default_tr = this.default_tr || {};
  (function (_) {
    var window = this;
    try {
      /*

 Copyright The Closure Library Authors.
 SPDX-License-Identifier: Apache-2.0
*/
      /*

 SPDX-License-Identifier: Apache-2.0
*/
      var ba, ea, ja, ra, xa, Aa, Pa, Sa, Ta, Ua, Va, ab, bb, cb, db, eb, fb, hb, ib, mb;
      _.aa = function (a, b) {
        if (Error.captureStackTrace) Error.captureStackTrace(this, _.aa);
        else {
          var c = Error().stack;
          c && (this.stack = c);
        }
        a && (this.message = String(a));
        void 0 !== b && (this.cause = b);
      };
      ba = function (a) {
        _.q.setTimeout(function () {
          throw a;
        }, 0);
      };
      _.ca = function (a) {
        a && "function" == typeof a.U && a.U();
      };
      ea = function (a) {
        for (var b = 0, c = arguments.length; b < c; ++b) {
          var d = arguments[b];
          _.da(d) ? ea.apply(null, d) : _.ca(d);
        }
      };
      ja = function () {
        !_.fa && _.ha && _.ia();
        return _.fa;
      };
      _.ia = function () {
        _.fa = (0, _.ha)();
        ka.forEach(function (a) {
          a(_.fa);
        });
        ka = [];
      };
      _.ma = function (a) {
        _.fa && la(a);
      };
      _.oa = function () {
        _.fa && na(_.fa);
      };
      ra = function (a, b) {
        b.hasOwnProperty("displayName") || (b.displayName = a);
        b[qa] = a;
      };
      _.ta = function (a, b) {
        return 0 <= sa(a, b);
      };
      _.ua = function (a, b) {
        _.ta(a, b) || a.push(b);
      };
      _.va = function (a, b) {
        b = sa(a, b);
        var c;
        (c = 0 <= b) && Array.prototype.splice.call(a, b, 1);
        return c;
      };
      _.wa = function (a) {
        var b = a.length;
        if (0 < b) {
          for (var c = Array(b), d = 0; d < b; d++) c[d] = a[d];
          return c;
        }
        return [];
      };
      xa = function (a, b) {
        for (var c = 1; c < arguments.length; c++) {
          var d = arguments[c];
          if (_.da(d)) {
            var e = a.length || 0,
              f = d.length || 0;
            a.length = e + f;
            for (var g = 0; g < f; g++) a[e + g] = d[g];
          } else a.push(d);
        }
      };
      Aa = function (a, b) {
        b = b || a;
        for (var c = 0, d = 0, e = {}; d < a.length; ) {
          var f = a[d++],
            g = _.ya(f) ? "o" + _.za(f) : (typeof f).charAt(0) + f;
          Object.prototype.hasOwnProperty.call(e, g) || ((e[g] = !0), (b[c++] = f));
        }
        b.length = c;
      };
      _.Ba = function () {
        var a = _.q.navigator;
        return a && (a = a.userAgent) ? a : "";
      };
      _.u = function (a) {
        return -1 != _.Ba().indexOf(a);
      };
      _.Fa = function () {
        return _.Ca ? !!_.Da && 0 < _.Da.brands.length : !1;
      };
      _.Ga = function () {
        return _.Fa() ? !1 : _.u("Opera");
      };
      _.Ha = function () {
        return _.Fa() ? !1 : _.u("Trident") || _.u("MSIE");
      };
      _.Ia = function () {
        return _.Fa() ? !1 : _.u("Edge");
      };
      _.Ja = function () {
        return _.Ca ? !!_.Da && !!_.Da.platform : !1;
      };
      _.Ka = function () {
        return _.Ja() ? "Android" === _.Da.platform : _.u("Android");
      };
      _.La = function () {
        return _.u("iPhone") && !_.u("iPod") && !_.u("iPad");
      };
      _.Ma = function () {
        return _.La() || _.u("iPad") || _.u("iPod");
      };
      _.Na = function () {
        return _.Ja() ? "macOS" === _.Da.platform : _.u("Macintosh");
      };
      _.Oa = function () {
        return _.Ja() ? "Windows" === _.Da.platform : _.u("Windows");
      };
      Pa = function (a, b) {
        for (var c in a) if (b.call(void 0, a[c], c, a)) return !0;
        return !1;
      };
      _.Qa = function (a) {
        var b = [],
          c = 0,
          d;
        for (d in a) b[c++] = a[d];
        return b;
      };
      Sa = function (a, b) {
        for (var c, d, e = 1; e < arguments.length; e++) {
          d = arguments[e];
          for (c in d) a[c] = d[c];
          for (var f = 0; f < Ra.length; f++) (c = Ra[f]), Object.prototype.hasOwnProperty.call(d, c) && (a[c] = d[c]);
        }
      };
      Ta = function (a) {
        var b = arguments.length;
        if (1 == b && Array.isArray(arguments[0])) return Ta.apply(null, arguments[0]);
        for (var c = {}, d = 0; d < b; d++) c[arguments[d]] = !0;
        return c;
      };
      Ua = function () {};
      Va = function (a) {
        return { valueOf: a }.valueOf();
      };
      _.Xa = function (a, b) {
        a.src = _.Wa(b);
        var c, d;
        (c = (b =
          null == (d = (c = ((a.ownerDocument && a.ownerDocument.defaultView) || window).document).querySelector)
            ? void 0
            : d.call(c, "script[nonce]"))
          ? b.nonce || b.getAttribute("nonce") || ""
          : "") && a.setAttribute("nonce", c);
      };
      _.$a = function (a) {
        a = _.Ya(a);
        return _.Za(a);
      };
      _.Ya = function (a) {
        return null === a ? "null" : void 0 === a ? "undefined" : a;
      };
      ab = function (a) {
        var b = 0;
        return function () {
          return b < a.length ? { done: !1, value: a[b++] } : { done: !0 };
        };
      };
      bb =
        "function" == typeof Object.defineProperties
          ? Object.defineProperty
          : function (a, b, c) {
              if (a == Array.prototype || a == Object.prototype) return a;
              a[b] = c.value;
              return a;
            };
      cb = function (a) {
        a = [
          "object" == typeof globalThis && globalThis,
          a,
          "object" == typeof window && window,
          "object" == typeof self && self,
          "object" == typeof global && global,
        ];
        for (var b = 0; b < a.length; ++b) {
          var c = a[b];
          if (c && c.Math == Math) return c;
        }
        throw Error("a");
      };
      db = cb(this);
      eb = function (a, b) {
        if (b)
          a: {
            var c = db;
            a = a.split(".");
            for (var d = 0; d < a.length - 1; d++) {
              var e = a[d];
              if (!(e in c)) break a;
              c = c[e];
            }
            a = a[a.length - 1];
            d = c[a];
            b = b(d);
            b != d && null != b && bb(c, a, { configurable: !0, writable: !0, value: b });
          }
      };
      eb("Symbol", function (a) {
        if (a) return a;
        var b = function (f, g) {
          this.h = f;
          bb(this, "description", { configurable: !0, writable: !0, value: g });
        };
        b.prototype.toString = function () {
          return this.h;
        };
        var c = "jscomp_symbol_" + ((1e9 * Math.random()) >>> 0) + "_",
          d = 0,
          e = function (f) {
            if (this instanceof e) throw new TypeError("b");
            return new b(c + (f || "") + "_" + d++, f);
          };
        return e;
      });
      eb("Symbol.iterator", function (a) {
        if (a) return a;
        a = Symbol("c");
        for (
          var b =
              "Array Int8Array Uint8Array Uint8ClampedArray Int16Array Uint16Array Int32Array Uint32Array Float32Array Float64Array".split(
                " "
              ),
            c = 0;
          c < b.length;
          c++
        ) {
          var d = db[b[c]];
          "function" === typeof d &&
            "function" != typeof d.prototype[a] &&
            bb(d.prototype, a, {
              configurable: !0,
              writable: !0,
              value: function () {
                return fb(ab(this));
              },
            });
        }
        return a;
      });
      fb = function (a) {
        a = { next: a };
        a[Symbol.iterator] = function () {
          return this;
        };
        return a;
      };
      _.v = function (a) {
        var b = "undefined" != typeof Symbol && Symbol.iterator && a[Symbol.iterator];
        if (b) return b.call(a);
        if ("number" == typeof a.length) return { next: ab(a) };
        throw Error("d`" + String(a));
      };
      _.gb = function (a) {
        if (!(a instanceof Array)) {
          a = _.v(a);
          for (var b, c = []; !(b = a.next()).done; ) c.push(b.value);
          a = c;
        }
        return a;
      };
      hb =
        "function" == typeof Object.create
          ? Object.create
          : function (a) {
              var b = function () {};
              b.prototype = a;
              return new b();
            };
      if ("function" == typeof Object.setPrototypeOf) ib = Object.setPrototypeOf;
      else {
        var jb;
        a: {
          var kb = { a: !0 },
            lb = {};
          try {
            lb.__proto__ = kb;
            jb = lb.a;
            break a;
          } catch (a) {}
          jb = !1;
        }
        ib = jb
          ? function (a, b) {
              a.__proto__ = b;
              if (a.__proto__ !== b) throw new TypeError("e`" + a);
              return a;
            }
          : null;
      }
      mb = ib;
      _.w = function (a, b) {
        a.prototype = hb(b.prototype);
        a.prototype.constructor = a;
        if (mb) mb(a, b);
        else
          for (var c in b)
            if ("prototype" != c)
              if (Object.defineProperties) {
                var d = Object.getOwnPropertyDescriptor(b, c);
                d && Object.defineProperty(a, c, d);
              } else a[c] = b[c];
        a.R = b.prototype;
      };
      _.nb = function () {
        for (var a = Number(this), b = [], c = a; c < arguments.length; c++) b[c - a] = arguments[c];
        return b;
      };
      eb("Promise", function (a) {
        function b() {
          this.h = null;
        }
        function c(g) {
          return g instanceof e
            ? g
            : new e(function (h) {
                h(g);
              });
        }
        if (a) return a;
        b.prototype.j = function (g) {
          if (null == this.h) {
            this.h = [];
            var h = this;
            this.l(function () {
              h.s();
            });
          }
          this.h.push(g);
        };
        var d = db.setTimeout;
        b.prototype.l = function (g) {
          d(g, 0);
        };
        b.prototype.s = function () {
          for (; this.h && this.h.length; ) {
            var g = this.h;
            this.h = [];
            for (var h = 0; h < g.length; ++h) {
              var k = g[h];
              g[h] = null;
              try {
                k();
              } catch (m) {
                this.o(m);
              }
            }
          }
          this.h = null;
        };
        b.prototype.o = function (g) {
          this.l(function () {
            throw g;
          });
        };
        var e = function (g) {
          this.h = 0;
          this.l = void 0;
          this.j = [];
          this.B = !1;
          var h = this.o();
          try {
            g(h.resolve, h.reject);
          } catch (k) {
            h.reject(k);
          }
        };
        e.prototype.o = function () {
          function g(m) {
            return function (n) {
              k || ((k = !0), m.call(h, n));
            };
          }
          var h = this,
            k = !1;
          return { resolve: g(this.M), reject: g(this.s) };
        };
        e.prototype.M = function (g) {
          if (g === this) this.s(new TypeError("h"));
          else if (g instanceof e) this.O(g);
          else {
            a: switch (typeof g) {
              case "object":
                var h = null != g;
                break a;
              case "function":
                h = !0;
                break a;
              default:
                h = !1;
            }
            h ? this.I(g) : this.A(g);
          }
        };
        e.prototype.I = function (g) {
          var h = void 0;
          try {
            h = g.then;
          } catch (k) {
            this.s(k);
            return;
          }
          "function" == typeof h ? this.ha(h, g) : this.A(g);
        };
        e.prototype.s = function (g) {
          this.D(2, g);
        };
        e.prototype.A = function (g) {
          this.D(1, g);
        };
        e.prototype.D = function (g, h) {
          if (0 != this.h) throw Error("i`" + g + "`" + h + "`" + this.h);
          this.h = g;
          this.l = h;
          2 === this.h && this.H();
          this.G();
        };
        e.prototype.H = function () {
          var g = this;
          d(function () {
            if (g.F()) {
              var h = db.console;
              "undefined" !== typeof h && h.error(g.l);
            }
          }, 1);
        };
        e.prototype.F = function () {
          if (this.B) return !1;
          var g = db.CustomEvent,
            h = db.Event,
            k = db.dispatchEvent;
          if ("undefined" === typeof k) return !0;
          "function" === typeof g
            ? (g = new g("unhandledrejection", { cancelable: !0 }))
            : "function" === typeof h
            ? (g = new h("unhandledrejection", { cancelable: !0 }))
            : ((g = db.document.createEvent("CustomEvent")), g.initCustomEvent("unhandledrejection", !1, !0, g));
          g.promise = this;
          g.reason = this.l;
          return k(g);
        };
        e.prototype.G = function () {
          if (null != this.j) {
            for (var g = 0; g < this.j.length; ++g) f.j(this.j[g]);
            this.j = null;
          }
        };
        var f = new b();
        e.prototype.O = function (g) {
          var h = this.o();
          g.rd(h.resolve, h.reject);
        };
        e.prototype.ha = function (g, h) {
          var k = this.o();
          try {
            g.call(h, k.resolve, k.reject);
          } catch (m) {
            k.reject(m);
          }
        };
        e.prototype.then = function (g, h) {
          function k(t, r) {
            return "function" == typeof t
              ? function (x) {
                  try {
                    m(t(x));
                  } catch (K) {
                    n(K);
                  }
                }
              : r;
          }
          var m,
            n,
            p = new e(function (t, r) {
              m = t;
              n = r;
            });
          this.rd(k(g, m), k(h, n));
          return p;
        };
        e.prototype.catch = function (g) {
          return this.then(void 0, g);
        };
        e.prototype.rd = function (g, h) {
          function k() {
            switch (m.h) {
              case 1:
                g(m.l);
                break;
              case 2:
                h(m.l);
                break;
              default:
                throw Error("j`" + m.h);
            }
          }
          var m = this;
          null == this.j ? f.j(k) : this.j.push(k);
          this.B = !0;
        };
        e.resolve = c;
        e.reject = function (g) {
          return new e(function (h, k) {
            k(g);
          });
        };
        e.race = function (g) {
          return new e(function (h, k) {
            for (var m = _.v(g), n = m.next(); !n.done; n = m.next()) c(n.value).rd(h, k);
          });
        };
        e.all = function (g) {
          var h = _.v(g),
            k = h.next();
          return k.done
            ? c([])
            : new e(function (m, n) {
                function p(x) {
                  return function (K) {
                    t[x] = K;
                    r--;
                    0 == r && m(t);
                  };
                }
                var t = [],
                  r = 0;
                do t.push(void 0), r++, c(k.value).rd(p(t.length - 1), n), (k = h.next());
                while (!k.done);
              });
        };
        return e;
      });
      var ob = function (a, b, c) {
        if (null == a) throw new TypeError("k`" + c);
        if (b instanceof RegExp) throw new TypeError("l`" + c);
        return a + "";
      };
      eb("String.prototype.startsWith", function (a) {
        return a
          ? a
          : function (b, c) {
              var d = ob(this, b, "startsWith"),
                e = d.length,
                f = b.length;
              c = Math.max(0, Math.min(c | 0, d.length));
              for (var g = 0; g < f && c < e; ) if (d[c++] != b[g++]) return !1;
              return g >= f;
            };
      });
      var pb = function (a, b) {
        return Object.prototype.hasOwnProperty.call(a, b);
      };
      eb("WeakMap", function (a) {
        function b() {}
        function c(k) {
          var m = typeof k;
          return ("object" === m && null !== k) || "function" === m;
        }
        function d(k) {
          if (!pb(k, f)) {
            var m = new b();
            bb(k, f, { value: m });
          }
        }
        function e(k) {
          var m = Object[k];
          m &&
            (Object[k] = function (n) {
              if (n instanceof b) return n;
              Object.isExtensible(n) && d(n);
              return m(n);
            });
        }
        if (
          (function () {
            if (!a || !Object.seal) return !1;
            try {
              var k = Object.seal({}),
                m = Object.seal({}),
                n = new a([
                  [k, 2],
                  [m, 3],
                ]);
              if (2 != n.get(k) || 3 != n.get(m)) return !1;
              n.delete(k);
              n.set(m, 4);
              return !n.has(k) && 4 == n.get(m);
            } catch (p) {
              return !1;
            }
          })()
        )
          return a;
        var f = "$jscomp_hidden_" + Math.random();
        e("freeze");
        e("preventExtensions");
        e("seal");
        var g = 0,
          h = function (k) {
            this.h = (g += Math.random() + 1).toString();
            if (k) {
              k = _.v(k);
              for (var m; !(m = k.next()).done; ) (m = m.value), this.set(m[0], m[1]);
            }
          };
        h.prototype.set = function (k, m) {
          if (!c(k)) throw Error("m");
          d(k);
          if (!pb(k, f)) throw Error("n`" + k);
          k[f][this.h] = m;
          return this;
        };
        h.prototype.get = function (k) {
          return c(k) && pb(k, f) ? k[f][this.h] : void 0;
        };
        h.prototype.has = function (k) {
          return c(k) && pb(k, f) && pb(k[f], this.h);
        };
        h.prototype.delete = function (k) {
          return c(k) && pb(k, f) && pb(k[f], this.h) ? delete k[f][this.h] : !1;
        };
        return h;
      });
      eb("Map", function (a) {
        if (
          (function () {
            if (!a || "function" != typeof a || !a.prototype.entries || "function" != typeof Object.seal) return !1;
            try {
              var h = Object.seal({ x: 4 }),
                k = new a(_.v([[h, "s"]]));
              if ("s" != k.get(h) || 1 != k.size || k.get({ x: 4 }) || k.set({ x: 4 }, "t") != k || 2 != k.size)
                return !1;
              var m = k.entries(),
                n = m.next();
              if (n.done || n.value[0] != h || "s" != n.value[1]) return !1;
              n = m.next();
              return n.done || 4 != n.value[0].x || "t" != n.value[1] || !m.next().done ? !1 : !0;
            } catch (p) {
              return !1;
            }
          })()
        )
          return a;
        var b = new WeakMap(),
          c = function (h) {
            this.j = {};
            this.h = f();
            this.size = 0;
            if (h) {
              h = _.v(h);
              for (var k; !(k = h.next()).done; ) (k = k.value), this.set(k[0], k[1]);
            }
          };
        c.prototype.set = function (h, k) {
          h = 0 === h ? 0 : h;
          var m = d(this, h);
          m.list || (m.list = this.j[m.id] = []);
          m.La
            ? (m.La.value = k)
            : ((m.La = { next: this.h, Mb: this.h.Mb, head: this.h, key: h, value: k }),
              m.list.push(m.La),
              (this.h.Mb.next = m.La),
              (this.h.Mb = m.La),
              this.size++);
          return this;
        };
        c.prototype.delete = function (h) {
          h = d(this, h);
          return h.La && h.list
            ? (h.list.splice(h.index, 1),
              h.list.length || delete this.j[h.id],
              (h.La.Mb.next = h.La.next),
              (h.La.next.Mb = h.La.Mb),
              (h.La.head = null),
              this.size--,
              !0)
            : !1;
        };
        c.prototype.clear = function () {
          this.j = {};
          this.h = this.h.Mb = f();
          this.size = 0;
        };
        c.prototype.has = function (h) {
          return !!d(this, h).La;
        };
        c.prototype.get = function (h) {
          return (h = d(this, h).La) && h.value;
        };
        c.prototype.entries = function () {
          return e(this, function (h) {
            return [h.key, h.value];
          });
        };
        c.prototype.keys = function () {
          return e(this, function (h) {
            return h.key;
          });
        };
        c.prototype.values = function () {
          return e(this, function (h) {
            return h.value;
          });
        };
        c.prototype.forEach = function (h, k) {
          for (var m = this.entries(), n; !(n = m.next()).done; ) (n = n.value), h.call(k, n[1], n[0], this);
        };
        c.prototype[Symbol.iterator] = c.prototype.entries;
        var d = function (h, k) {
            var m = k && typeof k;
            "object" == m || "function" == m
              ? b.has(k)
                ? (m = b.get(k))
                : ((m = "" + ++g), b.set(k, m))
              : (m = "p_" + k);
            var n = h.j[m];
            if (n && pb(h.j, m))
              for (h = 0; h < n.length; h++) {
                var p = n[h];
                if ((k !== k && p.key !== p.key) || k === p.key) return { id: m, list: n, index: h, La: p };
              }
            return { id: m, list: n, index: -1, La: void 0 };
          },
          e = function (h, k) {
            var m = h.h;
            return fb(function () {
              if (m) {
                for (; m.head != h.h; ) m = m.Mb;
                for (; m.next != m.head; ) return (m = m.next), { done: !1, value: k(m) };
                m = null;
              }
              return { done: !0, value: void 0 };
            });
          },
          f = function () {
            var h = {};
            return (h.Mb = h.next = h.head = h);
          },
          g = 0;
        return c;
      });
      eb("Array.prototype.find", function (a) {
        return a
          ? a
          : function (b, c) {
              a: {
                var d = this;
                d instanceof String && (d = String(d));
                for (var e = d.length, f = 0; f < e; f++) {
                  var g = d[f];
                  if (b.call(c, g, f, d)) {
                    b = g;
                    break a;
                  }
                }
                b = void 0;
              }
              return b;
            };
      });
      eb("String.prototype.endsWith", function (a) {
        return a
          ? a
          : function (b, c) {
              var d = ob(this, b, "endsWith");
              void 0 === c && (c = d.length);
              c = Math.max(0, Math.min(c | 0, d.length));
              for (var e = b.length; 0 < e && 0 < c; ) if (d[--c] != b[--e]) return !1;
              return 0 >= e;
            };
      });
      var qb = function (a, b) {
        a instanceof String && (a += "");
        var c = 0,
          d = !1,
          e = {
            next: function () {
              if (!d && c < a.length) {
                var f = c++;
                return { value: b(f, a[f]), done: !1 };
              }
              d = !0;
              return { done: !0, value: void 0 };
            },
          };
        e[Symbol.iterator] = function () {
          return e;
        };
        return e;
      };
      eb("Array.prototype.entries", function (a) {
        return a
          ? a
          : function () {
              return qb(this, function (b, c) {
                return [b, c];
              });
            };
      });
      eb("Array.prototype.keys", function (a) {
        return a
          ? a
          : function () {
              return qb(this, function (b) {
                return b;
              });
            };
      });
      eb("Array.from", function (a) {
        return a
          ? a
          : function (b, c, d) {
              c =
                null != c
                  ? c
                  : function (h) {
                      return h;
                    };
              var e = [],
                f = "undefined" != typeof Symbol && Symbol.iterator && b[Symbol.iterator];
              if ("function" == typeof f) {
                b = f.call(b);
                for (var g = 0; !(f = b.next()).done; ) e.push(c.call(d, f.value, g++));
              } else for (f = b.length, g = 0; g < f; g++) e.push(c.call(d, b[g], g));
              return e;
            };
      });
      eb("Array.prototype.values", function (a) {
        return a
          ? a
          : function () {
              return qb(this, function (b, c) {
                return c;
              });
            };
      });
      eb("Set", function (a) {
        if (
          (function () {
            if (!a || "function" != typeof a || !a.prototype.entries || "function" != typeof Object.seal) return !1;
            try {
              var c = Object.seal({ x: 4 }),
                d = new a(_.v([c]));
              if (!d.has(c) || 1 != d.size || d.add(c) != d || 1 != d.size || d.add({ x: 4 }) != d || 2 != d.size)
                return !1;
              var e = d.entries(),
                f = e.next();
              if (f.done || f.value[0] != c || f.value[1] != c) return !1;
              f = e.next();
              return f.done || f.value[0] == c || 4 != f.value[0].x || f.value[1] != f.value[0] ? !1 : e.next().done;
            } catch (g) {
              return !1;
            }
          })()
        )
          return a;
        var b = function (c) {
          this.h = new Map();
          if (c) {
            c = _.v(c);
            for (var d; !(d = c.next()).done; ) this.add(d.value);
          }
          this.size = this.h.size;
        };
        b.prototype.add = function (c) {
          c = 0 === c ? 0 : c;
          this.h.set(c, c);
          this.size = this.h.size;
          return this;
        };
        b.prototype.delete = function (c) {
          c = this.h.delete(c);
          this.size = this.h.size;
          return c;
        };
        b.prototype.clear = function () {
          this.h.clear();
          this.size = 0;
        };
        b.prototype.has = function (c) {
          return this.h.has(c);
        };
        b.prototype.entries = function () {
          return this.h.entries();
        };
        b.prototype.values = function () {
          return this.h.values();
        };
        b.prototype.keys = b.prototype.values;
        b.prototype[Symbol.iterator] = b.prototype.values;
        b.prototype.forEach = function (c, d) {
          var e = this;
          this.h.forEach(function (f) {
            return c.call(d, f, f, e);
          });
        };
        return b;
      });
      var rb =
        "function" == typeof Object.assign
          ? Object.assign
          : function (a, b) {
              for (var c = 1; c < arguments.length; c++) {
                var d = arguments[c];
                if (d) for (var e in d) pb(d, e) && (a[e] = d[e]);
              }
              return a;
            };
      eb("Object.assign", function (a) {
        return a || rb;
      });
      eb("Object.entries", function (a) {
        return a
          ? a
          : function (b) {
              var c = [],
                d;
              for (d in b) pb(b, d) && c.push([d, b[d]]);
              return c;
            };
      });
      eb("String.prototype.replaceAll", function (a) {
        return a
          ? a
          : function (b, c) {
              if (b instanceof RegExp && !b.global) throw new TypeError("o");
              return b instanceof RegExp
                ? this.replace(b, c)
                : this.replace(
                    new RegExp(
                      String(b)
                        .replace(/([-()\[\]{}+?*.$\^|,:#<!\\])/g, "\\$1")
                        .replace(/\x08/g, "\\x08"),
                      "g"
                    ),
                    c
                  );
            };
      });
      eb("Object.is", function (a) {
        return a
          ? a
          : function (b, c) {
              return b === c ? 0 !== b || 1 / b === 1 / c : b !== b && c !== c;
            };
      });
      eb("Array.prototype.includes", function (a) {
        return a
          ? a
          : function (b, c) {
              var d = this;
              d instanceof String && (d = String(d));
              var e = d.length;
              c = c || 0;
              for (0 > c && (c = Math.max(c + e, 0)); c < e; c++) {
                var f = d[c];
                if (f === b || Object.is(f, b)) return !0;
              }
              return !1;
            };
      });
      eb("String.prototype.includes", function (a) {
        return a
          ? a
          : function (b, c) {
              return -1 !== ob(this, b, "includes").indexOf(b, c || 0);
            };
      });
      _._DumpException =
        window._DumpException ||
        function (a) {
          throw a;
        };
      window._DumpException = _._DumpException;
      var sb, ub, vb, xb, wb, zb, Ab, Bb, Cb, Gb;
      sb = sb || {};
      _.q = this || self;
      ub = function (a, b) {
        var c = _.tb("WIZ_global_data.oxN3nb");
        a = c && c[a];
        return null != a ? a : b;
      };
      vb = /^[a-zA-Z_$][a-zA-Z0-9._$]*$/;
      xb = function (a) {
        if ("string" !== typeof a || !a || -1 == a.search(vb)) throw Error("p");
        if (!wb || "goog" != wb.type) throw Error("q`" + a);
        if (wb.qj) throw Error("r");
        wb.qj = a;
      };
      xb.get = function () {
        return null;
      };
      wb = null;
      _.tb = function (a, b) {
        a = a.split(".");
        b = b || _.q;
        for (var c = 0; c < a.length; c++) if (((b = b[a[c]]), null == b)) return null;
        return b;
      };
      _.yb = function (a) {
        var b = typeof a;
        return "object" != b ? b : a ? (Array.isArray(a) ? "array" : b) : "null";
      };
      _.da = function (a) {
        var b = _.yb(a);
        return "array" == b || ("object" == b && "number" == typeof a.length);
      };
      _.ya = function (a) {
        var b = typeof a;
        return ("object" == b && null != a) || "function" == b;
      };
      _.za = function (a) {
        return (Object.prototype.hasOwnProperty.call(a, zb) && a[zb]) || (a[zb] = ++Ab);
      };
      zb = "closure_uid_" + ((1e9 * Math.random()) >>> 0);
      Ab = 0;
      Bb = function (a, b, c) {
        return a.call.apply(a.bind, arguments);
      };
      Cb = function (a, b, c) {
        if (!a) throw Error();
        if (2 < arguments.length) {
          var d = Array.prototype.slice.call(arguments, 2);
          return function () {
            var e = Array.prototype.slice.call(arguments);
            Array.prototype.unshift.apply(e, d);
            return a.apply(b, e);
          };
        }
        return function () {
          return a.apply(b, arguments);
        };
      };
      _.y = function (a, b, c) {
        _.y = Function.prototype.bind && -1 != Function.prototype.bind.toString().indexOf("native code") ? Bb : Cb;
        return _.y.apply(null, arguments);
      };
      _.Db = function (a, b) {
        var c = Array.prototype.slice.call(arguments, 1);
        return function () {
          var d = c.slice();
          d.push.apply(d, arguments);
          return a.apply(this, d);
        };
      };
      _.Eb = function () {
        return Date.now();
      };
      _.Fb = function (a, b) {
        a = a.split(".");
        var c = _.q;
        a[0] in c || "undefined" == typeof c.execScript || c.execScript("var " + a[0]);
        for (var d; a.length && (d = a.shift()); )
          a.length || void 0 === b ? (c[d] && c[d] !== Object.prototype[d] ? (c = c[d]) : (c = c[d] = {})) : (c[d] = b);
      };
      _.z = function (a, b) {
        function c() {}
        c.prototype = b.prototype;
        a.R = b.prototype;
        a.prototype = new c();
        a.prototype.constructor = a;
        a.il = function (d, e, f) {
          for (var g = Array(arguments.length - 2), h = 2; h < arguments.length; h++) g[h - 2] = arguments[h];
          return b.prototype[e].apply(d, g);
        };
      };
      Gb = function (a) {
        return a;
      };
      _.z(_.aa, Error);
      _.aa.prototype.name = "CustomError";
      var Hb;
      _.A = function () {
        this.Ca = this.Ca;
        this.ha = this.ha;
      };
      _.A.prototype.Ca = !1;
      _.A.prototype.Ya = function () {
        return this.Ca;
      };
      _.A.prototype.U = function () {
        this.Ca || ((this.Ca = !0), this.L());
      };
      _.A.prototype.L = function () {
        if (this.ha) for (; this.ha.length; ) this.ha.shift()();
      };
      var Jb;
      _.Ib = function () {};
      Jb = function (a) {
        return function () {
          throw Error(a);
        };
      };
      var Kb,
        Lb = function () {
          if (void 0 === Kb) {
            var a = null,
              b = _.q.trustedTypes;
            if (b && b.createPolicy) {
              try {
                a = b.createPolicy("goog#html", { createHTML: Gb, createScript: Gb, createScriptURL: Gb });
              } catch (c) {
                _.q.console && _.q.console.error(c.message);
              }
              Kb = a;
            } else Kb = a;
          }
          return Kb;
        };
      var Mb = {},
        Nb = function (a, b) {
          this.h = b === Mb ? a : "";
          this.lb = !0;
        };
      Nb.prototype.toString = function () {
        return this.h.toString();
      };
      Nb.prototype.Ra = function () {
        return this.h.toString();
      };
      _.Ob = function (a) {
        return a instanceof Nb && a.constructor === Nb ? a.h : "type_error:SafeScript";
      };
      _.Pb = function (a) {
        var b = Lb();
        a = b ? b.createScript(a) : a;
        return new Nb(a, Mb);
      };
      var Qb;
      _.Rb = function (a, b) {
        this.h = b === Qb ? a : "";
      };
      _.Rb.prototype.toString = function () {
        return this.h + "";
      };
      _.Rb.prototype.lb = !0;
      _.Rb.prototype.Ra = function () {
        return this.h.toString();
      };
      _.Wa = function (a) {
        return a instanceof _.Rb && a.constructor === _.Rb ? a.h : "type_error:TrustedResourceUrl";
      };
      _.Sb = RegExp("^((https:)?//[0-9a-z.:[\\]-]+/|/[^/\\\\]|[^:/\\\\%]+/|[^:/\\\\%]*[?#]|about:blank#)", "i");
      Qb = {};
      _.Za = function (a) {
        var b = Lb();
        a = b ? b.createScriptURL(a) : a;
        return new _.Rb(a, Qb);
      };
      xb = xb || {};
      var Tb = function () {
        _.A.call(this);
      };
      _.z(Tb, _.A);
      Tb.prototype.initialize = function () {};
      var Ub = function (a, b) {
        this.h = a;
        this.j = b;
      };
      Ub.prototype.l = function (a) {
        this.h && (this.h.call(this.j || null, a), (this.h = this.j = null));
      };
      Ub.prototype.abort = function () {
        this.j = this.h = null;
      };
      var Vb = function (a, b) {
        _.A.call(this);
        this.j = a;
        this.A = b;
        this.o = [];
        this.l = [];
        this.s = [];
      };
      _.z(Vb, _.A);
      Vb.prototype.B = Tb;
      Vb.prototype.h = null;
      Vb.prototype.jb = function () {
        return this.A;
      };
      var Wb = function (a, b) {
        a.l.push(new Ub(b));
      };
      Vb.prototype.onLoad = function (a) {
        var b = new this.B();
        b.initialize(a());
        this.h = b;
        b = (b = !!Xb(this.s, a())) || !!Xb(this.o, a());
        b || (this.l.length = 0);
        return b;
      };
      Vb.prototype.bf = function (a) {
        (a = Xb(this.l, a)) && _.q.setTimeout(Jb("Module errback failures: " + a), 0);
        this.s.length = 0;
        this.o.length = 0;
      };
      var Xb = function (a, b) {
        for (var c = [], d = 0; d < a.length; d++)
          try {
            a[d].l(b);
          } catch (e) {
            ba(e), c.push(e);
          }
        a.length = 0;
        return c.length ? c : null;
      };
      Vb.prototype.L = function () {
        Vb.R.L.call(this);
        _.ca(this.h);
      };
      var Yb = function () {
        this.D = this.Ca = null;
      };
      _.l = Yb.prototype;
      _.l.Zg = function () {};
      _.l.nf = function () {};
      _.l.Wg = function () {
        throw Error("v");
      };
      _.l.ig = function () {
        return this.Ca;
      };
      _.l.pf = function (a) {
        this.Ca = a;
      };
      _.l.isActive = function () {
        return !1;
      };
      _.l.Cg = function () {
        return !1;
      };
      var ka;
      _.fa = null;
      _.ha = null;
      ka = [];
      var B = function (a, b) {
        this.j = a;
        this.h = b || null;
      };
      B.prototype.toString = function () {
        return this.j;
      };
      new B("ZtVrH");
      new B("rJmJrc", "rJmJrc");
      new B("fJuxOc");
      new B("NGntwf");
      new B("ofuapc");
      new B("BWETze");
      new B("ZmXAm");
      var Zb = new B("n73qwf", "n73qwf");
      var qa = Symbol("x");
      var sa, bc;
      sa = Array.prototype.indexOf
        ? function (a, b) {
            return Array.prototype.indexOf.call(a, b, void 0);
          }
        : function (a, b) {
            if ("string" === typeof a) return "string" !== typeof b || 1 != b.length ? -1 : a.indexOf(b, 0);
            for (var c = 0; c < a.length; c++) if (c in a && a[c] === b) return c;
            return -1;
          };
      _.$b = Array.prototype.forEach
        ? function (a, b) {
            Array.prototype.forEach.call(a, b, void 0);
          }
        : function (a, b) {
            for (var c = a.length, d = "string" === typeof a ? a.split("") : a, e = 0; e < c; e++)
              e in d && b.call(void 0, d[e], e, a);
          };
      _.ac = Array.prototype.map
        ? function (a, b) {
            return Array.prototype.map.call(a, b, void 0);
          }
        : function (a, b) {
            for (var c = a.length, d = Array(c), e = "string" === typeof a ? a.split("") : a, f = 0; f < c; f++)
              f in e && (d[f] = b.call(void 0, e[f], f, a));
            return d;
          };
      bc = Array.prototype.reduce
        ? function (a, b, c) {
            Array.prototype.reduce.call(a, b, c);
          }
        : function (a, b, c) {
            var d = c;
            (0, _.$b)(a, function (e, f) {
              d = b.call(void 0, d, e, f, a);
            });
          };
      _.cc = Array.prototype.some
        ? function (a, b) {
            return Array.prototype.some.call(a, b, void 0);
          }
        : function (a, b) {
            for (var c = a.length, d = "string" === typeof a ? a.split("") : a, e = 0; e < c; e++)
              if (e in d && b.call(void 0, d[e], e, a)) return !0;
            return !1;
          };
      _.Ca = ub(610401301, !1);
      _.dc = ub(516931134, ub(1, !0));
      _.ec = String.prototype.trim
        ? function (a) {
            return a.trim();
          }
        : function (a) {
            return /^[\s\xa0]*([\s\S]*?)[\s\xa0]*$/.exec(a)[1];
          };
      var fc;
      fc = _.q.navigator;
      _.Da = fc ? fc.userAgentData || null : null;
      var gc = function (a) {
        gc[" "](a);
        return a;
      };
      gc[" "] = function () {};
      _.hc = function (a, b) {
        try {
          return gc(a[b]), !0;
        } catch (c) {}
        return !1;
      };
      var vc, wc, Bc;
      _.ic = _.Ga();
      _.C = _.Ha();
      _.jc = _.u("Edge");
      _.kc = _.jc || _.C;
      _.lc =
        _.u("Gecko") &&
        !(-1 != _.Ba().toLowerCase().indexOf("webkit") && !_.u("Edge")) &&
        !(_.u("Trident") || _.u("MSIE")) &&
        !_.u("Edge");
      _.mc = -1 != _.Ba().toLowerCase().indexOf("webkit") && !_.u("Edge");
      _.nc = _.mc && _.u("Mobile");
      _.oc = _.Na();
      _.pc = _.Oa();
      _.qc = _.Ka();
      _.rc = _.La();
      _.sc = _.u("iPad");
      _.tc = _.u("iPod");
      _.uc = _.Ma();
      vc = function () {
        var a = _.q.document;
        return a ? a.documentMode : void 0;
      };
      a: {
        var xc = "",
          yc = (function () {
            var a = _.Ba();
            if (_.lc) return /rv:([^\);]+)(\)|;)/.exec(a);
            if (_.jc) return /Edge\/([\d\.]+)/.exec(a);
            if (_.C) return /\b(?:MSIE|rv)[: ]([^\);]+)(\)|;)/.exec(a);
            if (_.mc) return /WebKit\/(\S+)/.exec(a);
            if (_.ic) return /(?:Version)[ \/]?(\S+)/.exec(a);
          })();
        yc && (xc = yc ? yc[1] : "");
        if (_.C) {
          var zc = vc();
          if (null != zc && zc > parseFloat(xc)) {
            wc = String(zc);
            break a;
          }
        }
        wc = xc;
      }
      _.Ac = wc;
      if (_.q.document && _.C) {
        var Cc = vc();
        Bc = Cc ? Cc : parseInt(_.Ac, 10) || void 0;
      } else Bc = void 0;
      _.Dc = Bc;
      _.Ec = _.C || _.mc;
      var Ra;
      Ra = "constructor hasOwnProperty isPrototypeOf propertyIsEnumerable toLocaleString toString valueOf".split(" ");
      _.Fc = function (a, b, c) {
        for (var d in a) b.call(c, a[d], d, a);
      };
      var Gc;
      _.Hc = function (a, b) {
        this.h = b === Gc ? a : "";
      };
      _.Hc.prototype.toString = function () {
        return this.h.toString();
      };
      _.Hc.prototype.lb = !0;
      _.Hc.prototype.Ra = function () {
        return this.h.toString();
      };
      var Ic;
      try {
        new URL("s://g"), (Ic = !0);
      } catch (a) {
        Ic = !1;
      }
      _.Jc = Ic;
      Gc = {};
      _.Kc = function (a) {
        return new _.Hc(a, Gc);
      };
      _.Lc = _.Kc("about:invalid#zClosurez");
      _.Mc = {};
      _.Nc = function (a, b) {
        this.h = b === _.Mc ? a : "";
        this.lb = !0;
      };
      _.Nc.prototype.Ra = function () {
        return this.h;
      };
      _.Nc.prototype.toString = function () {
        return this.h.toString();
      };
      _.Oc = new _.Nc("", _.Mc);
      _.Pc = RegExp("^[-+,.\"'%_!#/ a-zA-Z0-9\\[\\]]+$");
      _.Qc = RegExp("\\b(url\\([ \t\n]*)('[ -&(-\\[\\]-~]*'|\"[ !#-\\[\\]-~]*\"|[!#-&*-\\[\\]-~]*)([ \t\n]*\\))", "g");
      _.Rc = RegExp(
        "\\b(calc|cubic-bezier|fit-content|hsl|hsla|linear-gradient|matrix|minmax|radial-gradient|repeat|rgb|rgba|(rotate|scale|translate)(X|Y|Z|3d)?|steps|var)\\([-+*/0-9a-zA-Z.%#\\[\\], ]+\\)",
        "g"
      );
      var Sc;
      Sc = {};
      _.Tc = function (a, b) {
        this.h = b === Sc ? a : "";
        this.lb = !0;
      };
      _.Tc.prototype.Ra = function () {
        return this.h.toString();
      };
      _.Tc.prototype.toString = function () {
        return this.h.toString();
      };
      _.Uc = function (a) {
        return a instanceof _.Tc && a.constructor === _.Tc ? a.h : "type_error:SafeHtml";
      };
      _.Vc = function (a) {
        var b = Lb();
        a = b ? b.createHTML(a) : a;
        return new _.Tc(a, Sc);
      };
      _.Wc = _.Vc("<!DOCTYPE html>");
      _.Xc = new _.Tc((_.q.trustedTypes && _.q.trustedTypes.emptyHTML) || "", Sc);
      _.Yc = (function (a) {
        var b = !1,
          c;
        return function () {
          b || ((c = a()), (b = !0));
          return c;
        };
      })(function () {
        var a = document.createElement("div"),
          b = document.createElement("div");
        b.appendChild(document.createElement("div"));
        a.appendChild(b);
        b = a.firstChild.firstChild;
        a.innerHTML = _.Uc(_.Xc);
        return !b.parentElement;
      });
      _.Zc = function (a, b) {
        this.width = a;
        this.height = b;
      };
      _.$c = function (a, b) {
        return a == b ? !0 : a && b ? a.width == b.width && a.height == b.height : !1;
      };
      _.Zc.prototype.aspectRatio = function () {
        return this.width / this.height;
      };
      _.Zc.prototype.ceil = function () {
        this.width = Math.ceil(this.width);
        this.height = Math.ceil(this.height);
        return this;
      };
      _.Zc.prototype.floor = function () {
        this.width = Math.floor(this.width);
        this.height = Math.floor(this.height);
        return this;
      };
      _.Zc.prototype.round = function () {
        this.width = Math.round(this.width);
        this.height = Math.round(this.height);
        return this;
      };
      _.ad = function (a) {
        return encodeURIComponent(String(a));
      };
      _.bd = function (a) {
        return decodeURIComponent(a.replace(/\+/g, " "));
      };
      _.cd = function () {
        return (
          Math.floor(2147483648 * Math.random()).toString(36) +
          Math.abs(Math.floor(2147483648 * Math.random()) ^ _.Eb()).toString(36)
        );
      };
      var id, hd;
      _.fd = function (a) {
        return a ? new _.dd(_.ed(a)) : Hb || (Hb = new _.dd());
      };
      _.gd = function (a, b) {
        return "string" === typeof b ? a.getElementById(b) : b;
      };
      id = function (a, b) {
        _.Fc(b, function (c, d) {
          c && "object" == typeof c && c.lb && (c = c.Ra());
          "style" == d
            ? (a.style.cssText = c)
            : "class" == d
            ? (a.className = c)
            : "for" == d
            ? (a.htmlFor = c)
            : hd.hasOwnProperty(d)
            ? a.setAttribute(hd[d], c)
            : 0 == d.lastIndexOf("aria-", 0) || 0 == d.lastIndexOf("data-", 0)
            ? a.setAttribute(d, c)
            : (a[d] = c);
        });
      };
      hd = {
        cellpadding: "cellPadding",
        cellspacing: "cellSpacing",
        colspan: "colSpan",
        frameborder: "frameBorder",
        height: "height",
        maxlength: "maxLength",
        nonce: "nonce",
        role: "role",
        rowspan: "rowSpan",
        type: "type",
        usemap: "useMap",
        valign: "vAlign",
        width: "width",
      };
      _.kd = function (a) {
        a = a.document;
        a = _.jd(a) ? a.documentElement : a.body;
        return new _.Zc(a.clientWidth, a.clientHeight);
      };
      _.ld = function (a) {
        return a ? a.parentWindow || a.defaultView : window;
      };
      _.od = function (a, b) {
        var c = b[1],
          d = _.md(a, String(b[0]));
        c && ("string" === typeof c ? (d.className = c) : Array.isArray(c) ? (d.className = c.join(" ")) : id(d, c));
        2 < b.length && _.nd(a, d, b, 2);
        return d;
      };
      _.nd = function (a, b, c, d) {
        function e(h) {
          h && b.appendChild("string" === typeof h ? a.createTextNode(h) : h);
        }
        for (; d < c.length; d++) {
          var f = c[d];
          if (!_.da(f) || (_.ya(f) && 0 < f.nodeType)) e(f);
          else {
            a: {
              if (f && "number" == typeof f.length) {
                if (_.ya(f)) {
                  var g = "function" == typeof f.item || "string" == typeof f.item;
                  break a;
                }
                if ("function" === typeof f) {
                  g = "function" == typeof f.item;
                  break a;
                }
              }
              g = !1;
            }
            _.$b(g ? _.wa(f) : f, e);
          }
        }
      };
      _.md = function (a, b) {
        b = String(b);
        "application/xhtml+xml" === a.contentType && (b = b.toLowerCase());
        return a.createElement(b);
      };
      _.jd = function (a) {
        return "CSS1Compat" == a.compatMode;
      };
      _.pd = function (a) {
        for (var b; (b = a.firstChild); ) a.removeChild(b);
      };
      _.qd = function (a, b) {
        if (!a || !b) return !1;
        if (a.contains && 1 == b.nodeType) return a == b || a.contains(b);
        if ("undefined" != typeof a.compareDocumentPosition) return a == b || !!(a.compareDocumentPosition(b) & 16);
        for (; b && a != b; ) b = b.parentNode;
        return b == a;
      };
      _.ed = function (a) {
        return 9 == a.nodeType ? a : a.ownerDocument || a.document;
      };
      _.rd = function (a, b) {
        if ("textContent" in a) a.textContent = b;
        else if (3 == a.nodeType) a.data = String(b);
        else if (a.firstChild && 3 == a.firstChild.nodeType) {
          for (; a.lastChild != a.firstChild; ) a.removeChild(a.lastChild);
          a.firstChild.data = String(b);
        } else _.pd(a), a.appendChild(_.ed(a).createTextNode(String(b)));
      };
      _.dd = function (a) {
        this.h = a || _.q.document || document;
      };
      _.dd.prototype.C = function (a) {
        return _.gd(this.h, a);
      };
      _.dd.prototype.S = function (a, b, c) {
        return _.od(this.h, arguments);
      };
      _.sd = function (a) {
        a = a.h;
        return a.parentWindow || a.defaultView;
      };
      _.dd.prototype.appendChild = function (a, b) {
        a.appendChild(b);
      };
      _.dd.prototype.ef = _.pd;
      _.dd.prototype.j = _.qd;
      _.dd.prototype.Ic = _.rd;
      var td = function () {
        this.id = "b";
      };
      td.prototype.toString = function () {
        return this.id;
      };
      _.ud = function (a, b) {
        this.type = a instanceof td ? String(a) : a;
        this.currentTarget = this.target = b;
        this.defaultPrevented = this.j = !1;
      };
      _.ud.prototype.stopPropagation = function () {
        this.j = !0;
      };
      _.ud.prototype.preventDefault = function () {
        this.defaultPrevented = !0;
      };
      var vd = (function () {
        if (!_.q.addEventListener || !Object.defineProperty) return !1;
        var a = !1,
          b = Object.defineProperty({}, "passive", {
            get: function () {
              a = !0;
            },
          });
        try {
          _.q.addEventListener("test", function () {}, b), _.q.removeEventListener("test", function () {}, b);
        } catch (c) {}
        return a;
      })();
      _.xd = function (a, b) {
        _.ud.call(this, a ? a.type : "");
        this.relatedTarget = this.currentTarget = this.target = null;
        this.button = this.screenY = this.screenX = this.clientY = this.clientX = this.offsetY = this.offsetX = 0;
        this.key = "";
        this.charCode = this.keyCode = 0;
        this.metaKey = this.shiftKey = this.altKey = this.ctrlKey = !1;
        this.state = null;
        this.l = !1;
        this.pointerId = 0;
        this.pointerType = "";
        this.h = null;
        if (a) {
          var c = (this.type = a.type),
            d = a.changedTouches && a.changedTouches.length ? a.changedTouches[0] : null;
          this.target = a.target || a.srcElement;
          this.currentTarget = b;
          (b = a.relatedTarget)
            ? _.lc && (_.hc(b, "nodeName") || (b = null))
            : "mouseover" == c
            ? (b = a.fromElement)
            : "mouseout" == c && (b = a.toElement);
          this.relatedTarget = b;
          d
            ? ((this.clientX = void 0 !== d.clientX ? d.clientX : d.pageX),
              (this.clientY = void 0 !== d.clientY ? d.clientY : d.pageY),
              (this.screenX = d.screenX || 0),
              (this.screenY = d.screenY || 0))
            : ((this.offsetX = _.mc || void 0 !== a.offsetX ? a.offsetX : a.layerX),
              (this.offsetY = _.mc || void 0 !== a.offsetY ? a.offsetY : a.layerY),
              (this.clientX = void 0 !== a.clientX ? a.clientX : a.pageX),
              (this.clientY = void 0 !== a.clientY ? a.clientY : a.pageY),
              (this.screenX = a.screenX || 0),
              (this.screenY = a.screenY || 0));
          this.button = a.button;
          this.keyCode = a.keyCode || 0;
          this.key = a.key || "";
          this.charCode = a.charCode || ("keypress" == c ? a.keyCode : 0);
          this.ctrlKey = a.ctrlKey;
          this.altKey = a.altKey;
          this.shiftKey = a.shiftKey;
          this.metaKey = a.metaKey;
          this.l = _.oc ? a.metaKey : a.ctrlKey;
          this.pointerId = a.pointerId || 0;
          this.pointerType = "string" === typeof a.pointerType ? a.pointerType : wd[a.pointerType] || "";
          this.state = a.state;
          this.h = a;
          a.defaultPrevented && _.xd.R.preventDefault.call(this);
        }
      };
      _.z(_.xd, _.ud);
      var wd = { 2: "touch", 3: "pen", 4: "mouse" };
      _.xd.prototype.stopPropagation = function () {
        _.xd.R.stopPropagation.call(this);
        this.h.stopPropagation ? this.h.stopPropagation() : (this.h.cancelBubble = !0);
      };
      _.xd.prototype.preventDefault = function () {
        _.xd.R.preventDefault.call(this);
        var a = this.h;
        a.preventDefault ? a.preventDefault() : (a.returnValue = !1);
      };
      var yd;
      yd = "closure_listenable_" + ((1e6 * Math.random()) | 0);
      _.zd = function (a) {
        return !(!a || !a[yd]);
      };
      var Ad = 0;
      var Bd = function (a, b, c, d, e) {
          this.listener = a;
          this.proxy = null;
          this.src = b;
          this.type = c;
          this.capture = !!d;
          this.Id = e;
          this.key = ++Ad;
          this.cd = this.qd = !1;
        },
        Cd = function (a) {
          a.cd = !0;
          a.listener = null;
          a.proxy = null;
          a.src = null;
          a.Id = null;
        };
      var Dd = function (a) {
          this.src = a;
          this.h = {};
          this.j = 0;
        },
        Fd;
      Dd.prototype.add = function (a, b, c, d, e) {
        var f = a.toString();
        a = this.h[f];
        a || ((a = this.h[f] = []), this.j++);
        var g = Ed(a, b, d, e);
        -1 < g ? ((b = a[g]), c || (b.qd = !1)) : ((b = new Bd(b, this.src, f, !!d, e)), (b.qd = c), a.push(b));
        return b;
      };
      Dd.prototype.remove = function (a, b, c, d) {
        a = a.toString();
        if (!(a in this.h)) return !1;
        var e = this.h[a];
        b = Ed(e, b, c, d);
        return -1 < b
          ? (Cd(e[b]), Array.prototype.splice.call(e, b, 1), 0 == e.length && (delete this.h[a], this.j--), !0)
          : !1;
      };
      Fd = function (a, b) {
        var c = b.type;
        if (!(c in a.h)) return !1;
        var d = _.va(a.h[c], b);
        d && (Cd(b), 0 == a.h[c].length && (delete a.h[c], a.j--));
        return d;
      };
      _.Hd = function (a) {
        var b = 0,
          c;
        for (c in a.h) {
          for (var d = a.h[c], e = 0; e < d.length; e++) ++b, Cd(d[e]);
          delete a.h[c];
          a.j--;
        }
      };
      Dd.prototype.Xc = function (a, b, c, d) {
        a = this.h[a.toString()];
        var e = -1;
        a && (e = Ed(a, b, c, d));
        return -1 < e ? a[e] : null;
      };
      Dd.prototype.hasListener = function (a, b) {
        var c = void 0 !== a,
          d = c ? a.toString() : "",
          e = void 0 !== b;
        return Pa(this.h, function (f) {
          for (var g = 0; g < f.length; ++g) if (!((c && f[g].type != d) || (e && f[g].capture != b))) return !0;
          return !1;
        });
      };
      var Ed = function (a, b, c, d) {
        for (var e = 0; e < a.length; ++e) {
          var f = a[e];
          if (!f.cd && f.listener == b && f.capture == !!c && f.Id == d) return e;
        }
        return -1;
      };
      var Id, Jd, Kd, Nd, Pd, Qd, Rd, Ud, Md;
      Id = "closure_lm_" + ((1e6 * Math.random()) | 0);
      Jd = {};
      Kd = 0;
      _.D = function (a, b, c, d, e) {
        if (d && d.once) return _.Ld(a, b, c, d, e);
        if (Array.isArray(b)) {
          for (var f = 0; f < b.length; f++) _.D(a, b[f], c, d, e);
          return null;
        }
        c = Md(c);
        return _.zd(a) ? a.J(b, c, _.ya(d) ? !!d.capture : !!d, e) : Nd(a, b, c, !1, d, e);
      };
      Nd = function (a, b, c, d, e, f) {
        if (!b) throw Error("C");
        var g = _.ya(e) ? !!e.capture : !!e,
          h = _.Od(a);
        h || (a[Id] = h = new Dd(a));
        c = h.add(b, c, d, g, f);
        if (c.proxy) return c;
        d = Pd();
        c.proxy = d;
        d.src = a;
        d.listener = c;
        if (a.addEventListener) vd || (e = g), void 0 === e && (e = !1), a.addEventListener(b.toString(), d, e);
        else if (a.attachEvent) a.attachEvent(Qd(b.toString()), d);
        else if (a.addListener && a.removeListener) a.addListener(d);
        else throw Error("D");
        Kd++;
        return c;
      };
      Pd = function () {
        var a = Rd,
          b = function (c) {
            return a.call(b.src, b.listener, c);
          };
        return b;
      };
      _.Ld = function (a, b, c, d, e) {
        if (Array.isArray(b)) {
          for (var f = 0; f < b.length; f++) _.Ld(a, b[f], c, d, e);
          return null;
        }
        c = Md(c);
        return _.zd(a) ? a.Sb(b, c, _.ya(d) ? !!d.capture : !!d, e) : Nd(a, b, c, !0, d, e);
      };
      _.Sd = function (a, b, c, d, e) {
        if (Array.isArray(b)) for (var f = 0; f < b.length; f++) _.Sd(a, b[f], c, d, e);
        else
          (d = _.ya(d) ? !!d.capture : !!d),
            (c = Md(c)),
            _.zd(a) ? a.ob(b, c, d, e) : a && (a = _.Od(a)) && (b = a.Xc(b, c, d, e)) && _.Td(b);
      };
      _.Td = function (a) {
        if ("number" === typeof a || !a || a.cd) return !1;
        var b = a.src;
        if (_.zd(b)) return Fd(b.Za, a);
        var c = a.type,
          d = a.proxy;
        b.removeEventListener
          ? b.removeEventListener(c, d, a.capture)
          : b.detachEvent
          ? b.detachEvent(Qd(c), d)
          : b.addListener && b.removeListener && b.removeListener(d);
        Kd--;
        (c = _.Od(b)) ? (Fd(c, a), 0 == c.j && ((c.src = null), (b[Id] = null))) : Cd(a);
        return !0;
      };
      Qd = function (a) {
        return a in Jd ? Jd[a] : (Jd[a] = "on" + a);
      };
      Rd = function (a, b) {
        if (a.cd) a = !0;
        else {
          b = new _.xd(b, this);
          var c = a.listener,
            d = a.Id || a.src;
          a.qd && _.Td(a);
          a = c.call(d, b);
        }
        return a;
      };
      _.Od = function (a) {
        a = a[Id];
        return a instanceof Dd ? a : null;
      };
      Ud = "__closure_events_fn_" + ((1e9 * Math.random()) >>> 0);
      Md = function (a) {
        if ("function" === typeof a) return a;
        a[Ud] ||
          (a[Ud] = function (b) {
            return a.handleEvent(b);
          });
        return a[Ud];
      };
      _.E = function () {
        _.A.call(this);
        this.Za = new Dd(this);
        this.Oh = this;
        this.Wd = null;
      };
      _.z(_.E, _.A);
      _.E.prototype[yd] = !0;
      _.l = _.E.prototype;
      _.l.Zd = function (a) {
        this.Wd = a;
      };
      _.l.addEventListener = function (a, b, c, d) {
        _.D(this, a, b, c, d);
      };
      _.l.removeEventListener = function (a, b, c, d) {
        _.Sd(this, a, b, c, d);
      };
      _.l.dispatchEvent = function (a) {
        var b,
          c = this.Wd;
        if (c) for (b = []; c; c = c.Wd) b.push(c);
        c = this.Oh;
        var d = a.type || a;
        if ("string" === typeof a) a = new _.ud(a, c);
        else if (a instanceof _.ud) a.target = a.target || c;
        else {
          var e = a;
          a = new _.ud(d, c);
          Sa(a, e);
        }
        e = !0;
        if (b)
          for (var f = b.length - 1; !a.j && 0 <= f; f--) {
            var g = (a.currentTarget = b[f]);
            e = Vd(g, d, !0, a) && e;
          }
        a.j || ((g = a.currentTarget = c), (e = Vd(g, d, !0, a) && e), a.j || (e = Vd(g, d, !1, a) && e));
        if (b) for (f = 0; !a.j && f < b.length; f++) (g = a.currentTarget = b[f]), (e = Vd(g, d, !1, a) && e);
        return e;
      };
      _.l.L = function () {
        _.E.R.L.call(this);
        this.Za && _.Hd(this.Za);
        this.Wd = null;
      };
      _.l.J = function (a, b, c, d) {
        return this.Za.add(String(a), b, !1, c, d);
      };
      _.l.Sb = function (a, b, c, d) {
        return this.Za.add(String(a), b, !0, c, d);
      };
      _.l.ob = function (a, b, c, d) {
        return this.Za.remove(String(a), b, c, d);
      };
      var Vd = function (a, b, c, d) {
        b = a.Za.h[String(b)];
        if (!b) return !0;
        b = b.concat();
        for (var e = !0, f = 0; f < b.length; ++f) {
          var g = b[f];
          if (g && !g.cd && g.capture == c) {
            var h = g.listener,
              k = g.Id || g.src;
            g.qd && Fd(a.Za, g);
            e = !1 !== h.call(k, d) && e;
          }
        }
        return e && !d.defaultPrevented;
      };
      _.E.prototype.Xc = function (a, b, c, d) {
        return this.Za.Xc(String(a), b, c, d);
      };
      _.E.prototype.hasListener = function (a, b) {
        return this.Za.hasListener(void 0 !== a ? String(a) : void 0, b);
      };
      var Wd = function (a) {
        _.E.call(this);
        this.h = a || window;
        this.j = _.D(this.h, "resize", this.o, !1, this);
        this.l = _.kd(this.h || window);
      };
      _.z(Wd, _.E);
      Wd.prototype.L = function () {
        Wd.R.L.call(this);
        this.j && (_.Td(this.j), (this.j = null));
        this.l = this.h = null;
      };
      Wd.prototype.o = function () {
        var a = _.kd(this.h || window);
        _.$c(a, this.l) || ((this.l = a), this.dispatchEvent("resize"));
      };
      var Xd = function (a) {
        _.E.call(this);
        this.l = a ? _.sd(a) : window;
        this.s = 1.5 <= this.l.devicePixelRatio ? 2 : 1;
        this.j = (0, _.y)(this.A, this);
        this.o = null;
        (this.h = this.l.matchMedia
          ? this.l.matchMedia("(min-resolution: 1.5dppx), (-webkit-min-device-pixel-ratio: 1.5)")
          : null) &&
          "function" !== typeof this.h.addListener &&
          "function" !== typeof this.h.addEventListener &&
          (this.h = null);
      };
      _.z(Xd, _.E);
      Xd.prototype.start = function () {
        var a = this;
        this.h &&
          ("function" === typeof this.h.addEventListener
            ? (this.h.addEventListener("change", this.j),
              (this.o = function () {
                a.h.removeEventListener("change", a.j);
              }))
            : (this.h.addListener(this.j),
              (this.o = function () {
                a.h.removeListener(a.j);
              })));
      };
      Xd.prototype.A = function () {
        var a = 1.5 <= this.l.devicePixelRatio ? 2 : 1;
        this.s != a && ((this.s = a), this.dispatchEvent("a"));
      };
      Xd.prototype.L = function () {
        this.o && this.o();
        Xd.R.L.call(this);
      };
      var Yd = function (a, b) {
        _.A.call(this);
        this.s = a;
        if (b) {
          if (this.o) throw Error("E");
          this.o = b;
          this.j = _.fd(b);
          this.h = new Wd(_.ld(b));
          this.h.Zd(this.s.j());
          this.l = new Xd(this.j);
          this.l.start();
        }
      };
      _.z(Yd, _.A);
      Yd.prototype.L = function () {
        this.j = this.o = null;
        this.h && (this.h.U(), (this.h = null));
        _.ca(this.l);
        this.l = null;
      };
      ra(Zb, Yd);
      var Zd = function (a, b) {
        this.o = a;
        this.l = b;
        this.j = 0;
        this.h = null;
      };
      Zd.prototype.get = function () {
        if (0 < this.j) {
          this.j--;
          var a = this.h;
          this.h = a.next;
          a.next = null;
        } else a = this.o();
        return a;
      };
      var $d = function (a, b) {
        a.l(b);
        100 > a.j && (a.j++, (b.next = a.h), (a.h = b));
      };
      var ae,
        be = function () {
          var a = _.q.MessageChannel;
          "undefined" === typeof a &&
            "undefined" !== typeof window &&
            window.postMessage &&
            window.addEventListener &&
            !_.u("Presto") &&
            (a = function () {
              var e = _.md(document, "IFRAME");
              e.style.display = "none";
              document.documentElement.appendChild(e);
              var f = e.contentWindow;
              e = f.document;
              e.open();
              e.close();
              var g = "callImmediate" + Math.random(),
                h = "file:" == f.location.protocol ? "*" : f.location.protocol + "//" + f.location.host;
              e = (0, _.y)(function (k) {
                if (("*" == h || k.origin == h) && k.data == g) this.port1.onmessage();
              }, this);
              f.addEventListener("message", e, !1);
              this.port1 = {};
              this.port2 = {
                postMessage: function () {
                  f.postMessage(g, h);
                },
              };
            });
          if ("undefined" !== typeof a && !_.Ha()) {
            var b = new a(),
              c = {},
              d = c;
            b.port1.onmessage = function () {
              if (void 0 !== c.next) {
                c = c.next;
                var e = c.Wf;
                c.Wf = null;
                e();
              }
            };
            return function (e) {
              d.next = { Wf: e };
              d = d.next;
              b.port2.postMessage(0);
            };
          }
          return function (e) {
            _.q.setTimeout(e, 0);
          };
        };
      var ce = function () {
        this.j = this.h = null;
      };
      ce.prototype.add = function (a, b) {
        var c = de.get();
        c.set(a, b);
        this.j ? (this.j.next = c) : (this.h = c);
        this.j = c;
      };
      ce.prototype.remove = function () {
        var a = null;
        this.h && ((a = this.h), (this.h = this.h.next), this.h || (this.j = null), (a.next = null));
        return a;
      };
      var de = new Zd(
          function () {
            return new ee();
          },
          function (a) {
            return a.reset();
          }
        ),
        ee = function () {
          this.next = this.h = this.j = null;
        };
      ee.prototype.set = function (a, b) {
        this.j = a;
        this.h = b;
        this.next = null;
      };
      ee.prototype.reset = function () {
        this.next = this.h = this.j = null;
      };
      var fe,
        ge = !1,
        he = new ce(),
        je = function (a, b) {
          fe || ie();
          ge || (fe(), (ge = !0));
          he.add(a, b);
        },
        ie = function () {
          if (_.q.Promise && _.q.Promise.resolve) {
            var a = _.q.Promise.resolve(void 0);
            fe = function () {
              a.then(ke);
            };
          } else
            fe = function () {
              var b = ke;
              "function" !== typeof _.q.setImmediate ||
              (_.q.Window && _.q.Window.prototype && !_.Ia() && _.q.Window.prototype.setImmediate == _.q.setImmediate)
                ? (ae || (ae = be()), ae(b))
                : _.q.setImmediate(b);
            };
        },
        ke = function () {
          for (var a; (a = he.remove()); ) {
            try {
              a.j.call(a.h);
            } catch (b) {
              ba(b);
            }
            $d(de, a);
          }
          ge = !1;
        };
      var le = function (a) {
        if (!a) return !1;
        try {
          return !!a.$goog_Thenable;
        } catch (b) {
          return !1;
        }
      };
      var oe, ye, we, ue;
      _.ne = function (a) {
        this.h = 0;
        this.B = void 0;
        this.o = this.j = this.l = null;
        this.s = this.A = !1;
        if (a != _.Ib)
          try {
            var b = this;
            a.call(
              void 0,
              function (c) {
                _.me(b, 2, c);
              },
              function (c) {
                _.me(b, 3, c);
              }
            );
          } catch (c) {
            _.me(this, 3, c);
          }
      };
      oe = function () {
        this.next = this.l = this.j = this.o = this.h = null;
        this.s = !1;
      };
      oe.prototype.reset = function () {
        this.l = this.j = this.o = this.h = null;
        this.s = !1;
      };
      var pe = new Zd(
          function () {
            return new oe();
          },
          function (a) {
            a.reset();
          }
        ),
        qe = function (a, b, c) {
          var d = pe.get();
          d.o = a;
          d.j = b;
          d.l = c;
          return d;
        };
      _.ne.prototype.then = function (a, b, c) {
        return re(this, "function" === typeof a ? a : null, "function" === typeof b ? b : null, c);
      };
      _.ne.prototype.$goog_Thenable = !0;
      _.ne.prototype.D = function (a, b) {
        return re(this, null, a, b);
      };
      _.ne.prototype.catch = _.ne.prototype.D;
      _.ne.prototype.cancel = function (a) {
        if (0 == this.h) {
          var b = new se(a);
          je(function () {
            te(this, b);
          }, this);
        }
      };
      var te = function (a, b) {
          if (0 == a.h)
            if (a.l) {
              var c = a.l;
              if (c.j) {
                for (
                  var d = 0, e = null, f = null, g = c.j;
                  g && (g.s || (d++, g.h == a && (e = g), !(e && 1 < d)));
                  g = g.next
                )
                  e || (f = g);
                e &&
                  (0 == c.h && 1 == d
                    ? te(c, b)
                    : (f ? ((d = f), d.next == c.o && (c.o = d), (d.next = d.next.next)) : ue(c), ve(c, e, 3, b)));
              }
              a.l = null;
            } else _.me(a, 3, b);
        },
        xe = function (a, b) {
          a.j || (2 != a.h && 3 != a.h) || we(a);
          a.o ? (a.o.next = b) : (a.j = b);
          a.o = b;
        },
        re = function (a, b, c, d) {
          var e = qe(null, null, null);
          e.h = new _.ne(function (f, g) {
            e.o = b
              ? function (h) {
                  try {
                    var k = b.call(d, h);
                    f(k);
                  } catch (m) {
                    g(m);
                  }
                }
              : f;
            e.j = c
              ? function (h) {
                  try {
                    var k = c.call(d, h);
                    void 0 === k && h instanceof se ? g(h) : f(k);
                  } catch (m) {
                    g(m);
                  }
                }
              : g;
          });
          e.h.l = a;
          xe(a, e);
          return e.h;
        };
      _.ne.prototype.F = function (a) {
        this.h = 0;
        _.me(this, 2, a);
      };
      _.ne.prototype.I = function (a) {
        this.h = 0;
        _.me(this, 3, a);
      };
      _.me = function (a, b, c) {
        if (0 == a.h) {
          a === c && ((b = 3), (c = new TypeError("F")));
          a.h = 1;
          a: {
            var d = c,
              e = a.F,
              f = a.I;
            if (d instanceof _.ne) {
              xe(d, qe(e || _.Ib, f || null, a));
              var g = !0;
            } else if (le(d)) d.then(e, f, a), (g = !0);
            else {
              if (_.ya(d))
                try {
                  var h = d.then;
                  if ("function" === typeof h) {
                    ye(d, h, e, f, a);
                    g = !0;
                    break a;
                  }
                } catch (k) {
                  f.call(a, k);
                  g = !0;
                  break a;
                }
              g = !1;
            }
          }
          g || ((a.B = c), (a.h = b), (a.l = null), we(a), 3 != b || c instanceof se || ze(a, c));
        }
      };
      ye = function (a, b, c, d, e) {
        var f = !1,
          g = function (k) {
            f || ((f = !0), c.call(e, k));
          },
          h = function (k) {
            f || ((f = !0), d.call(e, k));
          };
        try {
          b.call(a, g, h);
        } catch (k) {
          h(k);
        }
      };
      we = function (a) {
        a.A || ((a.A = !0), je(a.G, a));
      };
      ue = function (a) {
        var b = null;
        a.j && ((b = a.j), (a.j = b.next), (b.next = null));
        a.j || (a.o = null);
        return b;
      };
      _.ne.prototype.G = function () {
        for (var a; (a = ue(this)); ) ve(this, a, this.h, this.B);
        this.A = !1;
      };
      var ve = function (a, b, c, d) {
          if (3 == c && b.j && !b.s) for (; a && a.s; a = a.l) a.s = !1;
          if (b.h) (b.h.l = null), Ae(b, c, d);
          else
            try {
              b.s ? b.o.call(b.l) : Ae(b, c, d);
            } catch (e) {
              Be.call(null, e);
            }
          $d(pe, b);
        },
        Ae = function (a, b, c) {
          2 == b ? a.o.call(a.l, c) : a.j && a.j.call(a.l, c);
        },
        ze = function (a, b) {
          a.s = !0;
          je(function () {
            a.s && Be.call(null, b);
          });
        },
        Be = ba,
        se = function (a) {
          _.aa.call(this, a);
        };
      _.z(se, _.aa);
      se.prototype.name = "cancel"; /*

 Copyright 2005, 2007 Bob Ippolito. All Rights Reserved.
 Copyright The Closure Library Authors.
 SPDX-License-Identifier: MIT
*/
      var Ce = function (a, b) {
        this.A = [];
        this.H = a;
        this.M = b || null;
        this.o = this.h = !1;
        this.l = void 0;
        this.F = this.O = this.D = !1;
        this.B = 0;
        this.j = null;
        this.s = 0;
      };
      _.z(Ce, Ua);
      Ce.prototype.cancel = function (a) {
        if (this.h) this.l instanceof Ce && this.l.cancel();
        else {
          if (this.j) {
            var b = this.j;
            delete this.j;
            a ? b.cancel(a) : (b.s--, 0 >= b.s && b.cancel());
          }
          this.H ? this.H.call(this.M, this) : (this.F = !0);
          this.h || this.G(new De(this));
        }
      };
      Ce.prototype.I = function (a, b) {
        this.D = !1;
        Ee(this, a, b);
      };
      var Ee = function (a, b, c) {
          a.h = !0;
          a.l = c;
          a.o = !b;
          Fe(a);
        },
        He = function (a) {
          if (a.h) {
            if (!a.F) throw new Ge(a);
            a.F = !1;
          }
        };
      Ce.prototype.callback = function (a) {
        He(this);
        Ee(this, !0, a);
      };
      Ce.prototype.G = function (a) {
        He(this);
        Ee(this, !1, a);
      };
      var Je = function (a, b, c) {
          Ie(a, b, null, c);
        },
        Ke = function (a, b, c) {
          Ie(a, null, b, c);
        },
        Ie = function (a, b, c, d) {
          a.A.push([b, c, d]);
          a.h && Fe(a);
        };
      Ce.prototype.then = function (a, b, c) {
        var d,
          e,
          f = new _.ne(function (g, h) {
            e = g;
            d = h;
          });
        Ie(
          this,
          e,
          function (g) {
            g instanceof De ? f.cancel() : d(g);
            return Le;
          },
          this
        );
        return f.then(a, b, c);
      };
      Ce.prototype.$goog_Thenable = !0;
      var Me = function (a, b) {
        b instanceof Ce
          ? Je(a, (0, _.y)(b.ha, b))
          : Je(a, function () {
              return b;
            });
      };
      Ce.prototype.ha = function (a) {
        var b = new Ce();
        Ie(this, b.callback, b.G, b);
        a && ((b.j = this), this.s++);
        return b;
      };
      var Ne = function (a) {
          return _.cc(a.A, function (b) {
            return "function" === typeof b[1];
          });
        },
        Le = {},
        Fe = function (a) {
          if (a.B && a.h && Ne(a)) {
            var b = a.B,
              c = Oe[b];
            c && (_.q.clearTimeout(c.h), delete Oe[b]);
            a.B = 0;
          }
          a.j && (a.j.s--, delete a.j);
          b = a.l;
          for (var d = (c = !1); a.A.length && !a.D; ) {
            var e = a.A.shift(),
              f = e[0],
              g = e[1];
            e = e[2];
            if ((f = a.o ? g : f))
              try {
                var h = f.call(e || a.M, b);
                h === Le && (h = void 0);
                void 0 !== h && ((a.o = a.o && (h == b || h instanceof Error)), (a.l = b = h));
                if (le(b) || ("function" === typeof _.q.Promise && b instanceof _.q.Promise)) (d = !0), (a.D = !0);
              } catch (k) {
                (b = k), (a.o = !0), Ne(a) || (c = !0);
              }
          }
          a.l = b;
          d &&
            ((h = (0, _.y)(a.I, a, !0)),
            (d = (0, _.y)(a.I, a, !1)),
            b instanceof Ce ? (Ie(b, h, d), (b.O = !0)) : b.then(h, d));
          c && ((b = new Pe(b)), (Oe[b.h] = b), (a.B = b.h));
        },
        Ge = function () {
          _.aa.call(this);
        };
      _.z(Ge, _.aa);
      Ge.prototype.message = "Deferred has already fired";
      Ge.prototype.name = "AlreadyCalledError";
      var De = function () {
        _.aa.call(this);
      };
      _.z(De, _.aa);
      De.prototype.message = "Deferred was canceled";
      De.prototype.name = "CanceledError";
      var Pe = function (a) {
        this.h = _.q.setTimeout((0, _.y)(this.l, this), 0);
        this.j = a;
      };
      Pe.prototype.l = function () {
        delete Oe[this.h];
        throw this.j;
      };
      var Oe = {};
      var Qe = function (a, b) {
        this.type = a;
        this.status = b;
      };
      Qe.prototype.toString = function () {
        return Re(this) + " (" + (void 0 != this.status ? this.status : "?") + ")";
      };
      var Re = function (a) {
        switch (a.type) {
          case Qe.h.Pf:
            return "Unauthorized";
          case Qe.h.Ef:
            return "Consecutive load failures";
          case Qe.h.TIMEOUT:
            return "Timed out";
          case Qe.h.Nf:
            return "Out of date module id";
          case Qe.h.ge:
            return "Init error";
          default:
            return "Unknown failure type " + a.type;
        }
      };
      xb.Va = Qe;
      xb.Va.h = { Pf: 0, Ef: 1, TIMEOUT: 2, Nf: 3, ge: 4 };
      var Se = function () {
        Yb.call(this);
        this.h = {};
        this.l = [];
        this.o = [];
        this.M = [];
        this.j = [];
        this.B = [];
        this.A = {};
        this.O = {};
        this.s = this.G = new Vb([], "");
        this.ha = null;
        this.I = new Ce();
        this.H = !1;
        this.F = 0;
        this.T = this.V = this.Z = !1;
      };
      _.z(Se, Yb);
      var Te = function (a, b) {
        _.aa.call(this, "Error loading " + a + ": " + b);
      };
      _.z(Te, _.aa);
      _.l = Se.prototype;
      _.l.Zg = function (a) {
        this.H = a;
      };
      _.l.nf = function (a, b) {
        if (!(this instanceof Se)) this.nf(a, b);
        else if ("string" === typeof a) {
          a = a.split("/");
          for (var c = [], d = 0; d < a.length; d++) {
            var e = a[d].split(":"),
              f = e[0];
            if (e[1]) {
              e = e[1].split(",");
              for (var g = 0; g < e.length; g++) e[g] = c[parseInt(e[g], 36)];
            } else e = [];
            c.push(f);
            this.h[f]
              ? ((f = this.h[f].j), f != e && f.splice.apply(f, [0, f.length].concat(_.gb(e))))
              : (this.h[f] = new Vb(e, f));
          }
          b && b.length ? (xa(this.l, b), (this.ha = b[b.length - 1])) : this.I.h || this.I.callback();
          Ue(this);
        }
      };
      _.l.Wg = function (a, b) {
        if (this.A[a]) {
          delete this.A[a][b];
          for (var c in this.A[a]) return;
          delete this.A[a];
        }
      };
      _.l.pf = function (a) {
        Se.R.pf.call(this, a);
        Ue(this);
      };
      _.l.isActive = function () {
        return 0 < this.l.length;
      };
      _.l.Cg = function () {
        return 0 < this.B.length;
      };
      var We = function (a) {
          var b = a.Z,
            c = a.isActive();
          c != b && (Ve(a, c ? "active" : "idle"), (a.Z = c));
          b = a.Cg();
          b != a.V && (Ve(a, b ? "userActive" : "userIdle"), (a.V = b));
        },
        Ze = function (a, b, c) {
          var d = [];
          Aa(b, d);
          b = [];
          for (var e = {}, f = 0; f < d.length; f++) {
            var g = d[f],
              h = a.h[g];
            if (!h) throw Error("G`" + g);
            var k = new Ce();
            e[g] = k;
            h.h ? k.callback(a.Ca) : (Xe(a, g, h, !!c, k), Ye(a, g) || b.push(g));
          }
          0 < b.length && (0 === a.l.length ? a.N(b) : (a.j.push(b), We(a)));
          return e;
        },
        Xe = function (a, b, c, d, e) {
          c.o.push(new Ub(e.callback, e));
          Wb(c, function (f) {
            e.G(new Te(b, f));
          });
          Ye(a, b) ? d && (_.ta(a.B, b) || a.B.push(b), We(a)) : d && (_.ta(a.B, b) || a.B.push(b));
        };
      Se.prototype.N = function (a, b, c) {
        var d = this;
        b || (this.F = 0);
        var e = $e(this, a);
        this.l = e;
        this.o = this.H ? a : _.wa(e);
        We(this);
        if (0 !== e.length) {
          this.M.push.apply(this.M, e);
          if (0 < Object.keys(this.A).length && !this.D.H) throw Error("H");
          a = (0, _.y)(this.D.I, this.D, _.wa(e), this.h, {
            ci: this.A,
            gi: !!c,
            bf: function (f) {
              var g = d.o;
              f = null != f ? f : void 0;
              d.F++;
              d.o = g;
              e.forEach(_.Db(_.va, d.M), d);
              401 == f
                ? (af(d, new xb.Va(xb.Va.h.Pf, f)), (d.j.length = 0))
                : 410 == f
                ? (bf(d, new xb.Va(xb.Va.h.Nf, f)), cf(d))
                : 3 <= d.F
                ? (bf(d, new xb.Va(xb.Va.h.Ef, f)), cf(d))
                : d.N(d.o, !0, 8001 == f);
            },
            uj: (0, _.y)(this.ea, this),
          });
          (b = 5e3 * Math.pow(this.F, 2)) ? _.q.setTimeout(a, b) : a();
        }
      };
      var $e = function (a, b) {
          b = b.filter(function (e) {
            return a.h[e].h
              ? (_.q.setTimeout(function () {
                  return Error("I`" + e);
                }, 0),
                !1)
              : !0;
          });
          for (var c = [], d = 0; d < b.length; d++) c = c.concat(df(a, b[d]));
          Aa(c);
          return !a.H && 1 < c.length
            ? ((b = c.shift()),
              (a.j = c
                .map(function (e) {
                  return [e];
                })
                .concat(a.j)),
              [b])
            : c;
        },
        df = function (a, b) {
          var c = Ta(a.M),
            d = [];
          c[b] || d.push(b);
          b = [b];
          for (var e = 0; e < b.length; e++)
            for (var f = a.h[b[e]].j, g = f.length - 1; 0 <= g; g--) {
              var h = f[g];
              a.h[h].h || c[h] || (d.push(h), b.push(h));
            }
          d.reverse();
          Aa(d);
          return d;
        },
        Ue = function (a) {
          a.s == a.G && ((a.s = null), a.G.onLoad((0, _.y)(a.ig, a)) && af(a, new xb.Va(xb.Va.h.ge)), We(a));
        },
        na = function (a) {
          if (a.s) {
            var b = a.s.jb(),
              c = [];
            if (a.A[b]) {
              for (var d = _.v(Object.keys(a.A[b])), e = d.next(); !e.done; e = d.next()) {
                e = e.value;
                var f = a.h[e];
                f && !f.h && (a.Wg(b, e), c.push(e));
              }
              Ze(a, c);
            }
            a.Ya() ||
              (a.h[b].onLoad((0, _.y)(a.ig, a)) && af(a, new xb.Va(xb.Va.h.ge)),
              _.va(a.B, b),
              _.va(a.l, b),
              0 === a.l.length && cf(a),
              a.ha && b == a.ha && (a.I.h || a.I.callback()),
              We(a),
              (a.s = null));
          }
        },
        Ye = function (a, b) {
          if (_.ta(a.l, b)) return !0;
          for (var c = 0; c < a.j.length; c++) if (_.ta(a.j[c], b)) return !0;
          return !1;
        };
      Se.prototype.load = function (a, b) {
        return Ze(this, [a], b)[a];
      };
      var la = function (a) {
        var b = _.fa;
        b.s && "synthetic_module_overhead" === b.s.jb() && (na(b), delete b.h.synthetic_module_overhead);
        b.h[a] &&
          ef(
            b,
            b.h[a].j || [],
            function (c) {
              c.h = new Tb();
              _.va(b.l, c.jb());
            },
            function (c) {
              return !c.h;
            }
          );
        b.s = b.h[a];
      };
      Se.prototype.ea = function () {
        bf(this, new xb.Va(xb.Va.h.TIMEOUT));
        cf(this);
      };
      var bf = function (a, b) {
          1 < a.o.length
            ? (a.j = a.o
                .map(function (c) {
                  return [c];
                })
                .concat(a.j))
            : af(a, b);
        },
        af = function (a, b) {
          var c = a.o;
          a.l.length = 0;
          for (var d = [], e = 0; e < a.j.length; e++) {
            var f = a.j[e].filter(function (k) {
              var m = df(this, k);
              return _.cc(c, function (n) {
                return _.ta(m, n);
              });
            }, a);
            xa(d, f);
          }
          for (e = 0; e < c.length; e++) _.ua(d, c[e]);
          for (e = 0; e < d.length; e++) {
            for (f = 0; f < a.j.length; f++) _.va(a.j[f], d[e]);
            _.va(a.B, d[e]);
          }
          var g = a.O.error;
          if (g)
            for (e = 0; e < g.length; e++) {
              var h = g[e];
              for (f = 0; f < d.length; f++) h("error", d[f], b);
            }
          for (e = 0; e < c.length; e++) a.h[c[e]] && a.h[c[e]].bf(b);
          a.o.length = 0;
          We(a);
        },
        cf = function (a) {
          for (; a.j.length; ) {
            var b = a.j.shift().filter(function (c) {
              return !this.h[c].h;
            }, a);
            if (0 < b.length) {
              a.N(b);
              return;
            }
          }
          We(a);
        },
        Ve = function (a, b) {
          a = a.O[b];
          for (var c = 0; a && c < a.length; c++) a[c](b);
        },
        ef = function (a, b, c, d, e) {
          d =
            void 0 === d
              ? function () {
                  return !0;
                }
              : d;
          e = void 0 === e ? {} : e;
          b = _.v(b);
          for (var f = b.next(); !f.done; f = b.next()) {
            f = f.value;
            var g = a.h[f];
            !e[f] && d(g) && ((e[f] = !0), ef(a, g.j || [], c, d, e), c(g));
          }
        };
      Se.prototype.U = function () {
        ea(_.Qa(this.h), this.G);
        this.h = {};
        this.l = [];
        this.o = [];
        this.B = [];
        this.j = [];
        this.O = {};
        this.T = !0;
      };
      Se.prototype.Ya = function () {
        return this.T;
      };
      _.ha = function () {
        return new Se();
      };
      var ff = function (a, b) {
        this.h = a[_.q.Symbol.iterator]();
        this.j = b;
      };
      ff.prototype[Symbol.iterator] = function () {
        return this;
      };
      ff.prototype.next = function () {
        var a = this.h.next();
        return { value: a.done ? void 0 : this.j.call(void 0, a.value), done: a.done };
      };
      var gf = function (a, b) {
        return new ff(a, b);
      };
      _.hf = function () {};
      _.hf.prototype.next = function () {
        return _.jf;
      };
      _.jf = { done: !0, value: void 0 };
      _.hf.prototype.Nb = function () {
        return this;
      };
      var nf = function (a) {
          if (a instanceof kf || a instanceof lf || a instanceof mf) return a;
          if ("function" == typeof a.next)
            return new kf(function () {
              return a;
            });
          if ("function" == typeof a[Symbol.iterator])
            return new kf(function () {
              return a[Symbol.iterator]();
            });
          if ("function" == typeof a.Nb)
            return new kf(function () {
              return a.Nb();
            });
          throw Error("J");
        },
        kf = function (a) {
          this.h = a;
        };
      kf.prototype.Nb = function () {
        return new lf(this.h());
      };
      kf.prototype[Symbol.iterator] = function () {
        return new mf(this.h());
      };
      kf.prototype.j = function () {
        return new mf(this.h());
      };
      var lf = function (a) {
        this.h = a;
      };
      _.w(lf, _.hf);
      lf.prototype.next = function () {
        return this.h.next();
      };
      lf.prototype[Symbol.iterator] = function () {
        return new mf(this.h);
      };
      lf.prototype.j = function () {
        return new mf(this.h);
      };
      var mf = function (a) {
        kf.call(this, function () {
          return a;
        });
        this.l = a;
      };
      _.w(mf, kf);
      mf.prototype.next = function () {
        return this.l.next();
      };
      var of = function (a, b) {
        this.j = {};
        this.h = [];
        this.l = this.size = 0;
        var c = arguments.length;
        if (1 < c) {
          if (c % 2) throw Error("z");
          for (var d = 0; d < c; d += 2) this.set(arguments[d], arguments[d + 1]);
        } else if (a)
          if (a instanceof of) for (c = a.ec(), d = 0; d < c.length; d++) this.set(c[d], a.get(c[d]));
          else for (d in a) this.set(d, a[d]);
      };
      of.prototype.ab = function () {
        pf(this);
        for (var a = [], b = 0; b < this.h.length; b++) a.push(this.j[this.h[b]]);
        return a;
      };
      of.prototype.ec = function () {
        pf(this);
        return this.h.concat();
      };
      _.qf = function (a, b) {
        return a.has(b);
      };
      of.prototype.has = function (a) {
        return rf(this.j, a);
      };
      of.prototype.remove = function (a) {
        rf(this.j, a)
          ? (delete this.j[a], --this.size, this.l++, this.h.length > 2 * this.size && pf(this), (a = !0))
          : (a = !1);
        return a;
      };
      var pf = function (a) {
        if (a.size != a.h.length) {
          for (var b = 0, c = 0; b < a.h.length; ) {
            var d = a.h[b];
            rf(a.j, d) && (a.h[c++] = d);
            b++;
          }
          a.h.length = c;
        }
        if (a.size != a.h.length) {
          var e = {};
          for (c = b = 0; b < a.h.length; ) (d = a.h[b]), rf(e, d) || ((a.h[c++] = d), (e[d] = 1)), b++;
          a.h.length = c;
        }
      };
      _.l = of.prototype;
      _.l.get = function (a, b) {
        return rf(this.j, a) ? this.j[a] : b;
      };
      _.l.set = function (a, b) {
        rf(this.j, a) || ((this.size += 1), this.h.push(a), this.l++);
        this.j[a] = b;
      };
      _.l.forEach = function (a, b) {
        for (var c = this.ec(), d = 0; d < c.length; d++) {
          var e = c[d],
            f = this.get(e);
          a.call(b, f, e, this);
        }
      };
      _.l.keys = function () {
        return nf(this.Nb(!0)).j();
      };
      _.l.values = function () {
        return nf(this.Nb(!1)).j();
      };
      _.l.entries = function () {
        var a = this;
        return gf(this.keys(), function (b) {
          return [b, a.get(b)];
        });
      };
      _.l.Nb = function (a) {
        pf(this);
        var b = 0,
          c = this.l,
          d = this,
          e = new _.hf();
        e.next = function () {
          if (c != d.l) throw Error("K");
          if (b >= d.h.length) return _.jf;
          var f = d.h[b++];
          return { value: a ? f : d.j[f], done: !1 };
        };
        return e;
      };
      var rf = function (a, b) {
        return Object.prototype.hasOwnProperty.call(a, b);
      };
      _.sf = function () {
        this.h = new of();
        this.size = 0;
      };
      _.tf = function (a) {
        var b = typeof a;
        return ("object" == b && a) || "function" == b ? "o" + _.za(a) : b.charAt(0) + a;
      };
      _.l = _.sf.prototype;
      _.l.add = function (a) {
        this.h.set(_.tf(a), a);
        this.size = this.h.size;
      };
      _.l.remove = function (a) {
        a = this.h.remove(_.tf(a));
        this.size = this.h.size;
        return a;
      };
      _.l.has = function (a) {
        return _.qf(this.h, _.tf(a));
      };
      _.l.ab = function () {
        return this.h.ab();
      };
      _.l.values = function () {
        return this.h.values();
      };
      _.l.Nb = function () {
        return this.h.Nb(!1);
      };
      _.sf.prototype[Symbol.iterator] = function () {
        return this.values();
      };
      var uf = [],
        vf = function (a) {
          function b(d) {
            d &&
              bc(
                d,
                function (e, f) {
                  e[f.id] = !0;
                  return e;
                },
                c.Aj
              );
          }
          var c = { Aj: {}, index: uf.length, cm: a };
          b(a.h);
          b(a.l);
          uf.push(c);
          a.h &&
            _.$b(a.h, function (d) {
              var e = d.id;
              e instanceof B && d.module && (e.h = d.module);
            });
        };
      new B("Bgf0ib");
      var wf = new B("MpJwZc", "MpJwZc");
      var xf = new B("UUJqVe", "UUJqVe");
      new B("GHAeAc", "GHAeAc");
      new B("Wt6vjf", "Wt6vjf");
      new B("byfTOb", "byfTOb");
      new B("LEikZe", "LEikZe");
      new B("lsjVmc", "lsjVmc");
      new B("pVbxBc");
      new B("klpyYe");
      new B("OPbIxb");
      new B("pg9hFd");
      new B("IaqD3e");
      new B("Xpw1of");
      new B("v5BQle");
      new B("tdUkaf");
      new B("WSziFf");
      new B("UBSgGf");
      new B("zZa4xc");
      new B("o1bZcd");
      new B("WwG67d");
      new B("z72MOc");
      new B("JccZRe");
      new B("amY3Td");
      new B("ABma3e");
      new B("gSshPb");
      new B("yu4DA");
      new B("vk3Wc");
      new B("IykvEf");
      new B("J5K1Ad");
      new B("IW8Usd");
      new B("jbDgG");
      new B("b8xKu");
      new B("d0RAGb");
      new B("AzG0ke");
      new B("J4QWB");
      new B("TuDsZ");
      new B("hdXIif");
      new B("mITR5c");
      new B("DFElXb");
      new B("FENZqe");
      new B("tLnxq");
      vf({ h: [{ id: Zb, ud: Yd, multiple: !0 }] });
      var yf = {};
      var zf = new td(),
        Af = function (a, b) {
          _.ud.call(this, a, b);
          this.node = b;
        };
      _.w(Af, _.ud);
      _.Bf = RegExp(
        "^(ar|ckb|dv|he|iw|fa|nqo|ps|sd|ug|ur|yi|.*[-_](Adlm|Arab|Hebr|Nkoo|Rohg|Thaa))(?!.*[-_](Latn|Cyrl)($|-|_))($|-|_)",
        "i"
      );
      _.Cf = RegExp(
        "^(?:([^:/?#.]+):)?(?://(?:([^\\\\/?#]*)@)?([^\\\\/?#]*?)(?::([0-9]+))?(?=[\\\\/?#]|$))?([^?#]+)?(?:\\?([^#]*))?(?:#([\\s\\S]*))?$"
      );
      _.Df = function (a) {
        return a ? decodeURI(a) : a;
      };
      _.Ef = function (a, b) {
        if (a) {
          a = a.split("&");
          for (var c = 0; c < a.length; c++) {
            var d = a[c].indexOf("="),
              e = null;
            if (0 <= d) {
              var f = a[c].substring(0, d);
              e = a[c].substring(d + 1);
            } else f = a[c];
            b(f, e ? _.bd(e) : "");
          }
        }
      };
      _.Ff = function (a, b, c) {
        if (Array.isArray(b)) for (var d = 0; d < b.length; d++) _.Ff(a, String(b[d]), c);
        else null != b && c.push(a + ("" === b ? "" : "=" + _.ad(b)));
      };
      var Gf =
          "ARTICLE SECTION NAV ASIDE H1 H2 H3 H4 H5 H6 HEADER FOOTER ADDRESS P HR PRE BLOCKQUOTE OL UL LH LI DL DT DD FIGURE FIGCAPTION MAIN DIV EM STRONG SMALL S CITE Q DFN ABBR RUBY RB RT RTC RP DATA TIME CODE VAR SAMP KBD SUB SUP I B U MARK BDI BDO SPAN BR WBR INS DEL PICTURE PARAM TRACK MAP TABLE CAPTION COLGROUP COL TBODY THEAD TFOOT TR TD TH SELECT DATALIST OPTGROUP OPTION OUTPUT PROGRESS METER FIELDSET LEGEND DETAILS SUMMARY MENU DIALOG SLOT CANVAS FONT CENTER".split(
            " "
          ),
        Hf = [
          ["A", new Map([["href", { Aa: 2 }]])],
          ["AREA", new Map([["href", { Aa: 2 }]])],
          [
            "LINK",
            new Map([
              [
                "href",
                {
                  Aa: 2,
                  conditions: new Map([
                    [
                      "rel",
                      new Set(
                        "alternate author bookmark canonical cite help icon license next prefetch dns-prefetch prerender preconnect preload prev search subresource".split(
                          " "
                        )
                      ),
                    ],
                  ]),
                },
              ],
            ]),
          ],
          ["SOURCE", new Map([["src", { Aa: 1 }]])],
          ["IMG", new Map([["src", { Aa: 1 }]])],
          ["VIDEO", new Map([["src", { Aa: 1 }]])],
          ["AUDIO", new Map([["src", { Aa: 1 }]])],
        ],
        If =
          "title aria-atomic aria-autocomplete aria-busy aria-checked aria-current aria-disabled aria-dropeffect aria-expanded aria-haspopup aria-hidden aria-invalid aria-label aria-level aria-live aria-multiline aria-multiselectable aria-orientation aria-posinset aria-pressed aria-readonly aria-relevant aria-required aria-selected aria-setsize aria-sort aria-valuemax aria-valuemin aria-valuenow aria-valuetext alt align autocapitalize autocomplete autocorrect autofocus autoplay bgcolor border cellpadding cellspacing checked color cols colspan controls datetime disabled download draggable enctype face formenctype frameborder height hreflang hidden ismap label lang loop max maxlength media minlength min multiple muted nonce open placeholder preload rel required reversed role rows rowspan selected shape size sizes slot span spellcheck start step summary translate type valign value width wrap itemscope itemtype itemid itemprop itemref".split(
            " "
          ),
        Jf = [
          [
            "dir",
            {
              Aa: 3,
              conditions: Va(function () {
                return new Map([["dir", new Set(["auto", "ltr", "rtl"])]]);
              }),
            },
          ],
          [
            "async",
            {
              Aa: 3,
              conditions: Va(function () {
                return new Map([["async", new Set(["async"])]]);
              }),
            },
          ],
          ["cite", { Aa: 2 }],
          [
            "loading",
            {
              Aa: 3,
              conditions: Va(function () {
                return new Map([["loading", new Set(["eager", "lazy"])]]);
              }),
            },
          ],
          ["poster", { Aa: 2 }],
          [
            "target",
            {
              Aa: 3,
              conditions: Va(function () {
                return new Map([["target", new Set(["_self", "_blank"])]]);
              }),
            },
          ],
        ],
        Kf = new (function (a, b, c) {
          var d = new Set(["data-", "aria-"]),
            e = new Map(Hf);
          this.l = a;
          this.h = e;
          this.o = b;
          this.s = c;
          this.j = d;
        })(
          new Set(
            Va(function () {
              return Gf.concat("STYLE TITLE INPUT TEXTAREA BUTTON LABEL".split(" "));
            })
          ),
          new Set(
            Va(function () {
              return If.concat(["class", "id", "tabindex", "contenteditable", "name"]);
            })
          ),
          new Map(
            Va(function () {
              return Jf.concat([["style", { Aa: 4 }]]);
            })
          )
        );
      _.Lf = Va(function () {
        try {
          return new URL("s://g"), !0;
        } catch (a) {
          return !1;
        }
      });
      var Mf;
      Mf = function () {
        this.j = Kf;
        this.h = [];
      };
      _.Nf = Va(function () {
        return new Mf();
      });
      _.Of = function (a, b) {
        b || _.fd();
        this.l = a || null;
      };
      _.Of.prototype.Na = function (a) {
        a = a({}, this.l ? this.l.h() : {});
        this.j(null, "function" == typeof _.Pf && a instanceof _.Pf ? a.Eb : null);
      };
      _.Of.prototype.j = function () {};
      var Qf = function (a) {
        this.j = a;
        this.l = this.j.h(xf);
      };
      Qf.prototype.h = function () {
        this.j.Ya() || (this.l = this.j.h(xf));
        return this.l ? this.l.h() : {};
      };
      var Rf = function (a) {
        var b = new Qf(a);
        _.Of.call(this, b, a.get(Zb).j);
        this.o = new _.E();
        this.s = b;
      };
      _.w(Rf, _.Of);
      Rf.prototype.h = function () {
        return this.s.h();
      };
      Rf.prototype.j = function (a, b) {
        _.Of.prototype.j.call(this, a, b);
        this.o.dispatchEvent(new Af(zf, a, b));
      };
      ra(wf, Rf);
      vf({ h: [{ id: wf, ud: Rf, multiple: !0 }] });
      var Sf = function (a, b) {
        this.defaultValue = a;
        this.type = b;
        this.value = a;
      };
      Sf.prototype.get = function () {
        return this.value;
      };
      Sf.prototype.set = function (a) {
        this.value = a;
      };
      var Tf = function (a) {
        Sf.call(this, a, "b");
      };
      _.w(Tf, Sf);
      Tf.prototype.get = function () {
        return this.value;
      };
      var Uf = function () {
        this.h = {};
        this.j = "";
        this.l = {};
      };
      Uf.prototype.toString = function () {
        if (this.j.endsWith("_/wa/")) var a = this.j + Vf(this, "k");
        else {
          a = this.j + Wf(this);
          var b = this.l;
          var c = [],
            d;
          for (d in b) _.Ff(d, b[d], c);
          b = c.join("&");
          c = "";
          "" != b && (c = "?" + b);
          a += c;
        }
        return a;
      };
      var Wf = function (a) {
          var b = [],
            c = (0, _.y)(function (d) {
              void 0 !== this.h[d] && b.push(d + "=" + this.h[d]);
            }, a);
          "1" == Vf(a, "md")
            ? (c("md"), c("k"), c("ck"), c("am"), c("rs"), c("gssmodulesetproto"))
            : (c("sdch"),
              c("k"),
              c("ck"),
              c("am"),
              c("rt"),
              "d" in a.h || Xf(a, "d", "0"),
              c("d"),
              c("exm"),
              c("excm"),
              (a.h.excm || a.h.exm) && b.push("ed=1"),
              c("im"),
              c("dg"),
              c("sm"),
              "1" == Vf(a, "br") && c("br"),
              "" !== Yf(a) && c("wt"),
              c("gssmodulesetproto"),
              c("rs"),
              c("ee"),
              c("cb"),
              c("ujg"),
              c("m"));
          return b.join("/");
        },
        Vf = function (a, b) {
          return a.h[b] ? a.h[b] : null;
        },
        Xf = function (a, b, c) {
          c ? (a.h[b] = c) : delete a.h[b];
        },
        Yf = function (a) {
          switch (Vf(a, "wt")) {
            case "0":
              return "0";
            case "1":
              return "1";
            case "2":
              return "2";
            default:
              return "";
          }
        },
        ag = function (a) {
          var b = void 0 === b ? !0 : b;
          var c = Zf(a),
            d = new Uf(),
            e = c.match(_.Cf)[5];
          _.Fc($f, function (g) {
            var h = e.match("/" + g + "=([^/]+)");
            h && Xf(d, g, h[1]);
          });
          var f = -1 != a.indexOf("_/ss/") ? "_/ss/" : -1 != a.indexOf("_/wa/") ? "_/wa/" : "_/js/";
          d.j = a.substr(0, a.indexOf(f) + f.length);
          if (d.j.endsWith("_/wa/")) return Xf(d, "k", a.substr(d.j.length)), d;
          if (!b) return d;
          (a = c.match(_.Cf)[6] || null) &&
            _.Ef(a, function (g, h) {
              d.l[g] = h;
            });
          return d;
        },
        Zf = function (a) {
          return a.startsWith("https://uberproxy-pen-redirect.corp.google.com/uberproxy/pen?url=") ? a.substr(65) : a;
        },
        $f = {
          Gk: "k",
          bk: "ck",
          vk: "m",
          jk: "exm",
          hk: "excm",
          Sj: "am",
          Fk: "rt",
          rk: "d",
          ik: "ed",
          Pk: "sv",
          ck: "deob",
          Zj: "cb",
          Mk: "rs",
          Hk: "sdch",
          sk: "im",
          dk: "dg",
          gk: "br",
          dl: "wt",
          kk: "ee",
          Ok: "sm",
          uk: "md",
          pk: "gssmodulesetproto",
          bl: "ujg",
        };
      _.bg = function (a) {
        _.A.call(this);
        this.j = a;
        this.h = {};
      };
      _.z(_.bg, _.A);
      var cg = [];
      _.bg.prototype.J = function (a, b, c, d) {
        return dg(this, a, b, c, d);
      };
      var dg = function (a, b, c, d, e, f) {
        Array.isArray(c) || (c && (cg[0] = c.toString()), (c = cg));
        for (var g = 0; g < c.length; g++) {
          var h = _.D(b, c[g], d || a.handleEvent, e || !1, f || a.j || a);
          if (!h) break;
          a.h[h.key] = h;
        }
        return a;
      };
      _.bg.prototype.Sb = function (a, b, c, d) {
        return eg(this, a, b, c, d);
      };
      var eg = function (a, b, c, d, e, f) {
        if (Array.isArray(c)) for (var g = 0; g < c.length; g++) eg(a, b, c[g], d, e, f);
        else {
          b = _.Ld(b, c, d || a.handleEvent, e, f || a.j || a);
          if (!b) return a;
          a.h[b.key] = b;
        }
        return a;
      };
      _.bg.prototype.ob = function (a, b, c, d, e) {
        if (Array.isArray(b)) for (var f = 0; f < b.length; f++) this.ob(a, b[f], c, d, e);
        else
          (c = c || this.handleEvent),
            (d = _.ya(d) ? !!d.capture : !!d),
            (e = e || this.j || this),
            (c = Md(c)),
            (d = !!d),
            (b = _.zd(a) ? a.Xc(b, c, d, e) : a ? ((a = _.Od(a)) ? a.Xc(b, c, d, e) : null) : null),
            b && (_.Td(b), delete this.h[b.key]);
        return this;
      };
      _.fg = function (a) {
        _.Fc(
          a.h,
          function (b, c) {
            this.h.hasOwnProperty(c) && _.Td(b);
          },
          a
        );
        a.h = {};
      };
      _.bg.prototype.L = function () {
        _.bg.R.L.call(this);
        _.fg(this);
      };
      _.bg.prototype.handleEvent = function () {
        throw Error("Q");
      };
      var gg = function () {};
      gg.prototype.j = null;
      var hg = function (a) {
        return a.j || (a.j = a.o());
      };
      var ig,
        jg = function () {};
      _.z(jg, gg);
      jg.prototype.h = function () {
        var a = kg(this);
        return a ? new ActiveXObject(a) : new XMLHttpRequest();
      };
      jg.prototype.o = function () {
        var a = {};
        kg(this) && ((a[0] = !0), (a[1] = !0));
        return a;
      };
      var kg = function (a) {
        if (!a.l && "undefined" == typeof XMLHttpRequest && "undefined" != typeof ActiveXObject) {
          for (
            var b = ["MSXML2.XMLHTTP.6.0", "MSXML2.XMLHTTP.3.0", "MSXML2.XMLHTTP", "Microsoft.XMLHTTP"], c = 0;
            c < b.length;
            c++
          ) {
            var d = b[c];
            try {
              return new ActiveXObject(d), (a.l = d);
            } catch (e) {}
          }
          throw Error("R");
        }
        return a.l;
      };
      ig = new jg();
      var lg = function () {};
      _.z(lg, gg);
      lg.prototype.h = function () {
        var a = new XMLHttpRequest();
        if ("withCredentials" in a) return a;
        if ("undefined" != typeof XDomainRequest) return new mg();
        throw Error("S");
      };
      lg.prototype.o = function () {
        return {};
      };
      var mg = function () {
        this.h = new XDomainRequest();
        this.readyState = 0;
        this.onreadystatechange = null;
        this.responseType = this.responseText = "";
        this.status = -1;
        this.statusText = "";
        this.h.onload = (0, _.y)(this.ph, this);
        this.h.onerror = (0, _.y)(this.Gf, this);
        this.h.onprogress = (0, _.y)(this.Ki, this);
        this.h.ontimeout = (0, _.y)(this.Mi, this);
      };
      _.l = mg.prototype;
      _.l.open = function (a, b, c) {
        if (null != c && !c) throw Error("T");
        this.h.open(a, b);
      };
      _.l.send = function (a) {
        if (a)
          if ("string" == typeof a) this.h.send(a);
          else throw Error("U");
        else this.h.send();
      };
      _.l.abort = function () {
        this.h.abort();
      };
      _.l.setRequestHeader = function () {};
      _.l.getResponseHeader = function (a) {
        return "content-type" == a.toLowerCase() ? this.h.contentType : "";
      };
      _.l.ph = function () {
        this.status = 200;
        this.responseText = this.h.responseText;
        ng(this, 4);
      };
      _.l.Gf = function () {
        this.status = 500;
        this.responseText = "";
        ng(this, 4);
      };
      _.l.Mi = function () {
        this.Gf();
      };
      _.l.Ki = function () {
        this.status = 200;
        ng(this, 1);
      };
      var ng = function (a, b) {
        a.readyState = b;
        if (a.onreadystatechange) a.onreadystatechange();
      };
      mg.prototype.getAllResponseHeaders = function () {
        return "content-type: " + this.h.contentType;
      };
      _.og = function (a, b, c) {
        if ("function" === typeof a) c && (a = (0, _.y)(a, c));
        else if (a && "function" == typeof a.handleEvent) a = (0, _.y)(a.handleEvent, a);
        else throw Error("W");
        return 2147483647 < Number(b) ? -1 : _.q.setTimeout(a, b || 0);
      };
      var qg, rg;
      _.pg = function (a) {
        _.E.call(this);
        this.headers = new Map();
        this.F = a || null;
        this.j = !1;
        this.G = this.h = null;
        this.s = "";
        this.l = this.M = this.A = this.I = !1;
        this.o = 0;
        this.B = null;
        this.N = "";
        this.H = this.D = !1;
      };
      _.z(_.pg, _.E);
      qg = /^https?$/i;
      rg = ["POST", "PUT"];
      _.sg = [];
      _.pg.prototype.Z = function () {
        this.U();
        _.va(_.sg, this);
      };
      _.pg.prototype.send = function (a, b, c, d) {
        if (this.h) throw Error("X`" + this.s + "`" + a);
        b = b ? b.toUpperCase() : "GET";
        this.s = a;
        this.I = !1;
        this.j = !0;
        this.h = this.F ? this.F.h() : ig.h();
        this.G = this.F ? hg(this.F) : hg(ig);
        this.h.onreadystatechange = (0, _.y)(this.O, this);
        try {
          (this.M = !0), this.h.open(b, String(a), !0), (this.M = !1);
        } catch (g) {
          tg(this);
          return;
        }
        a = c || "";
        c = new Map(this.headers);
        if (d)
          if (Object.getPrototypeOf(d) === Object.prototype) for (var e in d) c.set(e, d[e]);
          else if ("function" === typeof d.keys && "function" === typeof d.get) {
            e = _.v(d.keys());
            for (var f = e.next(); !f.done; f = e.next()) (f = f.value), c.set(f, d.get(f));
          } else throw Error("Y`" + String(d));
        d = Array.from(c.keys()).find(function (g) {
          return "content-type" == g.toLowerCase();
        });
        e = _.q.FormData && a instanceof _.q.FormData;
        !_.ta(rg, b) || d || e || c.set("Content-Type", "application/x-www-form-urlencoded;charset=utf-8");
        b = _.v(c);
        for (d = b.next(); !d.done; d = b.next())
          (c = _.v(d.value)), (d = c.next().value), (c = c.next().value), this.h.setRequestHeader(d, c);
        this.N && (this.h.responseType = this.N);
        "withCredentials" in this.h && this.h.withCredentials !== this.D && (this.h.withCredentials = this.D);
        try {
          ug(this),
            0 < this.o &&
              ((this.H = vg(this.h))
                ? ((this.h.timeout = this.o), (this.h.ontimeout = (0, _.y)(this.T, this)))
                : (this.B = _.og(this.T, this.o, this))),
            (this.A = !0),
            this.h.send(a),
            (this.A = !1);
        } catch (g) {
          tg(this);
        }
      };
      var vg = function (a) {
        return _.C && "number" === typeof a.timeout && void 0 !== a.ontimeout;
      };
      _.pg.prototype.T = function () {
        "undefined" != typeof sb && this.h && (this.dispatchEvent("timeout"), this.abort(8));
      };
      var tg = function (a) {
          a.j = !1;
          a.h && ((a.l = !0), a.h.abort(), (a.l = !1));
          wg(a);
          xg(a);
        },
        wg = function (a) {
          a.I || ((a.I = !0), a.dispatchEvent("complete"), a.dispatchEvent("error"));
        };
      _.pg.prototype.abort = function () {
        this.h &&
          this.j &&
          ((this.j = !1),
          (this.l = !0),
          this.h.abort(),
          (this.l = !1),
          this.dispatchEvent("complete"),
          this.dispatchEvent("abort"),
          xg(this));
      };
      _.pg.prototype.L = function () {
        this.h && (this.j && ((this.j = !1), (this.l = !0), this.h.abort(), (this.l = !1)), xg(this, !0));
        _.pg.R.L.call(this);
      };
      _.pg.prototype.O = function () {
        this.Ya() || (this.M || this.A || this.l ? yg(this) : this.V());
      };
      _.pg.prototype.V = function () {
        yg(this);
      };
      var yg = function (a) {
          if (a.j && "undefined" != typeof sb && (!a.G[1] || 4 != (a.h ? a.h.readyState : 0) || 2 != a.rc()))
            if (a.A && 4 == (a.h ? a.h.readyState : 0)) _.og(a.O, 0, a);
            else if ((a.dispatchEvent("readystatechange"), 4 == (a.h ? a.h.readyState : 0))) {
              a.j = !1;
              try {
                a.Md() ? (a.dispatchEvent("complete"), a.dispatchEvent("success")) : wg(a);
              } finally {
                xg(a);
              }
            }
        },
        xg = function (a, b) {
          if (a.h) {
            ug(a);
            var c = a.h,
              d = a.G[0] ? function () {} : null;
            a.h = null;
            a.G = null;
            b || a.dispatchEvent("ready");
            try {
              c.onreadystatechange = d;
            } catch (e) {}
          }
        },
        ug = function (a) {
          a.h && a.H && (a.h.ontimeout = null);
          a.B && (_.q.clearTimeout(a.B), (a.B = null));
        };
      _.pg.prototype.isActive = function () {
        return !!this.h;
      };
      _.pg.prototype.Md = function () {
        var a = this.rc();
        a: switch (a) {
          case 200:
          case 201:
          case 202:
          case 204:
          case 206:
          case 304:
          case 1223:
            var b = !0;
            break a;
          default:
            b = !1;
        }
        if (!b) {
          if ((a = 0 === a))
            (a = String(this.s).match(_.Cf)[1] || null),
              !a && _.q.self && _.q.self.location && (a = _.q.self.location.protocol.slice(0, -1)),
              (a = !qg.test(a ? a.toLowerCase() : ""));
          b = a;
        }
        return b;
      };
      _.pg.prototype.rc = function () {
        try {
          return 2 < (this.h ? this.h.readyState : 0) ? this.h.status : -1;
        } catch (a) {
          return -1;
        }
      };
      _.pg.prototype.Yc = function () {
        try {
          return this.h ? this.h.responseText : "";
        } catch (a) {
          return "";
        }
      };
      var Ag = function (a) {
        _.A.call(this);
        this.F = a;
        this.B = ag(a);
        this.o = this.s = null;
        this.H = !0;
        this.j = new _.bg(this);
        this.M = [];
        this.A = new Set();
        this.h = [];
        this.O = new zg();
        this.l = [];
        this.D = !1;
        a = (0, _.y)(this.G, this);
        yf.version = a;
      };
      _.w(Ag, _.A);
      var Bg = function (a, b) {
        a.h.length && Me(b, a.h[a.h.length - 1]);
        a.h.push(b);
        Je(
          b,
          function () {
            _.va(this.h, b);
          },
          a
        );
      };
      Ag.prototype.I = function (a, b, c) {
        var d = void 0 === c ? {} : c;
        c = d.gi;
        var e = d.bf,
          f = d.uj;
        a = Cg(this, a, b, d.ci, c);
        Dg(this, a, e, f, c);
      };
      var Cg = function (a, b, c, d, e) {
          d = void 0 === d ? {} : d;
          var f = [];
          Eg(a, b, c, d, void 0 === e ? !1 : e, function (g) {
            f.push(g.jb());
          });
          return f;
        },
        Eg = function (a, b, c, d, e, f, g) {
          g = void 0 === g ? {} : g;
          b = _.v(b);
          for (var h = b.next(); !h.done; h = b.next()) {
            var k = h.value;
            h = c[k];
            (!e && (a.A.has(k) || h.h)) ||
              g[k] ||
              ((g[k] = !0), (k = d[k] ? Object.keys(d[k]) : []), Eg(a, h.j.concat(k), c, d, e, f, g), f(h));
          }
        },
        Dg = function (a, b, c, d, e) {
          e = void 0 === e ? !1 : e;
          var f = [],
            g = new Ce();
          b = [b];
          for (
            var h = function (p, t) {
                for (var r = [], x = 0, K = Math.floor(p.length / t) + 1, P = 0; P < t; P++) {
                  var Ea = (P + 1) * K;
                  r.push(p.slice(x, Ea));
                  x = Ea;
                }
                return r;
              },
              k = b.shift();
            k;

          ) {
            var m = Fg(a, k, !!e, !0);
            if (2e3 >= m.length) {
              if ((k = Gg(a, k, e))) f.push(k), Me(g, k.h);
            } else b = h(k, Math.ceil(m.length / 2e3)).concat(b);
            k = b.shift();
          }
          var n = new Ce();
          Bg(a, n);
          Je(n, function () {
            return Hg(a, f, c, d);
          });
          Ke(
            n,
            function () {
              var p = new Ig();
              p.l = !0;
              p.j = -1;
              Hg(this, [p], c, d);
            },
            a
          );
          Je(g, function () {
            return n.callback();
          });
          g.callback();
        },
        Gg = function (a, b, c) {
          var d = Fg(a, b, !(void 0 === c || !c));
          a.M.push(d);
          b = _.v(b);
          for (c = b.next(); !c.done; c = b.next()) a.A.add(c.value);
          if (a.D)
            (a = _.md(document, "SCRIPT")),
              _.Xa(a, _.$a(d)),
              (a.type = "text/javascript"),
              (a.async = !1),
              document.body.appendChild(a);
          else {
            var e = new Ig(),
              f = new _.pg(0 < a.l.length ? new lg() : void 0);
            a.j.J(f, "success", (0, _.y)(e.B, e, f));
            a.j.J(f, "error", (0, _.y)(e.A, e, f));
            a.j.J(f, "timeout", (0, _.y)(e.D, e));
            dg(a.j, f, "ready", f.U, !1, f);
            f.o = 3e4;
            Jg(a.O, function () {
              f.send(d);
              return e.h;
            });
            return e;
          }
          return null;
        },
        Hg = function (a, b, c, d) {
          for (var e = !1, f, g = !1, h = 0; h < b.length; h++) {
            var k = b[h];
            if (!f && k.l) {
              e = !0;
              f = k.j;
              break;
            } else k.o && (g = !0);
          }
          h = _.wa(a.h);
          (e || g) && -1 != f && (a.h.length = 0);
          if (e) c && c(f);
          else if (g) d && d();
          else for (a = 0; a < b.length; a++) (d = b[a]), Kg(d.s, d.ib) || (c && c(8001));
          (e || g) &&
            -1 != f &&
            _.$b(h, function (m) {
              m.cancel();
            });
        };
      Ag.prototype.L = function () {
        this.j.U();
        delete yf.version;
        _.A.prototype.L.call(this);
      };
      Ag.prototype.G = function () {
        return Vf(this.B, "k");
      };
      var Fg = function (a, b, c, d) {
          d = void 0 === d ? !1 : d;
          var e = _.Df(a.F.match(_.Cf)[3] || null);
          if (0 < a.l.length && !_.ta(a.l, e) && null != e && window.location.hostname != e) throw Error("aa`" + e);
          e = ag(a.B.toString());
          delete e.h.m;
          delete e.h.exm;
          delete e.h.ed;
          Xf(e, "m", b.join(","));
          a.s && (Xf(e, "ck", a.s), a.o && Xf(e, "rs", a.o));
          Xf(e, "d", "0");
          c && ((a = _.cd()), (e.l.zx = a));
          a = e.toString();
          if (d && 0 == a.lastIndexOf("/", 0)) {
            e = document.location.href.match(_.Cf);
            d = e[1];
            b = e[2];
            c = e[3];
            e = e[4];
            var f = "";
            d && (f += d + ":");
            c && ((f += "//"), b && (f += b + "@"), (f += c), e && (f += ":" + e));
            a = f + a;
          }
          return a;
        },
        Kg = function (a, b) {
          var c = "";
          if (1 < a.length && "\n" === a.charAt(a.length - 1)) {
            var d = a.lastIndexOf("\n", a.length - 2);
            0 <= d && (c = a.substring(d + 1, a.length - 1));
          }
          d = c.length - 11;
          if ((0 <= d && c.indexOf("Google Inc.", d) == d) || 0 == c.lastIndexOf("//# sourceMappingURL=", 0))
            try {
              c = window;
              a = a + "\r\n//# sourceURL=" + b;
              a = _.Ya(a);
              var e = _.Pb(a);
              var f = _.Ob(e);
              c.eval(f) === f && c.eval(f.toString());
            } catch (g) {
              return !1;
            }
          else return !1;
          return !0;
        },
        Lg = function (a) {
          var b = _.Df(a.match(_.Cf)[5] || null) || "";
          b = _.Df(Zf(b).match(_.Cf)[5] || null);
          return (
            null === b
              ? 0
              : RegExp("/_/wa/", "g").test(b)
              ? !/\/k=/.test(b)
              : RegExp("(/_/js/)|(/_/ss/)", "g").test(b) && /\/k=/.test(b)
          )
            ? a
            : null;
        },
        Ig = function () {
          this.h = new Ce();
          this.ib = this.s = "";
          this.l = !1;
          this.j = 0;
          this.o = !1;
        };
      Ig.prototype.B = function (a) {
        this.s = a.Yc();
        this.ib = String(a.s);
        this.h.callback();
      };
      Ig.prototype.A = function (a) {
        this.l = !0;
        this.j = a.rc();
        this.h.callback();
      };
      Ig.prototype.D = function () {
        this.o = !0;
        this.h.callback();
      };
      var zg = function () {
          this.h = 0;
          this.j = [];
        },
        Jg = function (a, b) {
          a.j.push(b);
          Mg(a);
        },
        Mg = function (a) {
          for (; 5 > a.h && a.j.length; ) Ng(a, a.j.shift());
        },
        Ng = function (a, b) {
          a.h++;
          Je(
            b(),
            function () {
              this.h--;
              Mg(this);
            },
            a
          );
        };
      var Og = new Tf(!1),
        Pg = document.location.href;
      vf({
        j: { dml: Og },
        initialize: function (a) {
          var b = Og.get(),
            c = "",
            d = "";
          window &&
            window._F_cssRowKey &&
            ((c = window._F_cssRowKey), window._F_combinedSignature && (d = window._F_combinedSignature));
          if (c && "function" !== typeof window._F_installCss) throw Error("Z");
          var e,
            f = _.q._F_jsUrl;
          f && (e = Lg(f));
          !e && (f = document.getElementById("base-js")) && ((e = f.src ? f.src : f.getAttribute("href")), (e = Lg(e)));
          e || (e = Lg(Pg));
          e || ((e = document.getElementsByTagName("script")), (e = Lg(e[e.length - 1].src)));
          if (!e) throw Error("$");
          e = new Ag(e);
          c && (e.s = c);
          d && (e.o = d);
          e.D = b;
          b = ja();
          b.D = e;
          b.Zg(!0);
          b = ja();
          b.pf(a);
          a.l(b);
        },
      });
      _._ModuleManager_initialize = function (a, b) {
        if (!_.fa) {
          if (!_.ha) return;
          _.ia();
        }
        _.fa.nf(a, b);
      };
      _._ModuleManager_initialize(
        "b/sy0/el_conf:1/el_main_css/sy3/sy2:4/sy4:4/el_main:1,3,5,6/corsproxy/website_error/navigationui:5/_stam:6/n73qwf/MpJwZc",
        ["sy0", "el_conf"]
      );
    } catch (e) {
      _._DumpException(e);
    }
    try {
      _.F = {};
      MSG_TRANSLATE = "Translate";
      _.F[0] = MSG_TRANSLATE;
      MSG_CANCEL = "Cancel";
      _.F[1] = MSG_CANCEL;
      MSG_CLOSE = "Close";
      _.F[2] = MSG_CLOSE;
      MSGFUNC_PAGE_TRANSLATED_TO = function (a) {
        return "Google has automatically translated this page to: " + a;
      };
      _.F[3] = MSGFUNC_PAGE_TRANSLATED_TO;
      MSGFUNC_TRANSLATED_TO = function (a) {
        return "Translated to: " + a;
      };
      _.F[4] = MSGFUNC_TRANSLATED_TO;
      MSG_GENERAL_ERROR = "Error: The server could not complete your request. Try again later.";
      _.F[5] = MSG_GENERAL_ERROR;
      MSG_LEARN_MORE = "Learn more";
      _.F[6] = MSG_LEARN_MORE;
      MSGFUNC_POWERED_BY = function (a) {
        return "Powered by " + a;
      };
      _.F[7] = MSGFUNC_POWERED_BY;
      MSG_TRANSLATE_PRODUCT_NAME = "Translate";
      _.F[8] = MSG_TRANSLATE_PRODUCT_NAME;
      MSG_TRANSLATION_IN_PROGRESS = "Translation in progress";
      _.F[9] = MSG_TRANSLATION_IN_PROGRESS;
      MSGFUNC_TRANSLATE_PAGE_TO = function (a) {
        return "Translate this page to: " + a + " using Google Translate?";
      };
      _.F[10] = MSGFUNC_TRANSLATE_PAGE_TO;
      MSGFUNC_VIEW_PAGE_IN = function (a) {
        return "View this page in: " + a;
      };
      _.F[11] = MSGFUNC_VIEW_PAGE_IN;
      MSG_RESTORE = "Show original";
      _.F[12] = MSG_RESTORE;
      MSG_SSL_INFO_LOCAL_FILE =
        "The content of this local file will be sent to Google for translation using a secure connection.";
      _.F[13] = MSG_SSL_INFO_LOCAL_FILE;
      MSG_SSL_INFO_SECURE_PAGE =
        "The content of this secure page will be sent to Google for translation using a secure connection.";
      _.F[14] = MSG_SSL_INFO_SECURE_PAGE;
      MSG_SSL_INFO_INTRANET_PAGE =
        "The content of this intranet page will be sent to Google for translation using a secure connection.";
      _.F[15] = MSG_SSL_INFO_INTRANET_PAGE;
      MSG_SELECT_LANGUAGE = "Select Language";
      _.F[16] = MSG_SELECT_LANGUAGE;
      MSGFUNC_TURN_OFF_TRANSLATION = function (a) {
        return "Turn off " + a + " translation";
      };
      _.F[17] = MSGFUNC_TURN_OFF_TRANSLATION;
      MSGFUNC_TURN_OFF_FOR = function (a) {
        return "Turn off for: " + a;
      };
      _.F[18] = MSGFUNC_TURN_OFF_FOR;
      MSG_ALWAYS_HIDE_AUTO_POPUP_BANNER = "Always hide";
      _.F[19] = MSG_ALWAYS_HIDE_AUTO_POPUP_BANNER;
      MSG_ORIGINAL_TEXT = "Original text:";
      _.F[20] = MSG_ORIGINAL_TEXT;
      MSG_FILL_SUGGESTION = "Contribute a better translation";
      _.F[21] = MSG_FILL_SUGGESTION;
      MSG_SUBMIT_SUGGESTION = "Contribute";
      _.F[22] = MSG_SUBMIT_SUGGESTION;
      MSG_SHOW_TRANSLATE_ALL = "Translate all";
      _.F[23] = MSG_SHOW_TRANSLATE_ALL;
      MSG_SHOW_RESTORE_ALL = "Restore all";
      _.F[24] = MSG_SHOW_RESTORE_ALL;
      MSG_SHOW_CANCEL_ALL = "Cancel all";
      _.F[25] = MSG_SHOW_CANCEL_ALL;
      MSG_TRANSLATE_TO_MY_LANGUAGE = "Translate sections to my language";
      _.F[26] = MSG_TRANSLATE_TO_MY_LANGUAGE;
      MSGFUNC_TRANSLATE_EVERYTHING_TO = function (a) {
        return "Translate everything to " + a;
      };
      _.F[27] = MSGFUNC_TRANSLATE_EVERYTHING_TO;
      MSG_SHOW_ORIGINAL_LANGUAGES = "Show original languages";
      _.F[28] = MSG_SHOW_ORIGINAL_LANGUAGES;
      MSG_OPTIONS = "Options";
      _.F[29] = MSG_OPTIONS;
      MSG_TURN_OFF_TRANSLATION_FOR_THIS_SITE = "Turn off translation for this site";
      _.F[30] = MSG_TURN_OFF_TRANSLATION_FOR_THIS_SITE;
      _.F[31] = null;
      MSG_ALT_SUGGESTION = "Show alternative translations";
      _.F[32] = MSG_ALT_SUGGESTION;
      MSG_ALT_ACTIVITY_HELPER_TEXT = "Click on words above to get alternative translations";
      _.F[33] = MSG_ALT_ACTIVITY_HELPER_TEXT;
      MSG_USE_ALTERNATIVES = "Use";
      _.F[34] = MSG_USE_ALTERNATIVES;
      MSG_DRAG_TIP = "Drag with shift key to reorder";
      _.F[35] = MSG_DRAG_TIP;
      MSG_CLICK_FOR_ALT = "Click for alternative translations";
      _.F[36] = MSG_CLICK_FOR_ALT;
      MSG_DRAG_INSTUCTIONS = "Hold down the shift key, click, and drag the words above to reorder.";
      _.F[37] = MSG_DRAG_INSTUCTIONS;
      MSG_SUGGESTION_SUBMITTED = "Thank you for contributing your translation suggestion to Google Translate.";
      _.F[38] = MSG_SUGGESTION_SUBMITTED;
      MSG_MANAGE_TRANSLATION_FOR_THIS_SITE = "Manage translation for this site";
      _.F[39] = MSG_MANAGE_TRANSLATION_FOR_THIS_SITE;
      MSG_ALT_AND_CONTRIBUTE_ACTIVITY_HELPER_TEXT =
        "Click a word for alternative translations, or double-click to edit directly";
      _.F[40] = MSG_ALT_AND_CONTRIBUTE_ACTIVITY_HELPER_TEXT;
      MSG_ORIGINAL_TEXT_NO_COLON = "Original text";
      _.F[41] = MSG_ORIGINAL_TEXT_NO_COLON;
      _.F[42] = "Translate";
      _.F[43] = "Translate";
      _.F[44] = "Your correction has been submitted.";
      MSG_LANGUAGE_UNSUPPORTED = "Error: The language of the webpage is not supported.";
      _.F[45] = MSG_LANGUAGE_UNSUPPORTED;
      MSG_LANGUAGE_TRANSLATE_WIDGET = "Language Translate Widget";
      _.F[46] = MSG_LANGUAGE_TRANSLATE_WIDGET;
      MSG_RATE_THIS_TRANSLATION = "Rate this translation";
      _.F[47] = MSG_RATE_THIS_TRANSLATION;
      MSG_FEEDBACK_USAGE_FOR_IMPROVEMENT = "Your feedback will be used to help improve Google Translate";
      _.F[48] = MSG_FEEDBACK_USAGE_FOR_IMPROVEMENT;
      MSG_FEEDBACK_SATISFIED_LABEL = "Good translation";
      _.F[49] = MSG_FEEDBACK_SATISFIED_LABEL;
      MSG_FEEDBACK_DISSATISFIED_LABEL = "Poor translation";
      _.F[50] = MSG_FEEDBACK_DISSATISFIED_LABEL;
      MSG_TRANSLATION_NO_COLON = "Translation";
      _.F[51] = MSG_TRANSLATION_NO_COLON;
    } catch (e) {
      _._DumpException(e);
    }
    try {
      _.ma("el_conf");
      var Qg;
      _._exportVersion = function (a) {
        _.Fb("google.translate.v", a);
      };
      _._getCallbackFunction = function (a) {
        return _.tb(a);
      };
      _._exportMessages = function () {
        _.Fb("google.translate.m", _.F);
      };
      Qg = function (a) {
        var b = document.getElementsByTagName("head")[0];
        b || (b = document.body.parentNode.appendChild(document.createElement("head")));
        b.appendChild(a);
      };
      _._loadJs = function (a) {
        var b = _.md(document, "SCRIPT");
        b.type = "text/javascript";
        b.charset = "UTF-8";
        _.Xa(b, _.$a(a));
        Qg(b);
      };
      _._loadCss = function (a) {
        var b = document.createElement("link");
        b.type = "text/css";
        b.rel = "stylesheet";
        b.charset = "UTF-8";
        b.href = a;
        Qg(b);
      };
      _._isNS = function (a) {
        a = a.split(".");
        for (var b = window, c = 0; c < a.length; ++c) if (!(b = b[a[c]])) return !1;
        return !0;
      };
      _._setupNS = function (a) {
        a = a.split(".");
        for (var b = window, c = 0; c < a.length; ++c)
          b.hasOwnProperty
            ? b.hasOwnProperty(a[c])
              ? (b = b[a[c]])
              : (b = b[a[c]] = {})
            : (b = b[a[c]] || (b[a[c]] = {}));
        return b;
      };
      _.Fb("_exportVersion", _._exportVersion);
      _.Fb("_getCallbackFunction", _._getCallbackFunction);
      _.Fb("_exportMessages", _._exportMessages);
      _.Fb("_loadJs", _._loadJs);
      _.Fb("_loadCss", _._loadCss);
      _.Fb("_isNS", _._isNS);
      _.Fb("_setupNS", _._setupNS);
      window.addEventListener &&
        "undefined" == typeof document.readyState &&
        window.addEventListener(
          "DOMContentLoaded",
          function () {
            document.readyState = "complete";
          },
          !1
        );
      _.oa();
    } catch (e) {
      _._DumpException(e);
    }
  }.call(this, this.default_tr));
  // Google Inc.
  (function () {
    let gtConstEvalStartTime = new Date();
    if (_isNS("google.translate.Element")) {
      return;
    }

    (function () {
      const c = _setupNS("google.translate._const");
      c._cest = gtConstEvalStartTime;
      gtConstEvalStartTime = undefined; // hide this eval start time constant
      c._cl = "en-US";
      c._cuc = "cr.googleTranslate.onTranslateElementLoad";
      c._cac = "";
      c._cam = "lib";
      c._ctkk = "467122.627957528";
      const h = "translate.googleapis.com";
      const oph = "translate-pa.googleapis.com";
      const s = "https" + "://";
      c._pah = h;
      c._pas = s;
      const b = s + "translate.googleapis.com";
      const staticPath = "/translate_static/";
      c._pci = b + staticPath + "img/te_ctrl3.gif";
      c._pmi = b + staticPath + "img/mini_google.png";
      c._pbi = b + staticPath + "img/te_bk.gif";
      c._pli = b + staticPath + "img/loading.gif";
      c._ps =
        "https://www.gstatic.com/_/translate_http/_/ss/k\x3dtranslate_http.tr.69JJaQ5G5xA.L.W.O/d\x3d0/rs\x3dAN8SPfpC36MIoWPngdVwZ4RUzeJYZaC7rg/m\x3del_main_css";
      c._plla = oph + "/v1/supportedLanguages";
      c._puh = "translate.google.com";
      c._cnal = {};
      c._vt = false;
      c._tvt = false;
      c._cjlc = _getCallbackFunction("cr.googleTranslate.onLoadJavascript");
      _getCallbackFunction("cr.googleTranslate.onLoadCSS")(c._ps);
      c._cjlc("https://translate.googleapis.com/translate_static/js/element/main.js");
      _exportMessages();
      _exportVersion("TE_20230412");
    })();
  })();
} catch (error) {
  cr.googleTranslate.onTranslateElementError(error);
}
