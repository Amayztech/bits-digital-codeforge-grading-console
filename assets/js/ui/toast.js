/**
 * Toasts - the only transient feedback channel. Replaces the starter's browser
 * alert() spam with something that does not block, does not steal focus and can
 * offer an undo.
 */
(function (root) {
  "use strict";

  var CF = (root.CF = root.CF || {});
  var D = CF.dom;
  var reduceMotion =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  var ICONS = {
    success: "check-circle",
    danger: "error",
    warning: "alert",
    info: "info"
  };

  var MAX_VISIBLE = 3;

  function show(opts) {
    var region = document.getElementById("toastRegion");
    if (!region) return;
    var tone = opts.tone || "info";
    var node = D.el("div.toast", { class: "toast--" + tone, role: "status" }, null);
    var ic = D.el("span.toast__icon", { "aria-hidden": "true" }, [D.icon(ICONS[tone] || "info", 17)]);
    node.appendChild(ic);
    var body = D.el("div.toast__body");
    if (opts.title) body.appendChild(D.el("div.toast__title", { text: opts.title }));
    if (opts.message) body.appendChild(D.el("div", { text: opts.message }));
    node.appendChild(body);

    if (opts.actionLabel && opts.onAction) {
      var action = D.el("div.toast__action");
      var btn = D.el("button", { type: "button", text: opts.actionLabel });
      btn.addEventListener("click", function () {
        opts.onAction();
        dismiss(node);
      });
      action.appendChild(btn);
      node.appendChild(action);
    }

    region.appendChild(node);
    // Never let the stack cover the workspace.
    while (region.children.length > MAX_VISIBLE) {
      dismiss(region.firstElementChild);
      if (region.children.length > MAX_VISIBLE) region.removeChild(region.firstElementChild);
    }
    var ttl = opts.ttl === 0 ? 0 : opts.ttl || (opts.actionLabel ? 8000 : 4200);
    if (ttl > 0) setTimeout(function () { dismiss(node); }, ttl);
    return node;
  }

  function dismiss(node) {
    if (!node || !node.parentNode) return;
    if (reduceMotion) {
      node.parentNode.removeChild(node);
      return;
    }
    node.dataset.leaving = "true";
    setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, 200);
  }

  CF.toast = {
    show: show,
    success: function (t, m, o) { return show(Object.assign({ tone: "success", title: t, message: m }, o || {})); },
    error: function (t, m, o) { return show(Object.assign({ tone: "danger", title: t, message: m }, o || {})); },
    warn: function (t, m, o) { return show(Object.assign({ tone: "warning", title: t, message: m }, o || {})); },
    info: function (t, m, o) { return show(Object.assign({ tone: "info", title: t, message: m }, o || {})); }
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
