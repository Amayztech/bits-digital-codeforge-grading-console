/**
 * Final review sheet and export.
 *
 * The review stage is a deliberate stop: the instructor has to navigate here,
 * and everything on this page is exactly what will be written to file. The
 * confirmation is a single dialog that doubles as the export receipt, so there
 * is no confirm-then-confirm sequence and no browser alert().
 */
(function (root) {
  "use strict";

  var CF = (root.CF = root.CF || {});
  var D = CF.dom;
  var U = CF.util;
  var G = CF.grading;

  function checks(state) {
    var counts = state.analysis ? state.analysis.counts : { accepted: 0, rejected: 0, normalised: 0 };
    var bandCheck = G.validate(state.cutoffs);
    var ungraded = state.cohort.filter(function (r) {
      return G.gradeFor(r.marks, state.cutoffs) === null;
    });
    var list = [
      {
        ok: !!state.instructor.trim(),
        label: "<b>Instructor</b> is recorded on the report.",
        detail: state.instructor.trim() || "No instructor name has been entered yet.",
        fix: state.instructor.trim()
          ? null
          : D.button({
              label: "Add your name",
              variant: "secondary",
              size: "sm",
              icon: "users",
              onClick: function () {
                var field = document.getElementById("instructor");
                if (field) {
                  field.focus();
                  field.scrollIntoView({ block: "center", behavior: "smooth" });
                }
              }
            })
      },
      {
        ok: !!state.analysis && state.analysis.ok,
        label: "<b>Marks file</b> was imported and validated.",
        detail: state.analysis
          ? state.analysis.meta.name + " — " + counts.accepted + " rows accepted" + (counts.rejected ? ", " + counts.rejected + " rejected" : "")
          : "No file imported."
      },
      {
        ok: !!state.cohort.length,
        label: "<b>Course</b> is selected and has students.",
        detail: state.courseName ? state.courseName + " — " + state.cohort.length + " students" : "No course selected."
      },
      {
        ok: bandCheck.valid && ungraded.length === 0,
        label: "<b>Every mark from 0 to 100 has exactly one grade.</b>",
        detail: ungraded.length
          ? ungraded.length + " students fall outside every band."
          : "Bands cover 0–100 with no gaps and no overlaps."
      },
      {
        ok: !state.isDemo,
        label: "<b>Source</b> is a real workbook, not the demo class.",
        detail: state.isDemo ? "This is demo data — do not submit it." : state.analysis.meta.name,
        soft: state.isDemo
      }
    ];
    return { list: list, bandCheck: bandCheck, ungraded: ungraded, ok: list.every(function (l) { return l.ok || l.soft; }) };
  }

  function render(host, state, handlers) {
    D.clear(host);
    var chk = checks(state);
    var bands = G.bandsFromCutoffs(state.cutoffs);
    var result = G.gradeAll(state.cohort, state.cutoffs);
    var impact = G.impact(state.cohort, state.cutoffs, G.defaults());
    var isDefault = U.deepEqual(state.cutoffs, G.defaults());
    var stats = CF.statistics.describe(
      state.cohort.map(function (r) {
        return r.marks;
      })
    );

    var sheet = D.el("section.sheet", { dataset: { printable: "true" } });

    /* --- masthead ------------------------------------------------------ */
    var statusBadge = chk.ok
      ? D.badge("Ready to finalize", "success")
      : D.badge("Needs attention", "danger");
    sheet.appendChild(
      D.el("div.sheet__masthead", null, [
        D.el("div", null, [
          D.el("p.sheet__eyebrow", { text: "Final grade report" }),
          D.el("h3.sheet__title", { text: state.courseName || "No course selected" }),
          D.el("div.sheet__subtitle", null, [
            D.el("span", null, [
              D.el("span", { style: { opacity: "0.7" }, text: "Instructor  " }),
              D.el("b", { text: state.instructor.trim() || "not set" })
            ]),
            D.el("span", null, [
              D.el("span", { style: { opacity: "0.7" }, text: "Students  " }),
              D.el("b", { class: "num", text: String(state.cohort.length) })
            ]),
            D.el("span", null, [
              D.el("span", { style: { opacity: "0.7" }, text: "Active time  " }),
              D.el("b", { class: "num", text: U.formatDuration(state.elapsedMs) })
            ])
          ])
        ]),
        D.el("div.sheet__status", null, [
          statusBadge,
          D.el("p", {
            style: { "margin-top": "6px", "font-size": "var(--fs-xs)", color: "rgba(255,255,255,0.7)" },
            text: "Prepared " + U.humanStamp(state.now)
          })
        ])
      ])
    );

    var body = D.el("div.sheet__body");

    /* --- safety checklist ---------------------------------------------- */
    body.appendChild(
      D.el("section", null, [
        D.el("h4.sheet__section-title", null, [
          "Before you finalize",
          D.el("span", { text: chk.ok ? "All checks passed" : chk.list.filter(function (l) { return !l.ok; }).length + " to resolve" })
        ]),
        D.el("div.checklist", null,
          chk.list.map(function (l) {
            var label = D.el("span", null, [
              D.el("span", { text: l.label }),
              D.el("span", { style: { display: "block", "font-size": "var(--fs-xs)", color: "var(--c-ink-500)" }, text: l.detail })
            ]);
            if (!l.ok && l.fix) label.appendChild(l.fix);
            return D.el("div.checklist__item", { dataset: { ok: l.ok ? "true" : "false" } }, [
              D.el("span.checklist__mark", { "aria-hidden": "true" }, [D.icon(l.ok ? "check" : "alert", 11)]),
              label
            ]);
          })
        )
      ])
    );

    /* --- statistics ---------------------------------------------------- */
    var statsRow = D.el("div.stats");
    [
      ["Students", stats.count, ""],
      ["Lowest", stats.min, ""],
      ["Highest", stats.max, ""],
      ["Mean", stats.mean.toFixed(1), ""],
      ["Median", fmt(stats.median), ""],
      ["Std dev", fmt(stats.stdDev), ""]
    ].forEach(function (t) {
      statsRow.appendChild(D.statTile(t[0], t[1], { unit: t[2] }));
    });
    body.appendChild(
      D.el("section", null, [
        D.el("h4.sheet__section-title", null, ["Cohort statistics", D.el("span", { text: "computed from the accepted rows of " + state.analysis.meta.name })]),
        statsRow
      ])
    );

    /* --- distribution -------------------------------------------------- */
    var chartBox = D.el("div.chart", { id: "chartReview" });
    body.appendChild(
      D.el("section", null, [
        D.el("h4.sheet__section-title", null, ["Final grade distribution", D.el("span", { text: "one bar per mark" })]),
        chartBox,
        CF.chart.legend([
          { colour: "var(--chart-g1)", label: "Highest bands" },
          { colour: "var(--chart-g8)", label: "Lowest band" },
          { cut: true, colour: "var(--c-accent)", label: "Grade cutoff" }
        ])
      ])
    );

    /* --- band table ----------------------------------------------------- */
    var bandTable = D.el("table.diff");
    var bt = D.el("thead");
    bt.appendChild(
      D.el("tr", null, [
        D.el("th", { scope: "col", text: "Grade" }),
        D.el("th", { scope: "col", text: "Marks" }),
        D.el("th.num", { scope: "col", text: "Students" }),
        D.el("th.num", { scope: "col", text: "Share" })
      ])
    );
    bandTable.appendChild(bt);
    var bb = D.el("tbody");
    bands.forEach(function (b, i) {
      var pct = U.percent(result.counts[i], state.cohort.length);
      bb.appendChild(
        D.el("tr", null, [
          D.el("td", null, [CF.analysePanel.gradeChip(b.grade, i)]),
          D.el("td.num", { text: G.rangeLabel(b) }),
          D.el("td.num", { style: { "font-weight": "650" }, text: String(result.counts[i]) }),
          D.el("td.num", { text: pct.toFixed(1) + "%" })
        ])
      );
    });
    bandTable.appendChild(bb);
    body.appendChild(
      D.el("section", null, [
        D.el("h4.sheet__section-title", null, [
          "Final grading bands",
          D.el("span", { text: G.describeCutoffs(state.cutoffs) })
        ]),
        D.el("div.table-wrap", null, bandTable)
      ])
    );

    /* --- change from defaults ------------------------------------------- */
    if (!isDefault) {
      body.appendChild(
        D.el("section", null, [
          D.el("h4.sheet__section-title", null, [
            "Change against the default bands",
            D.el("span", { text: impact.changed + " of " + state.cohort.length + " students affected" })
          ]),
          D.notice(
            impact.changed ? "warning" : "success",
            impact.changed ? "alert" : "check-circle",
            impact.changed
              ? impact.changed + " " + U.pluralise(impact.changed, "student") + " " + (impact.changed === 1 ? "has" : "have") + " a different grade than the default bands would give"
              : "Your cutoffs differ from the defaults, but no student's grade changes",
            D.el("p", {
              text:
                impact.up + " moved up a grade and " + impact.down + " moved down. " +
                "The default bands were A 80–100, A− 70–79, B 60–69, B− 50–59, C 40–49, C− 30–39, D 20–29, E 0–19."
            })
          ),
          impact.moved.length
            ? D.el("p.field__hint", {
                style: { "margin-top": "var(--sp-3)" },
                text:
                  "First few: " +
                  impact.moved
                    .slice(0, 8)
                    .map(function (m) {
                      return m.id + " (" + m.marks + " " + m.from + "→" + m.to + ")";
                    })
                    .join(", ") +
                  (impact.moved.length > 8 ? " and " + (impact.moved.length - 8) + " more." : ".")
              })
            : null
        ])
      );
    }

    /* --- warnings ------------------------------------------------------ */
    var attention = [];
    if (state.analysis.counts.rejected > 0) {
      attention.push(
        state.analysis.counts.rejected +
          " row(s) in the source file were rejected and are not part of these grades. Check the Data health report if that is unexpected."
      );
    }
    if (state.analysis.counts.normalised > 0) {
      attention.push(
        state.analysis.counts.normalised +
          " value(s) were rounded to whole marks under the challenge's file guidance. The originals are listed in the Data health report."
      );
    }
    if (state.isDemo) {
      attention.push("This report is built from the synthetic demo class, not real student records.");
    }
    if (!state.instructor.trim()) {
      attention.push("No instructor name has been entered, so the report cannot be attributed.");
    }
    if (state.history.length) {
      attention.push(
        state.history.length + " grading change(s) were made this session" +
          (state.history.length === 1 ? "" : "s") + " and are recorded in the exported summary."
      );
    }
    if (attention.length) {
      body.appendChild(
        D.el("section", null, [
          D.el("h4.sheet__section-title", null, ["Worth knowing before you finalize", D.el("span", { text: attention.length + " " + U.pluralise(attention.length, "note") })]),
          D.notice(
            "info",
            "info",
            null,
            D.el("ul", null, attention.map(function (t) { return D.el("li", { text: t }); }))
          )
        ])
      );
    }

    sheet.appendChild(body);

    /* --- footer actions ------------------------------------------------- */
    sheet.appendChild(
      D.el("div.sheet__foot", null, [
        D.el("p.sheet__foot-note", null, [
          D.el("b", { text: "Everything above is exactly what will be written to the files. " }),
          "The student-grade file has one row per student with the grade shown in the table above. " +
            "The summary file records the instructor, course, source sheet, statistics, the exact cutoffs used and every change made this session."
        ]),
        D.el("div.cluster", null, [
          D.button({ label: "Back to bands", variant: "secondary", icon: "sliders", onClick: handlers.onBack }),
          D.button({ label: "Print report", variant: "secondary", icon: "printer", onClick: handlers.onPrint }),
          D.button({
            label: state.finalized ? "Export again" : "Finalize & export",
            variant: null,
            icon: "download",
            disabled: !chk.ok || !state.cohort.length,
            title: chk.ok ? "" : "Resolve the checks above first",
            onClick: handlers.onFinalize
          })
        ])
      ])
    );

    host.appendChild(sheet);

    if (state.finalized) host.appendChild(receipt(state, handlers));

    return chk;
  }

  function receipt(state, handlers) {
    var f = state.finalized;
    return D.el("div.receipt", { style: { "margin-top": "var(--sp-4)" } }, [
      D.el("div.receipt__icon", { "aria-hidden": "true" }, [D.icon("check", 20)]),
      D.el("div", { style: { flex: "1 1 auto", "min-width": "0" } }, [
        D.el("p.receipt__title", {
          text: "Finalized at " + U.humanStamp(f.at) + " · " + U.formatDuration(f.elapsedMs) + " of active grading"
        }),
        D.el("p.receipt__body", {
          text:
            state.cohort.length +
            " " +
            U.pluralise(state.cohort.length, "student") +
            " graded for " +
            state.courseName +
            ". The exported grades are the ones shown in the table above."
        }),
        D.el("div.receipt__files", null,
          f.files.map(function (file) {
            return D.el("div.receipt__file", null, [D.icon("doc", 13), file]);
          })
        )
      ]),
      D.button({ label: "Print", variant: "secondary", size: "sm", icon: "printer", onClick: handlers.onPrint })
    ]);
  }

  /* ==================================================================== *
   * Single confirmation + export dialog
   * ==================================================================== */

  function confirmExport(state, handlers) {
    var bands = G.bandsFromCutoffs(state.cutoffs);
    var result = G.gradeAll(state.cohort, state.cutoffs);
    var gradesName = CF.exporters.gradesFileName(state.courseName, new Date());
    var summaryName = CF.exporters.summaryFileName(state.courseName, new Date());

    var summary = D.el("div", { style: { display: "flex", "flex-direction": "column", gap: "var(--sp-4)" } }, [
      D.notice(
        "success",
        "shield",
        "Finalizing " + state.courseName + " for " + (state.instructor.trim() || "an unnamed instructor"),
        D.el("p", {
          text:
            state.cohort.length +
            " " +
            U.pluralise(state.cohort.length, "student") +
            " will be written to file, graded exactly as shown in the review above. " +
            "This is the point of no return for this grade set — afterwards you can still change the bands and finalize again."
        })
      ),
      D.el("div", null, [
        D.el("p.eyebrow", { style: { "margin-bottom": "var(--sp-2)" }, text: "Files to be downloaded" }),
        D.el("div.receipt__files", { style: { color: "var(--c-ink-600)" } }, [
          D.el("div.receipt__file", { style: { color: "var(--c-ink-600)" } }, [D.icon("doc", 13), gradesName]),
          D.el("div.receipt__file", { style: { color: "var(--c-ink-600)" } }, [D.icon("doc", 13), summaryName])
        ])
      ]),
      D.el("div", null, [
        D.el("p.eyebrow", { style: { "margin-bottom": "var(--sp-2)" }, text: "Distribution being written" }),
        D.el("div.cluster", { style: { gap: "6px" } },
          bands.map(function (b, i) {
            return D.el("span", { style: { display: "inline-flex", "align-items": "center", gap: "5px" } }, [
              CF.analysePanel.gradeChip(b.grade, i),
              D.el("span.num", { style: { "font-size": "var(--fs-xs)", color: "var(--c-ink-600)" }, text: String(result.counts[i]) })
            ]);
          })
        )
      ])
    ]);

    CF.modal.open({
      title: "Finalize this grade set?",
      icon: "shield",
      body: summary,
      focus: "[data-confirm-finalize]",
      actions: [
        { label: "Keep editing", variant: "secondary" },
        {
          label: "Finalize and download",
          icon: "download",
          onClick: function (close) {
            var files = handlers.onExport();
            close();
            showReceipt(state, files, gradesName, summaryName);
          }
        }
      ]
    });

    // Mark the primary action so tests and keyboard users can target it.
    setTimeout(function () {
      var btns = document.querySelectorAll(".modal__foot .btn");
      if (btns.length) btns[btns.length - 1].dataset.confirmFinalize = "true";
    }, 0);
  }

  function showReceipt(state, files, gradesName, summaryName) {
    CF.modal.open({
      title: "Grade set finalized",
      icon: "check-circle",
      iconTone: "var(--c-success)",
      dismissible: true,
      body: [
        D.notice(
          "success",
          "check-circle",
          state.cohort.length + " " + U.pluralise(state.cohort.length, "student") + " exported for " + state.courseName,
          D.el("p", {
            text:
              "The files below were generated in this browser from the exact configuration you reviewed. " +
              "Keep them with your course records; the summary file is the audit trail for this grade set."
          })
        ),
        D.el("div", null, [
          D.el("p.eyebrow", { style: { "margin-bottom": "var(--sp-2)" }, text: "Downloaded" }),
          D.el("div.receipt__files", { style: { color: "var(--c-ink-600)" } },
            files.map(function (f) {
              return D.el("div.receipt__file", { style: { color: "var(--c-ink-600)" } }, [D.icon("doc", 13), f]);
            })
          )
        ])
      ],
      actions: [{ label: "Done", variant: null }]
    });
  }

  function fmt(v) {
    if (v === null || v === undefined || !isFinite(v)) return "—";
    if (v === Math.round(v)) return String(v);
    return v.toFixed(1);
  }

  CF.reviewPanel = {
    render: render,
    confirmExport: confirmExport,
    checks: checks
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
