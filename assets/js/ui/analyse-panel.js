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
      { label: "Median", value: fmt(stats.median), note: "the middle student", accent: true },
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

  /**
   * Class spread, drawn rather than described: a box plot on the true 0-100
   * scale (whiskers at the extremes, the box across the middle half, the
   * median as a rule and the mean as a dot), with the gap-separated groups of
   * students laid out beneath it at their real positions.
   */
  function renderClusters(host, stats) {
    D.clear(host);
    if (!stats.count) {
      host.appendChild(D.emptyState("scale", "Nothing to describe yet", "Statistics appear once a course is selected."));
      return;
    }
    var groups = S.clusters(stats.sorted, 6);
    var pos = function (v) { return U.clamp(v, 0, 100) + "%"; };
    var span = function (a, b) { return Math.max(0, U.clamp(b, 0, 100) - U.clamp(a, 0, 100)) + "%"; };

    var plot = D.el("div.spread", { role: "img", "aria-label": ariaForSpread(stats, groups) }, [
      D.el("div.spread__track", null, [
        D.el("span.spread__whisker", { style: { left: pos(stats.min), width: span(stats.min, stats.max) } }),
        D.el("span.spread__cap", { style: { left: pos(stats.min) } }),
        D.el("span.spread__cap", { style: { left: pos(stats.max) } }),
        D.el("span.spread__box", { style: { left: pos(stats.q1), width: span(stats.q1, stats.q3) } }),
        D.el("span.spread__median", { style: { left: pos(stats.median) }, title: "Median " + fmt(stats.median) }),
        stats.mean !== null
          ? D.el("span.spread__mean", { style: { left: pos(stats.mean) }, title: "Mean " + stats.mean.toFixed(1) })
          : null
      ]),
      D.el("div.spread__groups", null,
        groups.map(function (g) {
          return D.el("span.spread__group", {
            style: { left: pos(g.min), width: "max(3px, " + span(g.min, g.max) + ")" },
            title: g.min === g.max
              ? g.count + " " + U.pluralise(g.count, "student") + " at " + g.min
              : g.count + " students between " + g.min + " and " + g.max
          });
        })
      ),
      D.el("div.spread__axis", { "aria-hidden": "true" }, [
        D.el("span", { text: "0" }),
        D.el("span", { text: "50" }),
        D.el("span", { text: "100" })
      ])
    ]);
    host.appendChild(plot);

    var facts = D.el("dl.facts");
    var addFact = function (k, v) {
      facts.appendChild(D.el("div.facts__item", null, [D.el("dt", { text: k }), D.el("dd", { text: v })]));
    };
    addFact("Middle half", fmt(stats.q1) + "–" + fmt(stats.q3));
    addFact("Median", fmt(stats.median));
    addFact(groups.length === 1 ? "One group" : groups.length + " score groups",
      groups.length === 1
        ? groups[0].min + "–" + groups[0].max
        : groups.map(function (g) { return g.min === g.max ? String(g.min) : g.min + "–" + g.max; }).join(" · "));
    host.appendChild(facts);

    // Only the observation that changes a decision is spelled out.
    var note = stats.stdDev !== null && stats.stdDev < 5
      ? "The spread is unusually tight: a one-mark cutoff change will move many students at once."
      : "The median is usually a sounder basis for a cutoff than the mean.";
    host.appendChild(D.el("p.spread__note", { text: note }));
  }

  /**
   * The default bands as one stacked share bar with a compact grade grid,
   * rather than eight separate progress bars.
   */
  function renderDefaultPreview(host, cohort, cutoffs) {
    D.clear(host);
    if (!cohort.length) {
      host.appendChild(D.emptyState("scale", "No students", ""));
      return;
    }
    var res = CF.grading.gradeAll(cohort, cutoffs);
    var bar = D.el("div.sharebar", { "aria-hidden": "true" });
    var grid = D.el("ul.gradegrid");
    res.bands.forEach(function (b, i) {
      var n = res.counts[i];
      var pct = U.percent(n, cohort.length);
      if (n) {
        bar.appendChild(
          D.el("span.sharebar__seg", {
            style: { flex: String(n), background: "var(--grade-" + (i + 1) + ")" },
            dataset: { tone: i >= 4 ? "light" : "deep" },
            title: b.grade + ": " + n + " " + U.pluralise(n, "student")
          }, pct >= 9 ? b.grade : "")
        );
      }
      grid.appendChild(
        D.el("li.gradegrid__cell", { dataset: { empty: n ? "false" : "true" } }, [
          gradeChip(b.grade, i),
          D.el("span.gradegrid__n.num", { text: String(n) }),
          D.el("span.gradegrid__pct.num", { text: pct.toFixed(pct < 10 && pct > 0 ? 1 : 0) + "%" })
        ])
      );
    });
    host.appendChild(bar);
    host.appendChild(grid);
    host.appendChild(
      D.el("p.visually-hidden", { text: CF.grading.describeCutoffs(cutoffs) })
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
      { key: "id", label: "BITS ID", num: false, width: "32%" },
      { key: "marks", label: "Marks", num: true, width: "14%" },
      { key: "grade", label: "Grade", num: false, width: "34%" },
      { key: "band", label: "Band", num: true, width: "20%" }
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
      if (col.key === "band") {
        tr.appendChild(th);
        return;
      }
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
      /*
       * Direction comes from the grade's rank in GRADES, not from string
       * comparison: alphabetically "B" > "A-", but moving A- to B is a
       * *downward* move. A better grade has a lower index, so "up" means the
       * index decreased - the same definition the impact panel uses.
       */
      var movedUp =
        r.changed &&
        CF.grading.GRADES.indexOf(r.grade) < CF.grading.GRADES.indexOf(r.before);
      var row = D.el("tr", { dataset: { flagged: r.changed ? "true" : "false" } }, [
        D.el("td.cell-id", { text: r.id }),
        D.el("td.num.cell-strong", { text: String(r.marks) }),
        D.el("td", null, [
          D.el("span.grade-move", null, [
            gradeChip(r.grade || "?", gi >= 0 ? gi : 7),
            r.changed
              ? D.el("span.row-marker", null, [
                  D.icon(movedUp ? "arrow-up" : "arrow-down", 11),
                  r.before + " → " + r.grade
                ])
              : null
          ])
        ]),
        D.el("td.num.cell-muted", {
          text: r.band === null || r.band === undefined ? "—" : range(bands[r.band])
        })
      ]);
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    host.appendChild(D.el("div.table-wrap.table-scroll", null, table));

    if (rows.length > shown) {
      host.appendChild(
        D.el("p.table-foot", {
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
        D.el("p.table-foot", {
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

  /** A band's range for display: "80–100", with a true en dash. */
  function range(band) {
    return CF.grading.rangeLabel(band).replace("-", "\u2013");
  }

  function gradeChip(grade, index) {
    var i = index === null || index === undefined || index < 0 ? 7 : index;
    return D.el("span.grade-chip", {
      dataset: { tone: i >= 4 ? "light" : "deep" },
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

  function ariaForSpread(stats, groups) {
    return (
      "Class spread from " + stats.min + " to " + stats.max +
      ". Middle half of the class between " + fmt(stats.q1) + " and " + fmt(stats.q3) +
      ", median " + fmt(stats.median) +
      (stats.mean !== null ? ", mean " + stats.mean.toFixed(1) : "") +
      ". Score groups: " +
      groups
        .map(function (g) {
          return g.min + " to " + g.max + ", " + g.count + " " + U.pluralise(g.count, "student");
        })
        .join("; ")
    );
  }

  CF.analysePanel = {
    renderStats: renderStats,
    renderClusters: renderClusters,
    renderDefaultPreview: renderDefaultPreview,
    renderStudents: renderStudents,
    gradeChip: gradeChip,
    range: range
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
