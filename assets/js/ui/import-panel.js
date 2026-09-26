/**
 * Import surface: dropzone, file status, import health report, course picker.
 *
 * This is where the starter was weakest: it accepted any file silently, reported
 * nothing when a file could not be read, and produced one <option> per student
 * row. Here every outcome - success, partial success, or failure - has a
 * designed state that tells the instructor what happened and what to do next.
 */
(function (root) {
  "use strict";

  var CF = (root.CF = root.CF || {});
  var D = CF.dom;
  var U = CF.util;

  function readArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(new Error("The browser could not read this file."));
      };
      reader.onabort = function () {
        reject(new Error("Reading the file was cancelled."));
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function init(opts) {
    var input = document.getElementById("fileInput");
    var zone = document.getElementById("dropzone");
    var statusBox = document.getElementById("fileStatus");
    var errorBox = document.getElementById("importError");
    var reportBox = document.getElementById("importReport");
    var courseBox = document.getElementById("coursePicker");

    function clearError() {
      D.clear(errorBox);
    }

    function showBusy(file) {
      clearError();
      D.clear(statusBox);
      D.clear(reportBox);
      reportBox.hidden = true;
      statusBox.appendChild(
        D.el("div.filechip", null, [
          iconBox("sheet", "busy"),
          D.el("div.filechip__body", null, [
            D.el("div.filechip__name.truncate", { text: file.name }),
            D.el("div.filechip__meta", null, [
              D.el("span.spinner", { "aria-hidden": "true", style: { display: "inline-block", "vertical-align": "-3px", "margin-right": "6px" } }),
              "Reading and validating " + U.formatBytes(file.size) + "…"
            ])
          ])
        ])
      );
    }

    function showIdle() {
      D.clear(statusBox);
      D.clear(errorBox);
    }

    function showFatal(analysis, file) {
      D.clear(statusBox);
      D.clear(reportBox);
      reportBox.hidden = true;
      D.clear(errorBox);
      var f = analysis.fatal || {};
      var body = D.el("div", null, [
        D.el("p", { text: f.detail || "The file could not be used." }),
        D.el("p", { style: { "margin-top": "6px" }, text: f.remedy || "" })
      ]);
      var extra = D.el("div");
      if (f.foundHeaders && f.foundHeaders.length) {
        extra.appendChild(
          D.el("p", { style: { "margin-top": "10px", "font-size": "var(--fs-xs)" } }, [
            D.el("b", { text: "Headers found: " })
          ])
        );
        extra.appendChild(
          D.el("p", {
            style: { "margin-top": "4px", "font-family": "var(--font-mono)", "font-size": "var(--fs-xs)", color: "var(--c-ink-600)" },
            text: f.foundHeaders.map(function (h) { return h.text; }).join("  |  ")
          })
        );
      }
      if (f.sheets && f.sheets.length) {
        extra.appendChild(
          D.el("p", {
            style: { "margin-top": "10px", "font-size": "var(--fs-xs)" },
            text: "Sheets in this file: " + f.sheets.map(function (s) { return s.name + " (" + s.rows + " rows)"; }).join(", ")
          })
        );
      }
      body.appendChild(extra);

      errorBox.appendChild(
        D.notice("danger", "error", (f.title || "That file could not be used") + (file ? " — " + file.name : ""), body)
      );
      var actions = D.el("div.cluster", { style: { "margin-top": "var(--sp-3)" } }, [
        D.button({
          label: "Choose a different file",
          variant: "secondary",
          size: "sm",
          icon: "sheet",
          onClick: function () {
            input.click();
          }
        }),
        D.button({
          label: "Load demo class instead",
          variant: "ghost",
          size: "sm",
          icon: "sparkle",
          onClick: opts.onLoadDemo
        })
      ]);
      errorBox.appendChild(actions);
    }

    function showSuccess(analysis, file) {
      D.clear(errorBox);
      D.clear(statusBox);
      var isDemo = !!(analysis.meta && analysis.meta.demo);
      statusBox.appendChild(
        D.el("div.filechip", null, [
          iconBox("sheet", "ok"),
          D.el("div.filechip__body", null, [
            D.el("div.filechip__name.truncate", { text: file.name }),
            D.el("div.filechip__meta", {
              text:
                U.formatBytes(file.size) +
                "  ·  sheet \"" +
                (analysis.sheet ? analysis.sheet.name : "Sheet1") +
                "\"  ·  header on row " +
                (analysis.headerRow + 1)
            })
          ]),
          isDemo ? D.badge("Demo data", "info", { title: "Synthetic records for demonstration" }) : null,
          D.button({
            label: "Replace",
            variant: "ghost",
            size: "sm",
            onClick: function () {
              input.click();
            }
          })
        ])
      );
    }

    function handleFile(file) {
      if (!file) return;
      if (!U.isBlank(file.name) && !CF.workbook.isSupportedName(file.name)) {
        showIdle();
        D.clear(statusBox);
        D.clear(errorBox);
        D.clear(reportBox);
        reportBox.hidden = true;
        errorBox.appendChild(
          D.notice(
            "danger",
            "error",
            "\"" + file.name + "\" is not a spreadsheet this console can read",
            D.el("p", {
              text:
                "Supported file types are .xlsx, .xls, .xlsm and .csv. If your file has another " +
                "extension, re-export the marks sheet from your spreadsheet as one of those."
            })
          )
        );
        return;
      }
      showBusy(file);
      // Yield a frame so the busy state is actually painted before we parse.
      requestAnimationFrame(function () {
        readArrayBuffer(file)
          .then(function (buf) {
            var analysis = CF.workbook.readWorkbook(buf, root.XLSX, {
              name: file.name,
              size: file.size
            });
            if (!analysis.ok) {
              showFatal(analysis, file);
              opts.onFailed && opts.onFailed(analysis, file);
              return;
            }
            showSuccess(analysis, file);
            renderReport(reportBox, analysis, file, {
              onReplace: function () {
                input.click();
              },
              onRounding: opts.onRounding
            });
            renderCourses(courseBox, analysis, null, opts.onCourse);
            opts.onLoaded(analysis, file);
          })
          .catch(function (err) {
            showIdle();
            D.clear(statusBox);
            errorBox.appendChild(
              D.notice("danger", "error", "The file could not be read", D.el("p", { text: err.message }))
            );
            opts.onFailed && opts.onFailed({ fatal: { title: "Unreadable file" } }, file);
          });
      });
    }

    input.addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      handleFile(file);
      // Allow re-selecting the same file after an edit.
      input.value = "";
    });

    var depth = 0;
    ["dragenter", "dragover"].forEach(function (type) {
      zone.addEventListener(type, function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (type === "dragenter") depth++;
        zone.dataset.dragging = "true";
      });
    });
    zone.addEventListener("dragleave", function (e) {
      e.preventDefault();
      depth = Math.max(0, depth - 1);
      if (depth === 0) zone.dataset.dragging = "false";
    });
    zone.addEventListener("drop", function (e) {
      e.preventDefault();
      e.stopPropagation();
      depth = 0;
      zone.dataset.dragging = "false";
      var dt = e.dataTransfer;
      if (!dt) return;
      var file = dt.files && dt.files[0];
      if (!file) {
        D.clear(errorBox);
        errorBox.appendChild(
          D.notice("warning", "alert", "That drop did not contain a file", D.el("p", { text: "Drag a single .xlsx, .xls, .xlsm or .csv file into the area." }))
        );
        return;
      }
      handleFile(file);
    });

    // Stop the browser from navigating away when a file misses the target.
    ["dragover", "drop"].forEach(function (t) {
      window.addEventListener(t, function (e) {
        if (e.target === zone || zone.contains(e.target)) return;
        e.preventDefault();
      });
    });

    return {
      handleFile: handleFile,
      showIdle: showIdle,
      reportHandlers: function () {
        return { onReplace: function () { input.click(); }, onRounding: opts.onRounding };
      },
      reset: function () {
        D.clear(statusBox);
        D.clear(errorBox);
        D.clear(reportBox);
        reportBox.hidden = true;
        D.clear(courseBox);
        courseBox.hidden = true;
      }
    };
  }

  function iconBox(name, state) {
    return D.el("div.filechip__icon", { dataset: { state: state === "ok" ? "ok" : state }, "aria-hidden": "true" }, [
      D.icon(name, 17)
    ]);
  }

  /* ==================================================================== *
   * Import health report
   * ==================================================================== */

  function renderReport(host, a, file, handlers) {
    D.clear(host);
    host.hidden = false;

    var c = a.counts;
    var hasErrors = c.rejected > 0;
    var hasWarnings = c.normalised > 0;

    var headline = hasErrors
      ? D.notice(
          "warning",
          "alert",
          "Imported with " + c.rejected + " rejected " + U.pluralise(c.rejected, "row"),
          D.el("p", {
            text:
              c.accepted +
              " " +
              U.pluralise(c.accepted, "row") +
              " across " +
              a.courses.length +
              " " +
              U.pluralise(a.courses.length, "course") +
              " can be graded. The rejected rows are listed below with their row numbers - they were " +
              "not graded and were not included in any count."
          })
        )
      : hasWarnings
      ? D.notice(
          "success",
          "check-circle",
          "All " + c.accepted + " rows are valid",
          D.el("p", {
            text:
              c.normalised +
              " " +
              U.pluralise(c.normalised, "value") +
              " were normalised under the challenge's rounding rule. " +
              "The original and the value used are both listed below."
          })
        )
      : D.notice(
          "success",
          "check-circle",
          "All " + c.accepted + " rows are valid",
          D.el("p", {
            text:
              c.normalised +
              " " +
              U.pluralise(c.normalised, "value") +
              " " +
              (c.normalised === 1 ? "was" : "were") +
              " read or rounded rather than taken at face value. " +
              "The original and the value used are both listed below."
          })
        );

    var panel = D.el("section.panel");
    var head = D.el("div.panel__head", null, [
      D.el("div", null, [
        D.el("h3.panel__title", { text: "Data health" }),
        D.el("p.panel__hint", {
          text: "Checked before any grading is possible. Row numbers match the spreadsheet."
        })
      ]),
      D.badge(
        hasErrors ? c.rejected + " rejected" : hasWarnings ? c.normalised + " normalised" : "Clean",
        hasErrors ? "warning" : hasWarnings ? "info" : "success",
        { title: hasErrors ? "Some rows were rejected" : "No rows were rejected" }
      )
    ]);
    panel.appendChild(head);

    var body = D.el("div.panel__body", { style: { display: "flex", "flex-direction": "column", gap: "var(--sp-4)" } });
    body.appendChild(headline);

    body.appendChild(
      D.el("div.metric-row", null, [
        D.metric("Rows accepted", String(c.accepted), "ready to grade", c.accepted ? "success" : "danger"),
        D.metric("Rows rejected", String(c.rejected), hasErrors ? "not graded" : "none", hasErrors ? "warning" : null),
        D.metric("Values normalised", String(c.normalised), c.normalised ? "rounded or reformatted" : "none", c.normalised ? "info" : null),
        D.metric("Courses found", String(a.courses.length), plural(a.courses.length, "course", "courses")),
        D.metric("Students", String(c.accepted), "total across all courses"),
        D.metric("Mark range", a.stats.count ? a.stats.min + "–" + a.stats.max : "—", a.stats.count ? "out of 100" : "no data")
      ])
    );

    /* --- fractional mark policy ---------------------------------------- */
    if (a.fractionalCount > 0) {
      body.appendChild(roundingControl(a, handlers.onRounding));
    }

    /* --- provenance -------------------------------------------------- */
    var provRows = [
      ["File", a.meta && a.meta.demo ? a.meta.name + " (demo data)" : a.meta.name],
      ["Size", U.formatBytes(a.meta.size)],
      ["Sheet read", a.sheet ? a.sheet.name : "Sheet1"],
      ["Header row", "row " + (a.headerRow + 1)],
      [
        "Columns matched",
        ["id", "course", "marks"]
          .map(function (f) {
            return a.columns[f] ? a.columns[f].header + " → " + CF.workbook.FIELD_LABEL[f] : null;
          })
          .join("  ·  ")
      ]
    ];
    if (a.sheet && a.sheet.skipped.length) {
      provRows.push(["Sheets ignored", a.sheet.skipped.join(", ") + " (no marks table)"]);
    }
    if (a.ignoredColumns.length) {
      provRows.push(["Extra columns ignored", a.ignoredColumns.join(", ")]);
    }
    if (a.blankRows) {
      provRows.push(["Blank rows skipped", String(a.blankRows)]);
    }
    var dl = D.el("dl.dl");
    provRows.forEach(function (r) {
      dl.appendChild(D.el("dt", { text: r[0] }));
      dl.appendChild(D.el("dd", { text: r[1] }));
    });
    body.appendChild(
      D.el("details.disclosure", null, [
        D.el("summary.disclosure__summary", null, [
          D.el("span.disclosure__chev", { "aria-hidden": "true" }, [D.icon("chevron", 14)]),
          "What was read from the file"
        ]),
        D.el("div.disclosure__body", null, dl)
      ])
    );

    /* --- rejected rows ----------------------------------------------- */
    var errors = a.issues.filter(function (i) { return i.severity === "error"; });
    if (errors.length) {
      body.appendChild(issueTable("Rejected rows", errors, "danger", "These rows were not graded. Fix them in the source file and upload it again."));
    }

    var warnings = a.issues.filter(function (i) { return i.severity === "warning"; });
    if (warnings.length) {
      body.appendChild(
        issueTable("Normalised values", warnings, "warning", "Kept, but the value used differs from the value in the file. Both are shown.")
      );
    }

    var infos = a.issues.filter(function (i) { return i.severity === "info"; });
    if (infos.length) {
      var infoBox = D.el("div");
      infos.forEach(function (i) {
        infoBox.appendChild(
          D.el("div", { style: { "font-size": "var(--fs-xs)", "padding-block": "5px" } }, [
            D.el("b", { text: i.label + ". " }),
            D.el("span", { text: i.problem + " " + i.remedy })
          ])
        );
      });
      body.appendChild(
        D.el("details.disclosure", null, [
          D.el("summary.disclosure__summary", null, [
            D.el("span.disclosure__chev", { "aria-hidden": "true" }, [D.icon("chevron", 14)]),
            "Notes",
            D.el("span.disclosure__count", { text: String(infos.length) })
          ]),
          D.el("div.disclosure__body", null, infoBox)
        ])
      );
    }

    var actions = D.el("div.cluster", { style: { "margin-top": "var(--sp-4)" } });
    if (errors.length || warnings.length) {
      actions.appendChild(
        D.button({
          label: "Download " + (errors.length + warnings.length) + " row report",
          variant: "secondary",
          size: "sm",
          icon: "download",
          onClick: function () {
            D.download(CF.exporters.rejectedFileName(new Date()), CF.exporters.rejectedRowsCsv(a));
            CF.toast.success("Row report downloaded", "Fix the rows listed in it, then upload the file again.");
          }
        })
      );
    }
    actions.appendChild(
      D.button({
        label: "Choose a different file",
        variant: "ghost",
        size: "sm",
        icon: "reset",
        onClick: handlers.onReplace
      })
    );
    body.appendChild(actions);

    panel.appendChild(body);
    host.appendChild(panel);
  }

  /**
   * The challenge brief says fractional marks are "rounded to the nearest
   * integer" and then illustrates that with 80.2 -> 81, which is not the
   * nearest integer. Rather than guess, the policy is surfaced here and the
   * instructor decides. Every value that was rounded is listed below either
   * way, with the original.
   */
  function roundingControl(a, onRounding) {
    var id = "roundingPolicy";
    var select = D.el("select.input", { id: id }, [
      D.el("option", { value: "nearest", selected: (a.rounding || "nearest") === "nearest" ? true : null, text: "Round to the nearest whole mark  (80.2 → 80)" }),
      D.el("option", { value: "up", selected: a.rounding === "up" ? true : null, text: "Always round up  (80.2 → 81)" }),
      D.el("option", { value: "down", selected: a.rounding === "down" ? true : null, text: "Always round down  (80.2 → 80)" })
    ]);
    select.addEventListener("change", function () {
      if (onRounding) onRounding(select.value);
    });

    return D.el("div", {
      style: {
        padding: "var(--sp-4)",
        "border-radius": "var(--r-md)",
        background: "var(--c-white)",
        border: "1px solid var(--c-info-line)"
      }
    }, [
      D.el("div", { style: { display: "flex", gap: "10px", "align-items": "flex-start" } }, [
        D.el("span", { style: { color: "var(--c-info)", "margin-top": "2px" }, "aria-hidden": "true" }, [D.icon("info", 17)]),
        D.el("div", { style: { flex: "1 1 auto", "min-width": "0" } }, [
          D.el("p", { style: { "font-weight": "650", color: "var(--c-ink-900)" }, text: a.fractionalCount + " fractional " + plural(a.fractionalCount, "mark needs", "marks need") + " a rounding rule" }),
          D.el("p.field__hint", {
            style: { "margin-top": "4px" },
            text:
              "Marks must be whole numbers, so these need a rounding decision. The challenge brief " +
              "describes this as rounding “to the nearest integer” but illustrates it with 80.2 → 81, " +
              "which is not the nearest integer. Choose the rule your institution uses — every " +
              "original and rounded value is listed below either way."
          })
        ])
      ]),
      D.el("div.field", { style: { "margin-top": "var(--sp-3)" } }, [
        D.el("label.field__label", { for: id, text: "Rounding rule" }),
        select
      ])
    ]);
  }

  function issueTable(title, issues, tone, hint) {    var rows = issues
      .slice()
      .sort(function (x, y) { return (x.row || 0) - (y.row || 0); })
      .map(function (i) {
        return D.el("tr", null, [
          D.el("td.num.cell-strong", { text: i.row === null ? "—" : String(i.row) }),
          D.el("td", null, [
            D.el("div.cell-strong", { text: i.label }),
            D.el("div", { style: { "font-size": "var(--fs-xs)", color: "var(--c-ink-500)" }, text: i.remedy })
          ]),
          D.el("td", null, [
            D.el("code", { text: '"' + i.raw + '"' }),
            i.resolved !== undefined
              ? D.el("div", {
                  style: { "font-size": "var(--fs-2xs)", color: "var(--c-ink-500)", "margin-top": "2px" },
                  text: "used " + i.resolved
                })
              : null
          ])
        ]);
      });

    var table = D.el("table.data");
    var thead = D.el("thead");
    thead.appendChild(
      D.el("tr", null, [
        D.el("th.num", { scope: "col", text: "Row" }),
        D.el("th", { scope: "col", text: "Problem and fix" }),
        D.el("th", { scope: "col", text: "Value in file" })
      ])
    );
    table.appendChild(thead);
    var tbody = D.el("tbody");
    rows.forEach(function (r) { tbody.appendChild(r); });
    table.appendChild(tbody);

    return D.el("details.disclosure", { open: tone === "danger" ? true : null }, [
      D.el("summary.disclosure__summary", null, [
        D.el("span.disclosure__chev", { "aria-hidden": "true" }, [D.icon("chevron", 14)]),
        title,
        D.el("span.disclosure__count", { text: String(issues.length) })
      ]),
      D.el("div.disclosure__body", null, [
        D.el("p.field__hint", { style: { "margin-bottom": "var(--sp-3)" }, text: hint }),
        D.el("div.table-wrap.table-scroll", null, table)
      ])
    ]);
  }

  /* ==================================================================== *
   * Course picker
   * ==================================================================== */

  function renderCourses(host, a, selectedKey, onSelect) {
    D.clear(host);
    host.hidden = false;

    if (!a.courses.length) {
      host.appendChild(
        D.notice("danger", "error", "This file contains no courses", D.el("p", { text: "Every row was rejected, so there is nothing to grade." }))
      );
      return;
    }

    var panel = D.el("section.panel");
    panel.appendChild(
      D.el("div.panel__head", null, [
        D.el("div", null, [
          D.el("h3.panel__title", { text: "Which course are you grading?" }),
          D.el("p.panel__hint", {
            text:
              a.courses.length +
              " " +
              plural(a.courses.length, "course", "courses") +
              " in this file. Grade bands are set per course and do not leak into the next one."
          })
        ])
      ])
    );

    var body = D.el("div.panel__body");
    var list = D.el("div.course-list", { role: "list" });
    a.courses.forEach(function (c) {
      var card = D.el(
        "button.course-card",
        {
          type: "button",
          role: "listitem",
          dataset: { courseKey: c.key, selected: selectedKey === c.key ? "true" : "false" }
        },
        [
          D.el("span.course-card__name", { text: c.name }),
          D.el("span.course-card__meta", null, [
            D.el("span", { text: c.count + " " + plural(c.count, "student", "students") }),
            D.el("span", { text: "mean " + (c.mean === null ? "—" : c.mean.toFixed(1)) }),
            D.el("span", { text: c.min + "–" + c.max })
          ])
        ]
      );
      if (c.count <= 7) {
        card.appendChild(
          D.el("span.course-card__flag", null, [
            D.badge("Small class", "neutral", { title: "Fewer than 8 students - statistics will be unstable" })
          ])
        );
      }
      card.addEventListener("click", function () {
        onSelect(c.key);
      });
      list.appendChild(card);
    });
    body.appendChild(list);
    panel.appendChild(body);
    host.appendChild(panel);
  }

  function plural(n, one, many) {
    return n === 1 ? one : many;
  }

  CF.importPanel = {
    init: init,
    readArrayBuffer: readArrayBuffer,
    renderReport: renderReport,
    renderCourses: renderCourses
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
