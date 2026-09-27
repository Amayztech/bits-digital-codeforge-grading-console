/**
 * Minimal DOM helpers.
 * Deliberately not a framework: the console needs element creation, safe text
 * setting and event binding, and nothing else.
 */
(function (root) {
  "use strict";

  var CF = (root.CF = root.CF || {});
  var SVG_NS = "http://www.w3.org/2000/svg";

  /**
   * el("div.panel", {id:"x"}, [child, "text"])
   * Text is always assigned through textContent, so imported data can never
   * become markup.
   */
  function el(spec, attrs, children) {
    var parts = String(spec).split(/(?=[.#])/);
    var tag = parts[0] || "div";
    var node = document.createElement(tag);
    for (var i = 1; i < parts.length; i++) {
      var p = parts[i];
      if (p[0] === ".") node.classList.add(p.slice(1));
      else if (p[0] === "#") node.id = p.slice(1);
    }
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === "text") node.textContent = String(v);
        else if (k === "html") throw new Error("el(): raw html is not allowed");
        // class is additive: a modifier must never wipe the base classes that
        // came from the selector.
        else if (k === "class") {
          String(v)
            .split(/\s+/)
            .filter(Boolean)
            .forEach(function (c) {
              node.classList.add(c);
            });
        } else if (k === "dataset") {
          for (var d in v) if (Object.prototype.hasOwnProperty.call(v, d)) node.dataset[d] = v[d];
        } else if (k === "style" && typeof v === "object") {
          for (var s in v) if (Object.prototype.hasOwnProperty.call(v, s)) node.style.setProperty(s, v[s]);
        } else if (k.slice(0, 2) === "on" && typeof v === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v === true) node.setAttribute(k, "");
        else node.setAttribute(k, String(v));
      }
    }
    append(node, children);
    return node;
  }

  function append(node, children) {
    if (children === null || children === undefined || children === false) return node;
    if (Array.isArray(children)) {
      children.forEach(function (c) {
        append(node, c);
      });
      return node;
    }
    if (children instanceof Node) node.appendChild(children);
    else node.appendChild(document.createTextNode(String(children)));
    return node;
  }

  function svgEl(tag, attrs, children) {
    var node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === "text") node.textContent = String(v);
        // SVG elements need their data-* attributes set too; stringifying the
        // object left every cutoff grip without its data-cutoff hook, so
        // pointer dragging could never find the handle it started on.
        else if (k === "dataset") {
          for (var d in v) {
            if (Object.prototype.hasOwnProperty.call(v, d) && v[d] !== null && v[d] !== undefined) node.dataset[d] = v[d];
          }
        } else if (k === "style" && typeof v === "object") {
          for (var s in v) if (Object.prototype.hasOwnProperty.call(v, s)) node.style.setProperty(s, v[s]);
        } else node.setAttribute(k, String(v));
      }
    }
    append(node, children);
    return node;
  }

  /** Inline icon reference. */
  function icon(name, size) {
    var s = size || 16;
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", s);
    svg.setAttribute("height", s);
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    var use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", "#i-" + name);
    svg.appendChild(use);
    return svg;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function $(sel, rootNode) {
    return (rootNode || document).querySelector(sel);
  }

  function $$(sel, rootNode) {
    return Array.prototype.slice.call((rootNode || document).querySelectorAll(sel));
  }

  function on(target, type, handler, opts) {
    target.addEventListener(type, handler, opts);
    return function off() {
      target.removeEventListener(type, handler, opts);
    };
  }

  /** Button with an icon and consistent accessible naming. */
  function button(opts) {
    var b = el("button", {
      type: opts.type || "button",
      class: "btn " + (opts.variant ? "btn--" + opts.variant : "") + (opts.size ? " btn--" + opts.size : "") + (opts.block ? " btn--block" : ""),
      id: opts.id || null,
      disabled: opts.disabled || false,
      title: opts.title || null,
      "aria-describedby": opts.describedBy || null
    });
    if (opts.icon) b.appendChild(icon(opts.icon, opts.iconSize || 15));
    if (opts.label) b.appendChild(document.createTextNode(opts.label));
    if (opts.ariaLabel && !opts.label) b.setAttribute("aria-label", opts.ariaLabel);
    if (opts.onClick) b.addEventListener("click", opts.onClick);
    return b;
  }

  function badge(text, tone, opts) {
    return el("span.badge", {
      class: tone ? "badge--" + tone : "",
      title: opts && opts.title ? opts.title : null
    }, text);
  }

  function notice(tone, iconName, title, bodyChildren) {
    var n = el("div.notice", { class: "notice--" + tone, role: tone === "danger" ? "alert" : null });
    var ic = el("span.notice__icon", { "aria-hidden": "true" });
    ic.appendChild(icon(iconName, 17));
    n.appendChild(ic);
    var body = el("div.notice__body");
    if (title) body.appendChild(el("strong.notice__title", { text: title }));
    append(body, bodyChildren);
    n.appendChild(body);
    return n;
  }

  function emptyState(iconName, title, text) {
    return el("div.empty", null, [
      el("div.empty__icon", { "aria-hidden": "true" }, [icon(iconName, 21)]),
      el("p.empty__title", { text: title }),
      text ? el("p.empty__text", { text: text }) : null
    ]);
  }

  function metric(label, value, note, tone) {
    return el("div.metric", { dataset: tone ? { tone: tone } : null }, [
      el("p.metric__label", { text: label }),
      el("p.metric__value", { text: value }),
      note ? el("p.metric__note", { text: note }) : null
    ]);
  }

  function statTile(label, value, opts) {
    opts = opts || {};
    return el("div.stat", { class: opts.accent ? "stat--accent" : "" }, [
      el("p.stat__label", null, [label, opts.title ? badge(opts.title, "neutral") : null]),
      el("p.stat__value", { class: opts.text ? "stat__value--text" : "" }, [
        String(value),
        opts.unit ? el("span.stat__unit", { text: opts.unit }) : null
      ]),
      opts.note ? el("p.stat__note", { text: opts.note }) : null
    ]);
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: (mime || "text/csv") + ";charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = el("a", { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoking immediately can cancel the download in some browsers.
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 4000);
  }

  CF.dom = {
    el: el,
    append: append,
    svg: svgEl,
    icon: icon,
    clear: clear,
    $: $,
    $$: $$,
    on: on,
    button: button,
    badge: badge,
    notice: notice,
    emptyState: emptyState,
    metric: metric,
    statTile: statTile,
    download: download
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
