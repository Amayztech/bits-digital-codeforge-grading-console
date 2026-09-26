/**
 * Band editor.
 *
 * The design decision that matters: the editor exposes exactly seven cutoffs,
 * not sixteen independent Min/Max fields. A band's maximum is derived from the
 * cutoff below it, the top band always reaches 100 and the bottom always starts
 * at 0. Gaps and overlaps are therefore not representable, and each input is
 * clamped to the legal window between its two neighbours so an invalid state
 * cannot be reached even by typing.
 */
(function (root) {
  "use strict";

  var CF = (root.CF = root.CF || {});
  var D = CF.dom;
  var U = CF.util;
  var G = CF.grading;

  var defaults = G.defaults();

  function create(host, opts) {
    var inputs = [];
    var activeBand = -1;
    var refreshers = [];

    function render(state) {
      // Typing must not lose the caret, so remember where focus was.
      var activeEl = document.activeElement;
      var restoreId =
        activeEl && activeEl.id && activeEl.id.indexOf("cutoff-") === 0 ? activeEl.id : null;
      var selStart = restoreId ? activeEl.selectionStart : null;
      var selEnd = restoreId ? activeEl.selectionEnd : null;

      var cutoffs = state.cutoffs;
      var bands = G.bandsFromCutoffs(cutoffs);
      var result = G.gradeAll(state.cohort, cutoffs);
      var impact = G.impact(state.cohort, cutoffs, state.baseline);
      var isDefault = U.deepEqual(cutoffs, defaults);
      var defaultBands = G.defaultBands();

      D.clear(host);
      inputs = [];
      refreshers = [];

      bands.forEach(function (band, i) {
        var count = result.counts[i];
        var pct = U.percent(count, state.cohort.length);
        var delta = impact.bandDelta[i];
        var bandChanged = band.min !== defaultBands[i].min || band.max !== defaultBands[i].max;

        var row = D.el("div.band-row", {
          dataset: {
            band: String(i),
            edited: bandChanged ? "true" : "false",
            active: activeBand === i ? "true" : "false"
          },
          onmouseenter: function () {
            activeBand = i;
            opts.onHover && opts.onHover(i);
          },
          onmouseleave: function () {
            activeBand = -1;
            opts.onHover && opts.onHover(-1);
          }
        }, [
          D.el("div.band-row__grade", null, [
            CF.analysePanel.gradeChip(band.grade, i)
          ]),
          D.el("div.band-row__range-cell", { style: { "min-width": "0" } }, [
            D.el("div.band-row__range", {
              text: G.rangeLabel(band),
              title:
                band.min === band.max
                  ? "Only the mark " + band.min + " falls in this band"
                  : "Marks " + band.min + " to " + band.max + " inclusive"
            }),
            D.el("div.band-row__note", { text: noteForBand(count, state.cohort.length, band) })
          ]),
          D.el("div.band-row__stats", null, [
            D.el("div.band-bar", { "aria-hidden": "true" }, [
              D.el("div.band-bar__fill", {
                style: {
                  width: Math.max(count ? 2 : 0, pct) + "%",
                  background: "var(--grade-" + (i + 1) + ")"
                }
              })
            ]),
            D.el("span.band-count.num", { text: String(count) }),
            D.el("span.band-pct.num", { text: state.cohort.length ? pct.toFixed(pct < 10 ? 1 : 0) + "%" : "—" }),
            delta && delta.delta
              ? D.el("span.band-delta.num", {
                  dataset: { dir: delta.delta > 0 ? "up" : "down" },
                  title: (delta.delta > 0 ? "+" : "") + delta.delta + " against the previous configuration",
                  text: (delta.delta > 0 ? "+" : "") + delta.delta
                })
              : D.el("span.band-delta.num", { text: "" })
          ])
        ]);

        /* --- cutoff control ------------------------------------------- */
        var cutoffCell = D.el("div.band-row__cutoff");
        if (band.editable) {
          var idx = i;
          var input = D.el("input.cutoff__input", {
            type: "number",
            inputmode: "numeric",
            min: "1",
            max: "100",
            step: "1",
            value: String(cutoffs[idx]),
            id: "cutoff-" + G.GRADES[idx],
            "aria-label":
              G.GRADES[idx] + " minimum mark: the lowest mark that earns " + G.GRADES[idx],
            "aria-describedby": "cutoffHelp-" + G.GRADES[idx],
            dataset: { edited: cutoffs[idx] !== defaults[idx] ? "true" : "false" }
          });
          inputs[idx] = input;

          var help = D.el("span.visually-hidden", { id: "cutoffHelp-" + G.GRADES[idx] });
          help.textContent =
            "Arrow keys change the cutoff by one mark; hold Shift for five. The legal range for " +
            G.GRADES[idx] + " is shown by the step buttons.";

          var stepper = D.el("div.cutoff__pair");
          var dec = D.el("button.cutoff__step", {
            type: "button",
            tabindex: "-1",
            "aria-label": "Lower the " + G.GRADES[idx] + " cutoff by one mark",
            onClick: function () {
              submit(idx, currentValue() - 1, "button");
            }
          }, [D.icon("chevron-down", 13)]);
          var inc = D.el("button.cutoff__step", {
            type: "button",
            tabindex: "-1",
            "aria-label": "Raise the " + G.GRADES[idx] + " cutoff by one mark",
            onClick: function () {
              submit(idx, currentValue() + 1, "button");
            }
          }, [D.el("span", { style: { transform: "rotate(-90deg)", display: "inline-flex" } }, [D.icon("chevron", 13)])]);
          stepper.appendChild(dec);
          stepper.appendChild(inc);

          function currentValue() {
            var live = opts.getCutoffs();
            return live[idx];
          }

          function sync(liveCutoffs) {
            var win = G.windowFor(liveCutoffs, idx);
            input.min = String(win.lo);
            input.max = String(win.hi);
            input.value = String(liveCutoffs[idx]);
            input.dataset.edited = liveCutoffs[idx] !== defaults[idx] ? "true" : "false";
            dec.disabled = liveCutoffs[idx] <= win.lo;
            inc.disabled = liveCutoffs[idx] >= win.hi;
          }

          input.addEventListener("input", function () {
            submit(idx, input.value, "input");
          });
          input.addEventListener("keydown", function (e) {
            if (e.key === "Enter") {
              e.preventDefault();
              input.blur();
              return;
            }
            // A number input's own arrow handling would move the value without
            // telling the model, so every direction key is handled here.
            var step = e.shiftKey ? 5 : 1;
            var current = currentValue();
            var next = null;
            if (e.key === "ArrowUp" || e.key === "ArrowRight") next = current + step;
            else if (e.key === "ArrowDown" || e.key === "ArrowLeft") next = current - step;
            else if (e.key === "PageUp") next = current + 10;
            else if (e.key === "PageDown") next = current - 10;
            else if (e.key === "Home") next = 1;
            else if (e.key === "End") next = 100;
            if (next === null) return;
            e.preventDefault();
            submit(idx, next, "keyboard");
          });
          input.addEventListener("blur", function () {
            // Snap the field to whatever the model actually accepted.
            sync(opts.getCutoffs());
          });

          var box = D.el("div.cutoff", null, [stepper, input, help]);
          box._sync = sync;
          refreshers.push(box);
          cutoffCell.appendChild(box);
        } else {
          cutoffCell.appendChild(
            D.el("div", { style: { display: "flex", "justify-content": "flex-end" } }, [
              D.el("span.cutoff__locked", { title: "The bottom band always starts at 0", text: "Min 0" })
            ])
          );
        }

        row.appendChild(cutoffCell);
        host.appendChild(row);
      });

      function refreshAll() {
        var live = opts.getCutoffs();
        refreshers.forEach(function (box) {
          box._sync(live);
        });
      }

      function submit(idx, value, source) {
        opts.onCutoff(idx, value, source);
      }

      if (restoreId) {
        var again = document.getElementById(restoreId);
        if (again) {
          again.focus();
          try {
            if (selStart !== null) again.setSelectionRange(selStart, selEnd);
          } catch (e) {
            /* number inputs do not support selection ranges in every engine */
          }
        }
      }
    }

    /** Update the displayed values without rebuilding (used after undo). */
    function syncInputs() {
      refreshers.forEach(function (box) {
        box._sync(opts.getCutoffs());
      });
    }

    function focusGrade(grade) {
      var i = G.GRADES.indexOf(grade);
      if (i >= 0 && inputs[i]) {
        inputs[i].focus();
        inputs[i].select();
      }
    }

    return { render: render, syncInputs: syncInputs, focusGrade: focusGrade };
  }

  function noteForBand(count, total, band) {
    if (!total) return "no students";
    if (count === 0) return "empty band";
    if (band.min === band.max) return "1 mark only";
    var pct = U.percent(count, total);
    if (pct < 5) return pct.toFixed(1) + "% of the class";
    if (pct > 80) return "most of the class";
    return pct.toFixed(0) + "% of the class";
  }

  CF.bandEditor = { create: create };
})(typeof globalThis !== "undefined" ? globalThis : this);
