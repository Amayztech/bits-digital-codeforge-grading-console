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

  function renderImpact(host, opts) {
    var state = opts;
    D.clear(host);

    var impact = G.impact(state.cohort, state.cutoffs, state.baseline);
    var bands = G.bandsFromCutoffs(state.cutoffs);
    var isDefault = U.deepEqual(state.cutoffs, G.defaults());

    /* --- headline banner --------------------------------------------- */
    if (!state.cohort.length) {
      host.appendChild(D.emptyState("users", "No students to affect", "Select a course to see the effect of a cutoff change."));
      return;
    }

    if (impact.changed === 0) {
      host.appendChild(
        D.el("div.impact__banner", { dataset: { state: "clean" } }, [
          D.el("div", { style: { flex: "none" } }, [
            D.el("span", { style: { color: "var(--c-success)", display: "inline-flex" }, "aria-hidden": "true" }, [D.icon("check-circle", 24)])
          ]),
          D.el("div", null, [
            D.el("p.impact__caption", { style: { "font-size": "var(--fs-base)", "font-weight": "650", color: "var(--c-ink-900)" }, text: "No students are affected" }),
            D.el("p.impact__caption", {
              text: isDefault
                ? "These are the challenge's default bands, so no student has moved yet."
                : "Compared with the previous configuration, every student keeps the same grade."
            })
          ])
        ])
      );
    } else {
      host.appendChild(
        D.el("div.impact__banner", { dataset: { state: "changed" } }, [
          D.el("div.impact__figure", { text: String(impact.changed) }),
          D.el("div", null, [
            D.el("p.impact__caption", { style: { "font-size": "var(--fs-base)", "font-weight": "650", color: "var(--c-ink-900)" } }, [
              U.pluralise(impact.changed, "student") + " change grade"
            ]),
            D.el("p.impact__caption", {
              text:
                "of " +
                impact.total +
                " compared with the " +
                (opts.baselineLabel || "previous configuration") +
                "."
            })
          ])
        ])
      );
      host.appendChild(
        D.el("div.impact-split", null, [
          D.el("div.impact-split__item", { dataset: { dir: "up" } }, [
            D.el("p.impact-split__n", { text: String(impact.up) }),
            D.el("p.impact-split__label", { text: "moved up" })
          ]),
          D.el("div.impact-split__item", { dataset: { dir: "down" } }, [
            D.el("p.impact-split__n", { text: String(impact.down) }),
            D.el("p.impact-split__label", { text: "moved down" })
          ])
        ])
      );
    }

    /* --- before / after table ---------------------------------------- */
    if (opts.baseline) {
      var baseBands = G.bandsFromCutoffs(opts.baseline);
      var table = D.el("table.diff");
      var thead = D.el("thead");
      thead.appendChild(
        D.el("tr", null, [
          D.el("th", { scope: "col", text: "Grade" }),
          D.el("th.num", { scope: "col", text: "Marks" }),
          D.el("th.num", { scope: "col", text: "Before" }),
          D.el("th.diff__arrow", { "aria-hidden": "true", text: "" }),
          D.el("th.num", { scope: "col", text: "Now" }),
          D.el("th.num", { scope: "col", text: "Change" })
        ])
      );
      table.appendChild(thead);
      var tbody = D.el("tbody");
      bands.forEach(function (b, i) {
        var beforeRange = G.rangeLabel(baseBands[i]);
        var nowRange = G.rangeLabel(b);
        var rangeChanged = beforeRange !== nowRange;
        var d = impact.bandDelta[i];
        tbody.appendChild(
          D.el("tr", { dataset: { changed: rangeChanged ? "true" : "false" } }, [
            D.el("td", null, [CF.analysePanel.gradeChip(b.grade, i)]),
            D.el("td.num", null, [
              rangeChanged
                ? D.el("span", null, [
                    D.el("span", { style: { color: "var(--c-ink-400)" }, text: beforeRange }),
                    D.el("span.diff__arrow", { text: " → " }),
                    D.el("span", { style: { "font-weight": "650" }, text: nowRange })
                  ])
                : D.el("span", { text: nowRange })
            ]),
            D.el("td.num", { text: d && d.before !== null ? String(d.before) : "—" }),
            D.el("td.diff__arrow", { "aria-hidden": "true" }, [D.icon("arrow-right", 12)]),
            D.el("td.num", { style: { "font-weight": "650" }, text: String(impact.bandDelta[i].count) }),
            D.el("td.num", null, [
              d && d.delta
                ? D.el("span", {
                    style: { color: d.delta > 0 ? "var(--c-success)" : "var(--c-danger)", "font-weight": "700" },
                    text: (d.delta > 0 ? "+" : "") + d.delta
                  })
                : D.el("span", { style: { color: "var(--c-ink-400)" }, text: "—" })
            ])
          ])
        );
      });
      table.appendChild(tbody);
      host.appendChild(table);
    } else {
      host.appendChild(
        D.el("p.field__hint", {
          text: "Change a cutoff and this table will show every band's marks and student count against the previous configuration."
        })
      );
    }

    /* --- affected students ------------------------------------------- */
    if (impact.moved.length) {
      var moved = impact.moved.slice().sort(function (a, b) {
        if (a.marks !== b.marks) return b.marks - a.marks;
        return a.id.localeCompare(b.id, undefined, { numeric: true });
      });
      var listTable = D.el("table.data");
      var lt = D.el("thead");
      lt.appendChild(
        D.el("tr", null, [
          D.el("th", { scope: "col", text: "BITS ID" }),
          D.el("th.num", { scope: "col", text: "Marks" }),
          D.el("th", { scope: "col", text: "Change" })
        ])
      );
      listTable.appendChild(lt);
      var lb = D.el("tbody");
      moved.slice(0, 60).forEach(function (m) {
        lb.appendChild(
          D.el("tr", null, [
            D.el("td.cell-id", { text: m.id }),
            D.el("td.num.cell-strong", { text: String(m.marks) }),
            D.el("td", null, [
              D.el("span.cluster", { style: { gap: "6px" } }, [
                CF.analysePanel.gradeChip(m.from, G.GRADES.indexOf(m.from)),
                D.el("span", { "aria-hidden": "true", style: { color: "var(--c-ink-400)" } }, [D.icon("arrow-right", 12)]),
                CF.analysePanel.gradeChip(m.to, G.GRADES.indexOf(m.to)),
                D.el("span.row-marker", { style: { color: m.dir === "up" ? "var(--c-success)" : "var(--c-danger)" } }, [
                  D.icon(m.dir === "up" ? "arrow-up" : "arrow-down", 11),
                  m.dir === "up" ? "up" : "down"
                ])
              ])
            ])
          ])
        );
      });
      listTable.appendChild(lb);
      host.appendChild(
        D.el("details.disclosure", { open: impact.moved.length <= 8 ? true : null }, [
          D.el("summary.disclosure__summary", null, [
            D.el("span.disclosure__chev", { "aria-hidden": "true" }, [D.icon("chevron", 14)]),
            "Students whose grade changes",
            D.el("span.disclosure__count", { text: String(impact.moved.length) })
          ]),
          D.el("div.disclosure__body", null, [
            D.el("div.table-wrap.table-scroll", null, listTable),
            impact.moved.length > 60
              ? D.el("p.field__hint", { style: { "margin-top": "var(--sp-3)" }, text: "Showing the first 60. The export and the final review always list every student." })
              : null
          ])
        ])
      );
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
        D.el("div", { style: { display: "flex", "align-items": "center", gap: "var(--sp-3)", padding: "var(--sp-2) 0" } }, [
          D.el("span", { style: { color: "var(--c-ink-400)", display: "inline-flex" }, "aria-hidden": "true" }, [D.icon("info", 17)]),
          D.el("p.field__hint", {
            text: "No changes yet. Every cutoff you move will be listed here, with the option to undo it."
          })
        ])
      );
      return;
    }
    var list = D.el("div.audit-list");
    history
      .slice()
      .reverse()
      .forEach(function (h) {
        // The compact summary is only worth a column when it says something the
        // description does not.
        var showSummary = h.summary && h.text.indexOf(h.summary) === -1;
        var item = D.el("div.audit-item", null, [
          D.el("span.audit-item__time", { text: h.time }),
          D.el("span.audit-item__text", { text: h.text }),
          showSummary ? D.el("span.audit-item__change", { text: h.summary }) : null
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
          btn.style.color = "var(--c-ink-600)";
          item.appendChild(btn);
        }
        list.appendChild(item);
      });
    host.appendChild(list);
  }

  CF.impactPanel = { renderImpact: renderImpact, renderHistory: renderHistory };
})(typeof globalThis !== "undefined" ? globalThis : this);
