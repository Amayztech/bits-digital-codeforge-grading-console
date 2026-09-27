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
        strong: "Instructor",
        rest: "is recorded on the report.",
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
        strong: "Marks file",
        rest: "was imported and validated.",
        detail: state.analysis
          ? state.analysis.meta.name + " — " + counts.accepted + " rows accepted" + (counts.rejected ? ", " + counts.rejected + " rejected" : "")
          : "No file imported."
      },
      {
        ok: !!state.cohort.length,
        strong: "Course",
        rest: "is selected and has students.",
        detail: state.courseName ? state.courseName + " — " + state.cohort.length + " students" : "No course selected."
      },
      {
        ok: bandCheck.valid && ungraded.length === 0,
        strong: "Every mark from 0 to 100 has exactly one grade.",
        rest: "",
        detail: ungraded.length
          ? ungraded.length + " students fall outside every band."
          : "Bands cover 0–100 with no gaps and no overlaps."
      },
      {
        ok: !state.isDemo,
        soft: state.isDemo,
        strong: "Source",
        rest: "is a real workbook, not the demo class.",
        detail: state.isDemo ? "This is demo data — do not submit it." : state.analysis.meta.name
      }
    ];
    var blocking = list.filter(function (l) { return !l.ok && !l.soft; });
    return {
      list: list,
      bandCheck: bandCheck,
      ungraded: ungraded,
      blocking: blocking,
      ok: blocking.length === 0
    };
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

    // A finalized grade set leads with its completion record.
    if (state.finalized) host.appendChild(receipt(state, handlers));

    var sheet = D.el("section.sheet", {
      dataset: { printable: "true", status: state.finalized ? "final" : chk.ok ? "ready" : "blocked" },
      "aria-labelledby": "sheetTitle"
    });

    /* --- masthead: the report's letterhead ------------------------------ */
    var statusBadge = state.finalized
      ? D.el("span.stamp", { dataset: { tone: "final" } }, [D.el("span.status-dot"), "Finalized"])
      : chk.ok
      ? D.el("span.stamp", { dataset: { tone: "ready" } }, [D.el("span.status-dot"), "Ready to finalize"])
      : D.el("span.stamp", { dataset: { tone: "blocked" } }, [D.el("span.status-dot"), "Needs attention"]);
    var crest = document.querySelector(".brand__mark img");
    sheet.appendChild(
      D.el("header.sheet__masthead", null, [
        D.el("div.sheet__ident", null, [
          crest
            ? D.el("img.sheet__crest", { src: crest.currentSrc || crest.src, alt: "", width: "44", height: "44" })
            : null,
          D.el("div", { style: { "min-width": "0" } }, [
            D.el("p.sheet__eyebrow", { text: "BITS Pilani Digital · Final grade report" }),
            D.el("h3.sheet__title", { id: "sheetTitle", text: state.courseName || "No course selected" })
          ])
        ]),
        D.el("div.sheet__status", null, [
          statusBadge,
          D.el("p.sheet__prepared", { text: "Prepared " + U.humanStamp(state.now) })
        ]),
        D.el("dl.sheet__subtitle", null, [
          metaItem("Instructor", state.instructor.trim() || "Not set", !state.instructor.trim()),
          metaItem("Students", String(state.cohort.length)),
          metaItem("Active grading time", U.formatDuration(state.elapsedMs)),
          metaItem("Source", state.analysis.meta.name + (state.isDemo ? " (demo)" : ""))
        ])
      ])
    );

    var body = D.el("div.sheet__body");

    /* --- verification: concise, one line per check ---------------------- */
    body.appendChild(
      D.el("section.sheet__section", null, [
        D.el("h4.sheet__section-title", null, [
          "Before you finalize",
          D.el("span", { text: chk.ok ? "All checks passed" : chk.blocking.length + " to resolve" })
        ]),
        D.el("ul.checklist.checklist--strip", null,
          chk.list.map(function (l) {
            var label = D.el("span.checklist__label", null, [
              D.el("span.checklist__line", null, [
                D.el("b", { text: l.strong }),
                l.rest ? D.el("span", { text: " " + l.rest }) : null
              ]),
              D.el("span.checklist__detail", { text: l.detail, title: l.detail })
            ]);
            if (!l.ok && l.fix) label.appendChild(l.fix);
            return D.el("li.checklist__item", { dataset: { ok: l.ok ? "true" : "false", soft: l.soft ? "true" : "false" } }, [
              D.el("span.checklist__mark", { "aria-hidden": "true" }, [D.icon(l.ok ? "check" : "alert", 10)]),
              D.el("span.visually-hidden", { text: l.ok ? "Passed: " : l.soft ? "Warning: " : "Not passed: " }),
              label
            ]);
          })
        )
      ])
    );

    /* --- statistics: the same analytics rail as the workspace ----------- */
    var statsRow = D.el("div.stats.stats--report");
    [
      ["Students", stats.count],
      ["Lowest", stats.min],
      ["Highest", stats.max],
      ["Mean", stats.mean.toFixed(1)],
      ["Median", fmt(stats.median)],
      ["Std dev", fmt(stats.stdDev)]
    ].forEach(function (t) {
      statsRow.appendChild(D.statTile(t[0], t[1], {}));
    });
    body.appendChild(
      D.el("section.sheet__section", null, [
        D.el("h4.sheet__section-title", null, ["Cohort statistics", D.el("span", { text: "From the accepted rows of " + state.analysis.meta.name })]),
        statsRow
      ])
    );

    /* --- distribution -------------------------------------------------- */
    // The chart element is owned by the caller and reused across re-renders, so
    // rebuilding the sheet does not orphan it.
    var chartBox = handlers.chartHost;
    body.appendChild(
      D.el("section.sheet__section", null, [
        D.el("h4.sheet__section-title", null, [
          "Final grade distribution",
          CF.chart.legend([
            { ramp: true, label: "Grades A → E" },
            { cut: true, label: "Grade cutoff" }
          ])
        ]),
        D.el("div.sheet__chart", null, chartBox)
      ])
    );

    /* --- band table + what to know, side by side ------------------------ */
    var bandTable = D.el("table.diff");
    bandTable.classList.add("diff--report");
    bandTable.appendChild(D.el("caption.visually-hidden", { text: "Final grading bands and the number of students in each" }));
    var bt = D.el("thead");
    bt.appendChild(
      D.el("tr", null, [
        D.el("th", { scope: "col", text: "Grade" }),
        D.el("th", { scope: "col", text: "Marks" }),
        D.el("th.num", { scope: "col", text: "Students" }),
        D.el("th.num", { scope: "col", text: "Share" }),
        D.el("th", { scope: "col" }, [D.el("span.visually-hidden", { text: "Share of the class" })])
      ])
    );
    bandTable.appendChild(bt);
    var bb = D.el("tbody");
    var peakShare = Math.max.apply(
      null,
      result.counts.map(function (n) {
        return U.percent(n, state.cohort.length);
      })
    );
    bands.forEach(function (b, i) {
      var pct = U.percent(result.counts[i], state.cohort.length);
      bb.appendChild(
        D.el("tr", { dataset: { empty: result.counts[i] ? "false" : "true" } }, [
          D.el("td", null, [CF.analysePanel.gradeChip(b.grade, i)]),
          D.el("td.num.diff__range-cell", { text: CF.analysePanel.range(b) }),
          D.el("td.num.cell-strong", { text: String(result.counts[i]) }),
          D.el("td.num.diff__pct", { text: pct.toFixed(1) + "%" }),
          D.el("td.diff__share", null, [
            D.el("div.share-track", { "aria-hidden": "true" }, [
              D.el("div.share-track__fill", {
                style: {
                  width: (peakShare ? (pct / peakShare) * 100 : 0) + "%",
                  background: "var(--grade-" + (i + 1) + ")"
                }
              })
            ])
          ])
        ])
      );
    });
    bandTable.appendChild(bb);

    var aside = D.el("div.sheet__aside");

    /* change from defaults */
    if (!isDefault) {
      aside.appendChild(
        D.el("section.sheet__note", { dataset: { tone: impact.changed ? "warning" : "neutral" } }, [
          D.el("p.sheet__note-title", null, [
            D.el("span", { text: "Change against the default bands" }),
            D.el("span.sheet__note-meta", { text: impact.changed + " of " + state.cohort.length + " affected" })
          ]),
          D.el("p.sheet__note-figure", null, [
            D.el("b", { text: String(impact.changed) }),
            " " + U.pluralise(impact.changed, "student") + " " + (impact.changed === 1 ? "has" : "have") + " a different grade than the default bands would give"
          ]),
          D.el("p.sheet__note-text", {
            text: impact.up + " moved up a grade and " + impact.down + " moved down. " +
              "Default bands: A 80–100, A− 70–79, B 60–69, B− 50–59, C 40–49, C− 30–39, D 20–29, E 0–19."
          }),
          impact.moved.length
            ? D.el("p.sheet__note-text", {
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

    /* worth knowing */
    var attention = [];
    if (state.analysis.counts.rejected > 0) {
      attention.push(
        state.analysis.counts.rejected +
          " row(s) in the source file were rejected and are not part of these grades. Check the Data health report if that is unexpected."
      );
    }
    if (state.analysis.counts.normalised > 0) {
      var policy = state.analysis.rounding || "nearest";
      var rule =
        policy === "up" ? "always rounded up" : policy === "down" ? "always rounded down" : "rounded to the nearest whole mark";
      attention.push(
        state.analysis.counts.normalised +
          " value(s) were " +
          rule +
          ". The originals are listed in the Data health report."
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
        state.history.length +
          " grading " +
          (state.history.length === 1 ? "change was" : "changes were") +
          " made this session and " +
          (state.history.length === 1 ? "is" : "are") +
          " recorded in the exported summary."
      );
    }
    if (attention.length) {
      aside.appendChild(
        D.el("section.sheet__note", null, [
          D.el("p.sheet__note-title", null, [
            D.el("span", { text: "Worth knowing before you finalize" }),
            D.el("span.sheet__note-meta", { text: attention.length + " " + U.pluralise(attention.length, "note") })
          ]),
          D.el("ul.sheet__notes", null, attention.map(function (t) { return D.el("li", { text: t }); }))
        ])
      );
    }
    if (!aside.firstChild) {
      aside.appendChild(
        D.el("section.sheet__note", { dataset: { tone: "neutral" } }, [
          D.el("p.sheet__note-title", null, [D.el("span", { text: "Default bands, unchanged" })]),
          D.el("p.sheet__note-text", { text: "Every student is graded on the challenge's default bands. No notes for this grade set." })
        ])
      );
    }

    body.appendChild(
      D.el("section.sheet__section", null, [
        D.el("h4.sheet__section-title", null, [
          "Final grading bands",
          D.el("span", { text: G.describeCutoffs(state.cutoffs).replace(/(\d)-(\d)/g, "$1\u2013$2") })
        ]),
        D.el("div.sheet__grid", null, [
          D.el("div.table-wrap.sheet__bands", null, bandTable),
          aside
        ])
      ])
    );

    sheet.appendChild(body);

    /* --- footer actions ------------------------------------------------- */
    sheet.appendChild(
      D.el("div.sheet__foot", null, [
        D.el("p.sheet__foot-note", null, [
          D.el("b", { text: "This is exactly what will be written to the files. " }),
          "One row per student with the grade shown above, plus a summary recording the instructor, course, " +
            "source sheet, statistics, the exact cutoffs and every change made this session."
        ]),
        D.el("div.cluster.sheet__actions", null, [
          D.button({ label: "Back to bands", variant: "ghost", icon: "sliders", onClick: handlers.onBack }),
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

    sheet.lastElementChild.classList.add("no-print-actions");
    host.appendChild(sheet);

    return chk;
  }

  function metaItem(label, value, missing) {
    return D.el("div.sheet__meta", { dataset: missing ? { missing: "true" } : null }, [
      D.el("dt", { text: label }),
      D.el("dd", { text: value, title: value })
    ]);
  }

  /** The completion record: calm, factual, and it says what was written. */
  function receipt(state, handlers) {
    var f = state.finalized;
    return D.el("section.receipt", { "aria-label": "Grades finalized" }, [
      D.el("div.receipt__icon", { "aria-hidden": "true" }, [D.icon("check", 16)]),
      D.el("div.receipt__main", null, [
        D.el("p.receipt__title", { text: "Grades finalized" }),
        D.el("p.receipt__body", null, [
          D.el("b", { text: state.courseName }),
          D.el("span.receipt__sep", { "aria-hidden": "true", text: "·" }),
          state.cohort.length + " " + U.pluralise(state.cohort.length, "student"),
          D.el("span.receipt__sep", { "aria-hidden": "true", text: "·" }),
          U.humanStamp(f.at),
          D.el("span.receipt__sep", { "aria-hidden": "true", text: "·" }),
          U.formatDuration(f.elapsedMs) + " of active grading"
        ]),
        D.el("div.receipt__files", { "aria-label": "Exported files" },
          f.files.map(function (file) {
            return D.el("div.receipt__file", { title: file }, [D.icon("doc", 12), D.el("span", { text: file })]);
          })
        )
      ]),
      D.el("div.receipt__actions", null, [
        D.button({ label: "Print", variant: "secondary", size: "sm", icon: "printer", onClick: handlers.onPrint }),
        D.button({ label: "Export again", variant: "ghost", size: "sm", icon: "download", onClick: handlers.onFinalize })
      ])
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
    var chk = checks(state);
    var total = state.cohort.length;

    var dist = D.el("div.confirm__dist");
    var bar = D.el("div.sharebar.sharebar--thin", { "aria-hidden": "true" });
    bands.forEach(function (b, i) {
      var n = result.counts[i];
      if (n) {
        bar.appendChild(D.el("span.sharebar__seg", { style: { flex: String(n), background: "var(--grade-" + (i + 1) + ")" } }));
      }
      dist.appendChild(
        D.el("span.confirm__band", { dataset: { empty: n ? "false" : "true" } }, [
          CF.analysePanel.gradeChip(b.grade, i),
          D.el("span.num", { text: String(n) })
        ])
      );
    });

    var summary = D.el("div.confirm", null, [
      D.el("dl.confirm__facts", null, [
        D.el("div", null, [D.el("dt", { text: "Students" }), D.el("dd.num", { text: String(total) })]),
        D.el("div", null, [D.el("dt", { text: "Instructor" }), D.el("dd", { text: state.instructor.trim() || "an unnamed instructor" })]),
        D.el("div", null, [D.el("dt", { text: "Active time" }), D.el("dd.num", { text: U.formatDuration(state.elapsedMs) })])
      ]),
      D.el("p.confirm__check", { dataset: { tone: chk.ok && !state.isDemo ? "ok" : "warn" } }, [
        D.el("span", { "aria-hidden": "true" }, [D.icon(chk.ok && !state.isDemo ? "check-circle" : "alert", 15)]),
        chk.ok
          ? state.isDemo
            ? "All validation checks passed. This is the synthetic demo class."
            : "All validation checks passed."
          : "Some checks have not passed."
      ]),
      D.el("div.confirm__section", null, [
        D.el("p.confirm__label", { text: "Distribution being written" }),
        bar,
        dist
      ]),
      D.el("p.confirm__note", {
        text:
          "Graded exactly as shown in the review. This is the point of no return for this grade set — " +
          "afterwards you can still change the bands and finalize again."
      }),
      D.el("div.confirm__files", null, [
        D.el("p.confirm__label", { text: "Files to be downloaded" }),
        D.el("div.receipt__files", null, [
          D.el("div.receipt__file", { title: gradesName }, [D.icon("doc", 12), D.el("span", { text: gradesName })]),
          D.el("div.receipt__file", { title: summaryName }, [D.icon("doc", 12), D.el("span", { text: summaryName })])
        ])
      ])
    ]);

    CF.modal.open({
      title: "Finalize " + (state.courseName || "this grade set") + "?",
      icon: "shield",
      body: summary,
      // No `focus` option: the modal focuses the first action ("Keep
      // editing") on purpose - a keyboard user must never be one Enter away
      // from finalizing a grade set they have not read.
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

    // Mark the primary action with a stable hook so it can be targeted
    // without depending on its label text.
    setTimeout(function () {
      var btns = document.querySelectorAll(".modal__foot .btn");
      if (btns.length) btns[btns.length - 1].dataset.confirmFinalize = "true";
    }, 0);
  }

  function showReceipt(state, files, gradesName, summaryName) {
    CF.modal.open({
      title: "Grades finalized",
      icon: "check-circle",
      iconTone: "var(--c-success)",
      dismissible: true,
      body: [
        D.el("p.confirm__lead", null, [
          D.el("b", { text: state.cohort.length + " " + U.pluralise(state.cohort.length, "student") }),
          " exported for ",
          D.el("b", { text: state.courseName }),
          "."
        ]),
        D.el("p.confirm__note", {
          text:
            "Generated in this browser from the exact configuration you reviewed. Keep both files with your " +
            "course records; the summary is the audit trail for this grade set."
        }),
        D.el("div.confirm__files", null, [
          D.el("p.confirm__label", { text: "Downloaded" }),
          D.el("div.receipt__files", null,
            files.map(function (f) {
              return D.el("div.receipt__file", { title: f }, [D.icon("doc", 12), D.el("span", { text: f })]);
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
