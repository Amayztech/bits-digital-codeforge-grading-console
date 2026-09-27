/**
 * Live impact panel and audit trail.
 *
 * Answers the question the starter could never answer: "if I move this cutoff,
 * what actually happens to my students?" It shows the number of students whose
 * grade changes, the direction of the change, the per-band before/after table
 * and the affected students themselves - and it says nothing at all when the
 * configuration matches the baseline, so a clean state stays clean.
 */
(function (root) {
  "use strict";

  var CF = (root.CF = root.CF || {});
  var D = CF.dom;
  var U = CF.util;
  var G = CF.grading;

  // What the previous render showed, so only genuinely new information
  // animates: a figure that changed, a student who has just started moving.
  var lastFigure = null;
  var lastMoved = null;

  function renderImpact(host, opts) {
    var state = opts;
    D.clear(host);

    var impact = G.impact(state.cohort, state.cutoffs, state.baseline);
    var bands = G.bandsFromCutoffs(state.cutoffs);
    var isDefault = U.deepEqual(state.cutoffs, G.defaults());

    /* --- headline ------------------------------------------------------ */
    if (!state.cohort.length) {
      host.appendChild(D.emptyState("users", "No students to affect", "Select a course to see the effect of a cutoff change."));
      return;
    }

    if (impact.changed === 0) {
      lastFigure = 0;
      host.appendChild(
        D.el("div.impact__banner", { dataset: { state: "clean" } }, [
          D.el("span.impact__mark", { "aria-hidden": "true" }, [D.icon("check", 12)]),
          D.el("div", null, [
            D.el("p.impact__title", { text: "No students are affected" }),
            D.el("p.impact__caption", {
              text: isDefault
                ? "These are the default bands, so no student has moved yet."
                : "Against the previous configuration, every student keeps the same grade."
            })
          ])
        ])
      );
    } else {
      var bumped = lastFigure !== null && lastFigure !== impact.changed;
      lastFigure = impact.changed;
      host.appendChild(
        D.el("div.impact__banner", { dataset: { state: "changed" } }, [
          D.el("div.impact__figure", { dataset: bumped ? { bump: "true" } : null, text: String(impact.changed) }),
          D.el("div.impact__lead", null, [
            D.el("p.impact__title", { text: impact.changed === 1 ? "student changes grade" : "students change grade" }),
            D.el("p.impact__caption", {
              text: "of " + impact.total + " · against the " + (opts.baselineLabel || "previous configuration")
            })
          ]),
          D.el("div.impact-split", null, [
            D.el("div.impact-split__item", { dataset: { dir: "up", zero: impact.up ? "false" : "true" } }, [
              D.el("span.impact-split__icon", { "aria-hidden": "true" }, [D.icon("arrow-up", 11)]),
              D.el("p.impact-split__n", { text: String(impact.up) }),
              D.el("p.impact-split__label", { text: "moved up" })
            ]),
            D.el("div.impact-split__item", { dataset: { dir: "down", zero: impact.down ? "false" : "true" } }, [
              D.el("span.impact-split__icon", { "aria-hidden": "true" }, [D.icon("arrow-down", 11)]),
              D.el("p.impact-split__n", { text: String(impact.down) }),
              D.el("p.impact-split__label", { text: "moved down" })
            ])
          ])
        ])
      );
    }

    /* --- before / after distribution ----------------------------------- */
    if (opts.baseline) {
      var baseBands = G.bandsFromCutoffs(opts.baseline);
      var peak = 1;
      impact.bandDelta.forEach(function (d) {
        peak = Math.max(peak, d.count || 0, d.before || 0);
      });
      var table = D.el("table.diff.diff--impact");
      table.appendChild(D.el("caption.visually-hidden", { text: "Students per band, before and after the last change" }));
      var thead = D.el("thead");
      thead.appendChild(
        D.el("tr", null, [
          D.el("th", { scope: "col", text: "Grade" }),
          D.el("th.num", { scope: "col", text: "Marks" }),
          D.el("th.diff__dist", { scope: "col" }, [
            D.el("span.diff__key", null, [D.el("i.diff__key-before", { "aria-hidden": "true" }), "Before"]),
            D.el("span.diff__key", null, [D.el("i.diff__key-now", { "aria-hidden": "true" }), "Now"])
          ]),
          D.el("th.num", { scope: "col", text: "Before" }),
          D.el("th.num", { scope: "col", text: "Now" }),
          D.el("th.num", { scope: "col", text: "Change" })
        ])
      );
      table.appendChild(thead);
      var tbody = D.el("tbody");
      bands.forEach(function (b, i) {
        var beforeRange = CF.analysePanel.range(baseBands[i]);
        var nowRange = CF.analysePanel.range(b);
        var rangeChanged = beforeRange !== nowRange;
        var d = impact.bandDelta[i];
        var before = d && d.before !== null ? d.before : 0;
        tbody.appendChild(
          D.el("tr", { dataset: { changed: rangeChanged ? "true" : "false" } }, [
            D.el("td", null, [CF.analysePanel.gradeChip(b.grade, i)]),
            D.el("td.num", null, [
              rangeChanged
                ? D.el("span.diff__range", null, [
                    D.el("span.diff__was", { text: beforeRange }),
                    D.el("span.diff__arrow", { "aria-hidden": "true", text: "→" }),
                    D.el("span.diff__is", { text: nowRange })
                  ])
                : D.el("span", { text: nowRange })
            ]),
            D.el("td.diff__dist", { "aria-hidden": "true" }, [
              D.el("span.diff__bar.diff__bar--before", { style: { width: (before / peak) * 100 + "%" } }),
              D.el("span.diff__bar.diff__bar--now", {
                style: { width: (d.count / peak) * 100 + "%", background: "var(--grade-" + (i + 1) + ")" }
              })
            ]),
            D.el("td.num.diff__before", { text: d && d.before !== null ? String(d.before) : "—" }),
            D.el("td.num.diff__now", { text: String(d.count) }),
            D.el("td.num", null, [
              d && d.delta
                ? D.el("span.diff__delta", { dataset: { dir: d.delta > 0 ? "up" : "down" }, text: (d.delta > 0 ? "+" : "−") + Math.abs(d.delta) })
                : D.el("span.diff__none", { text: "—" })
            ])
          ])
        );
      });
      table.appendChild(tbody);
      // Scroll the table, not the page, where six columns do not fit.
      host.appendChild(D.el("div.diff-wrap", null, table));
    } else {
      host.appendChild(
        D.el("p.impact__hint", {
          text: "Move a boundary to compare every band's range and count with the previous configuration."
        })
      );
    }

    /* --- affected students -------------------------------------------- */
    if (impact.moved.length) {
      var moved = impact.moved.slice().sort(function (a, b) {
        if (a.marks !== b.marks) return b.marks - a.marks;
        return a.id.localeCompare(b.id, undefined, { numeric: true });
      });
      var seen = lastMoved;
      var listTable = D.el("table.data.data--compact");
      var lt = D.el("thead");
      lt.appendChild(
        D.el("tr", null, [
          D.el("th", { scope: "col", text: "BITS ID" }),
          D.el("th.num", { scope: "col", text: "Marks" }),
          D.el("th", { scope: "col", text: "Grade" }),
          D.el("th", { scope: "col" }, [D.el("span.visually-hidden", { text: "Direction" })])
        ])
      );
      listTable.appendChild(lt);
      var lb = D.el("tbody");
      moved.slice(0, 60).forEach(function (m) {
        var key = m.id + ":" + m.from + ">" + m.to;
        lb.appendChild(
          D.el("tr", { dataset: seen && !seen[key] ? { fresh: "true" } : null }, [
            D.el("td.cell-id", { text: m.id }),
            D.el("td.num.cell-strong", { text: String(m.marks) }),
            D.el("td", null, [
              D.el("span.grade-move", null, [
                CF.analysePanel.gradeChip(m.from, G.GRADES.indexOf(m.from)),
                D.el("span.grade-move__arrow", { "aria-hidden": "true" }, [D.icon("arrow-right", 11)]),
                CF.analysePanel.gradeChip(m.to, G.GRADES.indexOf(m.to))
              ])
            ]),
            D.el("td.impact__dir", { dataset: { dir: m.dir } }, [
              D.el("span.row-marker", null, [
                D.icon(m.dir === "up" ? "arrow-up" : "arrow-down", 11),
                m.dir === "up" ? "up" : "down"
              ])
            ])
          ])
        );
      });
      lastMoved = {};
      moved.forEach(function (m) {
        lastMoved[m.id + ":" + m.from + ">" + m.to] = true;
      });
      listTable.appendChild(lb);
      host.appendChild(
        D.el("details.disclosure.impact__students", { open: impact.moved.length <= 8 ? true : null }, [
          D.el("summary.disclosure__summary", null, [
            D.el("span.disclosure__chev", { "aria-hidden": "true" }, [D.icon("chevron", 14)]),
            "Students whose grade changes",
            D.el("span.disclosure__count", { text: String(impact.moved.length) })
          ]),
          D.el("div.disclosure__body", null, [
            D.el("div.table-scroll.impact__list", null, listTable),
            impact.moved.length > 60
              ? D.el("p.table-foot", { text: "Showing the first 60. The export and the final review always list every student." })
              : null
          ])
        ])
      );
    } else {
      lastMoved = {};
    }

    return impact;
  }

  /* ==================================================================== *
   * Audit trail
   * ==================================================================== */

  function renderHistory(host, history, opts) {
    D.clear(host);
    if (!history.length) {
      host.appendChild(
        D.el("p.audit-empty", null, [
          D.el("span", { "aria-hidden": "true" }, [D.icon("clock", 14)]),
          "No changes yet. Every boundary you move is logged here and can be undone."
        ])
      );
      return;
    }
    var list = D.el("ol.audit-list", { "aria-label": "Changes, newest first" });
    history
      .slice()
      .reverse()
      .forEach(function (h, n) {
        // "A minimum: 80 → 81" is set as a label and a transition so the
        // numbers line up down the log. Other entries keep their sentence.
        var parts = /^(.+?):\s*(\d+)\s*→\s*(\d+)(.*)$/.exec(h.text || "");
        var text = parts
          ? D.el("span.audit-item__text", null, [
              D.el("span.audit-item__what", { text: parts[1] }),
              D.el("span.audit-item__change", null, [
                D.el("span.audit-item__from", { text: parts[2] }),
                D.el("span.audit-item__arrow", { "aria-hidden": "true", text: "→" }),
                D.el("span.audit-item__to", { text: parts[3] })
              ]),
              parts[4] ? D.el("span.audit-item__note", { text: parts[4].trim() }) : null
            ])
          : D.el("span.audit-item__text", { text: h.text });
        // The compact summary is only worth a column when it says something the
        // description does not.
        var showSummary = !parts && h.summary && h.text.indexOf(h.summary) === -1;
        var item = D.el("li.audit-item", { dataset: n === 0 ? { latest: "true" } : null }, [
          D.el("span.audit-item__time", { text: h.time }),
          text,
          showSummary ? D.el("span.audit-item__summary", { text: h.summary, title: h.summary }) : null
        ]);
        if (opts.canUndo) {
          var btn = D.button({
            label: "Undo",
            variant: "ghost",
            size: "sm",
            onClick: function () {
              opts.onUndo(h.id);
            }
          });
          btn.classList.add("audit-item__undo");
          btn.setAttribute("aria-label", "Undo: " + h.text);
          item.appendChild(btn);
        }
        list.appendChild(item);
      });
    host.appendChild(list);
  }

  CF.impactPanel = { renderImpact: renderImpact, renderHistory: renderHistory };
})(typeof globalThis !== "undefined" ? globalThis : this);
