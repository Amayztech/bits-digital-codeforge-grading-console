/**
 * A single accessible modal.
 *
 * The starter used two stacked window.confirm() calls for one reset. This
 * dialog is used once per interaction, traps focus, restores focus on close and
 * can be dismissed with Escape.
 */
(function (root) {
  "use strict";

  var CF = (root.CF = root.CF || {});
  var D = CF.dom;
  var lastFocused = null;

  var FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function open(config) {
    close();

    var titleId = "modalTitle-" + Date.now();
    var bodyId = "modalBody-" + Date.now();
    lastFocused = document.activeElement;

    var body = D.el("div.modal__body", { id: bodyId });
    D.append(body, config.body);

    var head = D.el("div.modal__head", null, [
      D.el("div", { style: { flex: "1 1 auto", "min-width": "0" } }, [
        D.el("h2.modal__title", { id: titleId, text: config.title })
      ])
    ]);
    if (config.icon) {
      var ic = D.el("span", { "aria-hidden": "true", style: { color: config.iconTone || "var(--c-ink-500)", "margin-top": "2px" } }, [
        D.icon(config.icon, 20)
      ]);
      head.insertBefore(ic, head.firstChild);
    }

    var foot = D.el("div.modal__foot");
    (config.actions || []).forEach(function (a) {
      var b = D.button({
        label: a.label,
        variant: a.variant,
        icon: a.icon,
        onClick: function () {
          if (a.onClick) a.onClick(close);
          else close();
        }
      });
      foot.appendChild(b);
    });

    var modal = D.el("div.modal", {
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": titleId,
      "aria-describedby": bodyId
    }, [head, body, foot]);

    var backdrop = D.el("div.modal-backdrop", {
      onMousedown: function (e) {
        if (e.target === backdrop && config.dismissible !== false) close();
      }
    }, modal);

    document.getElementById("modalRoot").appendChild(backdrop);
    document.body.dataset.modalOpen = "true";

    backdrop.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && config.dismissible !== false) {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      var items = D.$$(FOCUSABLE, modal).filter(function (n) {
        return n.offsetParent !== null;
      });
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });

    var target = config.focus ? D.$(config.focus, modal) : null;
    (target || D.$$(FOCUSABLE, modal)[0] || modal).focus();
    return close;
  }

  function close() {
    var root = document.getElementById("modalRoot");
    if (!root) return;
    D.clear(root);
    document.body.removeAttribute("data-modal-open");
    if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
    lastFocused = null;
  }

  function isOpen() {
    var root = document.getElementById("modalRoot");
    return !!(root && root.firstChild);
  }

  CF.modal = { open: open, close: close, isOpen: isOpen };
})(typeof globalThis !== "undefined" ? globalThis : this);
