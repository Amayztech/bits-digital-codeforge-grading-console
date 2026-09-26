/**
 * Analyse surface: descriptive statistics, score clusters, the default-band
 * preview and the searchable student outcome table.
 */
(function (root) {
  "use strict";

  var CF = (root.CF = root.CF || {});
  var D = CF.dom;
  var U = CF.util;
  var S = CF.statistics;

  function renderStats(host, stats, cohort) {
    D.clear(host);
    if (!stats.count) {
      host.appendChild(D.emptyState("users", "No students in this course", "Choose a different course, or import a file that contains this course."));
      return;
    }
    var tiles = [
      { label: "Students", value: stats.count, note: "graded from this file" },
      { label: "Lowest mark", value: stats.min, note: stats.min === stats.max ? "every student scored this" : "in the class" },
      { label: "Highest mark", value: stats.max, note: "out of 100" },
      { label: "Mean", value: stats.mean.toFixed(1), note: "arithmetic average" },
      { label: "Median", value: fmt(stats.median), note: "half the class is below this", accent: true },
      { label: "Std deviation", value: fmt(stats.stdDev), note: stats.stdDev === 0 ? "no spread at all" : "spread of the class" },
      { label: "Q1 – Q3", value: fmt(stats.q1) + " – " + fmt(stats.q3), note: "middle 50% of the class", text: true },
      { label: "Range", value: stats.range, note: "highest − lowest" }
    ];
    tiles.forEach(function (t) {
      host.appendChild(
        D.statTile(t.label, t.value, { note: t.note, accent: t.accent, text: t.text })
      );
    });
  }

  function renderClusters(host, stats) {
    D.clear(host);
    if (!stats.count) {
      host.appendChild(D.emptyState("scale", "Nothing to describe yet", "Statistics appear once a course is selected."));
      return;
    }
    var groups = S.clusters(stats.sorted, 6);
    var strip = D.el("div.clusters", { role: "img", "aria-label": ariaForClusters(groups) });
    groups.forEach(function (g, i) {
      var pct = (g.count / stats.count) * 100;
      strip.appendChild(
        D.el("div.clusters__seg", {
          style: {
            flex: String(Math.max(g.count, 0.35)),
            background: rampColour(i, groups.length)
          },
          title: g.min === g.max
            ? g.count + " students at " + g.min
            : g.count + " students between " + g.min + " and " + g.max
        }, pct >= 12 ? g.min + "–" + g.max : "")
      );
    });
    host.appendChild(strip);
    host.appendChild(
      D.el("div.clusters__axis", null, [
        D.el("span", { text: "0" }),
        D.el("span", { text: "marks" }),
        D.el("span", { text: "100" })
      ])
    );

    var sentences = [];
    sentences.push(
      groups.length === 1
        ? "Every student in this course sits between " +
            groups[0].min +
            " and " +
            groups[0].max +
            "."
        : "The class separates into " +
            groups.length +
            " group" +
            (groups.length === 1 ? "" : "s") +
            " with clear gaps between them: " +
            groups
              .map(function (g) {
                return g.min + "–" + g.max + " (" + g.count + ")";
              })
              .join(", ") +
            "."
    );
    if (stats.median !== null) {
      sentences.push(
        "Half the class scored " +
          fmt(stats.median) +
          " or below, and half scored " +
          fmt(stats.median) +
          " or above. The median is usually a sounder basis for a cutoff than the mean."
      );
    }
    if (stats.stdDev !== null && stats.stdDev < 5) {
      sentences.push(
        "The spread is unusually tight, so small cutoff changes will move a lot of students at once."
      );
    }
    host.appendChild(
      D.el("p.field__hint", { style: { "margin-top": "var(--sp-4)" }, text: sentences.join(" ") })
    );
  }

  function renderDefaultPreview(host, cohort, cutoffs) {
    D.clear(host);
    if (!cohort.length) {
      host.appendChild(D.emptyState("scale", "No students", ""));
      return;
    }
    var res = CF.grading.gradeAll(cohort, cutoffs);
    var box = D.el("div", { style: { display: "flex", "flex-direction": "column", gap: "6px" } });
    res.bands.forEach(function (b, i) {
      var pct = U.percent(res.counts[i], cohort.length);
      box.appendChild(
        D.el("div", { style: { display: "grid", "grid-template-columns": "34px 1fr 62px", gap: "var(--sp-2)", "align-items": "center" } }, [
          gradeChip(b.grade, i),
          D.el("div", { style: { display: "flex", "align-items": "center", gap: "var(--sp-2)" } }, [
            D.el("div", {
              style: {
                height: "6px",
                "border-radius": "999px",
                background: "var(--c-ink-100)",
                overflow: "hidden",
                flex: "1 1 auto",
                "min-width": "0"
              }
            }, [
              D.el("div", {
                style: {
                  height: "100%",
                  width: pct + "%",
                  "border-radius": "inherit",
                  background: rampColour(i, 8),
                  transition: "width var(--dur-3) var(--ease-out)"
                }
              })
            ]),
            D.el("span", {
              style: { "font-size": "var(--fs-2xs)", color: "var(--c-ink-500)", "min-width": "38px", "font-variant-numeric": "tabular-nums" },
              text: pct.toFixed(0) + "%"
            })
          ]),
          D.el("span.num", {
            style: { "text-align": "right", "font-size": "var(--fs-sm)", "font-weight": "650" },
            text: String(res.counts[i])
          })
        ])
      );
    });
    host.appendChild(box);
    host.appendChild(
      D.el("p.field__hint", {
        style: { "margin-top": "var(--sp-3)" },
        text: CF.grading.describeCutoffs(cutoffs)
      })
    );
  }

  /* ==================================================================== *
   * Student outcome table
   * ==================================================================== */

  function renderStudents(host, opts) {
    D.clear(host);
    var cohort = opts.cohort;
    var cutoffs = opts.cutoffs;
    var baseline = opts.baseline;
    var sort = opts.sort;
    var query = (opts.query || "").trim().toLowerCase();

    if (!cohort.length) {
      host.appendChild(D.emptyState("users", "No students", ""));
      return;
    }

    var rows = cohort.map(function (r) {
      var grade = CF.grading.gradeFor(r.marks, cutoffs);
      var before = baseline ? CF.grading.gradeFor(r.marks, baseline) : null;
      var band = null;
      for (var i = 0; i < cutoffs.length; i++) {
        if (r.marks >= cutoffs[i]) {
          band = i;
          break;
        }
      }
      return {
        id: r.id,
        marks: r.marks,
        row: r.row,
        grade: grade,
        band: band,
        before: before,
        changed: !!(before && before !== grade)
      };
    });

    if (query) {
      rows = rows.filter(function (r) {
        return (
          r.id.toLowerCase().indexOf(query) !== -1 ||
          String(r.marks).indexOf(query) !== -1 ||
          (r.grade && r.grade.toLowerCase().indexOf(query) !== -1)
        );
      });
    }

    var dir = sort.dir === "asc" ? 1 : -1;
    rows.sort(function (a, b) {
      var av, bv;
      if (sort.key === "marks") { av = a.marks; bv = b.marks; }
      else if (sort.key === "grade") { av = CF.grading.GRADES.indexOf(a.grade); bv = CF.grading.GRADES.indexOf(b.grade); }
      else { av = a.id; bv = b.id; }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return a.id.localeCompare(b.id, undefined, { numeric: true });
    });

    if (!rows.length) {
      host.appendChild(
        D.emptyState("search", "No student matches “" + opts.query + "”", "Clear the search to see all " + cohort.length + " students.")
      );
      return;
    }

    var table = D.el("table.data");
    var thead = D.el("thead");
    var tr = D.el("tr");
    [
      { key: "id", label: "BITS ID", num: false, width: "26%" },
      { key: "marks", label: "Marks", num: true, width: "12%" },
      { key: "grade", label: "Grade", num: false, width: "22%" },
      { key: "band", label: "Band", num: false, width: "18%" }
    ].forEach(function (col) {
      var active = sort.key === col.key;
      var th = D.el("th", {
        scope: "col",
        class: col.num ? "num" : "",
        dataset: { sortable: col.key !== "band" ? "true" : null },
        "aria-sort": active ? (sort.dir === "asc" ? "ascending" : "descending") : "none",
        style: { width: col.width },
        tabindex: col.key !== "band" ? "0" : null,
        role: "columnheader"
      });
      var inner = D.el("span.th-sort", null, [
        D.el("span", { text: col.label }),
        col.key !== "band"
          ? D.el("span.th-sort__ind", { "aria-hidden": "true" }, [
              D.icon(active ? (sort.dir === "asc" ? "arrow-up" : "arrow-down") : "chevron-down", 11)
            ])
          : null
      ]);
      th.appendChild(inner);
      if (col.key === "band") return;
      var activate = function () {
        opts.onSort(col.key);
      };
      th.addEventListener("click", activate);
      th.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      });
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);

    var tbody = D.el("tbody");
    var shown = Math.min(rows.length, 500);
    var bands = CF.grading.bandsFromCutoffs(cutoffs);
    for (var i = 0; i < shown; i++) {
      var r = rows[i];
      var gi = CF.grading.GRADES.indexOf(r.grade);
      var row = D.el("tr", { dataset: { flagged: r.changed ? "true" : "false" } }, [
        D.el("td.cell-id", { text: r.id }),
        D.el("td.num.cell-strong", { text: String(r.marks) }),
        D.el("td", null, [
          D.el("span.cluster", { style: { gap: "6px" } }, [
            gradeChip(r.grade || "?", gi >= 0 ? gi : 7),
            r.changed
              ? D.el("span.row-marker", null, [
                  D.icon(r.grade > r.before ? "arrow-up" : "arrow-down", 11),
                  r.before + " → " + r.grade
                ])
              : null
          ])
        ]),
        D.el("td.num", {
          style: { color: "var(--c-ink-500)", "font-size": "var(--fs-xs)" },
          text: r.band === null || r.band === undefined ? "—" : CF.grading.rangeLabel(bands[r.band])
        })
      ]);
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    host.appendChild(D.el("div.table-wrap.table-scroll", null, table));

    if (rows.length > shown) {
      host.appendChild(
        D.el("p.field__hint", {
          style: { "margin-top": "var(--sp-3)" },
          text:
            "Showing the first " +
            shown +
            " of " +
            rows.length +
            " matching students. Narrow the search to see the rest - the export always contains every student."
        })
      );
    } else {
      host.appendChild(
        D.el("p.field__hint", {
          style: { "margin-top": "var(--sp-3)" },
          text:
            rows.length +
            (rows.length === cohort.length ? " of " + cohort.length : " of " + cohort.length) +
            " " +
            U.pluralise(rows.length, "student") +
            (baseline ? " shown. Highlighted rows changed grade against the previous configuration." : " shown.")
        })
      );
    }
  }

  function gradeChip(grade, index) {
    var i = index === null || index === undefined || index < 0 ? 7 : index;
    return D.el("span.grade-chip", {
      dataset: { tone: i >= 6 ? "light" : "deep" },
      style: { background: "var(--grade-" + (i + 1) + ")" },
      text: grade
    });
  }

  function rampColour(i, total) {
    var idx = Math.round((i / Math.max(1, total - 1)) * 7);
    return "var(--chart-g" + (idx + 1) + ")";
  }

  function fmt(v) {
    if (v === null || v === undefined || !isFinite(v)) return "—";
    if (v === Math.round(v)) return String(v);
    return v.toFixed(1);
  }

  function ariaForClusters(groups) {
    return (
      "Score clusters: " +
      groups
        .map(function (g) {
          return g.min + " to " + g.max + ", " + g.count + " students";
        })
        .join("; ")
    );
  }

  CF.analysePanel = {
    renderStats: renderStats,
    renderClusters: renderClusters,
    renderDefaultPreview: renderDefaultPreview,
    renderStudents: renderStudents,
    gradeChip: gradeChip
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
