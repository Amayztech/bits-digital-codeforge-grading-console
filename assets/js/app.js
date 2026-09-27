/**
 * Application orchestration.
 *
 * Owns the single source of truth for a grading session and keeps every panel
 * derived from it. Nothing in the UI holds authoritative state, so "what the
 * screen shows" and "what gets exported" cannot drift apart - which was the
 * most damaging class of defect in the starter console.
 */
(function (root) {
  "use strict";

  var CF = root.CF;
  var D = CF.dom;
  var U = CF.util;
  var G = CF.grading;
  var S = CF.statistics;

  var DRAFT_KEY = "codeforge.grading.draft.v1";
  var DRAFT_LIMIT = 1.5 * 1024 * 1024;

  /* ==================================================================== *
   * Session state
   * ==================================================================== */

  var state = {
    analysis: null,
    courseKey: null,
    courseName: null,
    cohort: [],
    cutoffs: G.defaults(),
    baseline: null,
    history: [],
    instructor: "",
    stage: "import",
    visited: { import: true },
    finalized: null,
    studentSort: { key: "id", dir: "asc" },
    studentQuery: "",
    isDemo: false,
    persist: false,
    file: null
  };

  var charts = {};
  var editor = null;
  var importApi = null;
  var reviewChart = null;
  var lastRange = null;
  var flashTimer = 0;
  var lastAnnounced = "";

  /* ==================================================================== *
   * Active grading time
   *
   * Starts when a course is opened for grading, pauses when the tab is hidden
   * and stops at finalize. The starter began counting at page load, so opening
   * the console to check a file and closing it reported a "grading time" of
   * however long the tab had been open.
   * ==================================================================== */

  var timer = { running: false, accumulated: 0, startedAt: 0, engaged: false, stopped: false };

  function elapsed() {
    return timer.accumulated + (timer.running ? Date.now() - timer.startedAt : 0);
  }

  function timerStart() {
    if (timer.stopped) return;
    timer.engaged = true;
    if (timer.running) return;
    timer.running = true;
    timer.startedAt = Date.now();
    renderTimer();
  }

  function timerPause() {
    if (!timer.running) return;
    timer.accumulated += Date.now() - timer.startedAt;
    timer.running = false;
    renderTimer();
  }

  function timerStop() {
    timerPause();
    timer.stopped = true;
    renderTimer();
  }

  function timerReset() {
    timer.running = false;
    timer.accumulated = 0;
    timer.startedAt = 0;
    timer.engaged = false;
    timer.stopped = false;
    renderTimer();
  }

  function renderTimer() {
    var node = document.getElementById("timer");
    var value = document.getElementById("timerValue");
    var label = document.getElementById("timerState");
    var arc = document.getElementById("timerArc");
    var ms = elapsed();
    var circumference = 2 * Math.PI * 10.5;
    var stateName = !timer.engaged ? "idle" : timer.stopped ? "stopped" : timer.running ? "running" : "paused";
    node.dataset.state = stateName;
    value.textContent = U.formatDuration(ms);
    label.textContent =
      stateName === "idle" ? "Idle" : stateName === "stopped" ? "Final" : stateName === "paused" ? "Paused" : "Active";
    // The ring fills once per hour, then stays full - it is a glanceable
    // indicator, not a countdown.
    var frac = Math.min(1, (ms % 3600000) / 3600000);
    arc.setAttribute("stroke-dashoffset", String(circumference * (1 - frac)));
    node.title = timer.engaged
      ? "Active grading time: " + U.formatDuration(ms) + ". " + (stateName === "paused" ? "Paused because this tab is in the background." : "Counts only while this tab is in the foreground.")
      : "Active grading time starts when you open a course for grading.";
  }

  setInterval(function () {
    if (timer.running) renderTimer();
  }, 1000);

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      if (timer.running) {
        timerPause();
        announce("Grading timer paused while this tab is in the background.");
      }
    } else if (timer.engaged && !timer.stopped) {
      timerStart();
    }
  });

  /* ==================================================================== *
   * Announcements
   * ==================================================================== */

  function announce(message) {
    if (message === lastAnnounced) return;
    lastAnnounced = message;
    var live = document.getElementById("liveStatus");
    if (live) live.textContent = message;
  }

  /* ==================================================================== *
   * Stage navigation
   * ==================================================================== */

  function setStage(next, opts) {
    opts = opts || {};
    state.stage = next;
    state.visited[next] = true;
    D.$$(".stage").forEach(function (node) {
      var active = node.dataset.stage === next;
      node.dataset.active = active ? "true" : "false";
      if (active) node.removeAttribute("hidden");
      else node.setAttribute("hidden", "");
      // The review stage is the printable report; the print stylesheet hides
      // every stage that is not marked printable.
      if (next === "review") node.setAttribute("data-printable", "true");
      else node.removeAttribute("data-printable");
    });
    renderStageBar();
    if (opts.announce !== false) {
      var title = D.$("#" + next + " .stage__title");
      announce((title ? title.textContent : next) + " stage.");
    }
    if (opts.scroll !== false) {
      var main = document.getElementById("main");
      if (main) main.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }
  }

  function prefersReducedMotion() {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function renderStageBar() {
    var hasFile = !!state.analysis;
    var hasCourse = !!state.courseKey;
    var v = state.visited;
    var map = {
      import: hasFile ? "done" : "active",
      validate: hasFile ? "done" : "pending",
      analyse: hasCourse ? (v.configure || v.review ? "done" : "active") : "pending",
      configure: v.review ? "done" : v.configure ? "active" : "pending",
      review: state.finalized ? "done" : v.review ? "active" : "pending",
      export: state.finalized ? "done" : "pending"
    };

    D.$$(".stage-step").forEach(function (node) {
      var key = node.dataset.stage;
      var st = map[key] || "pending";
      node.dataset.state = st;
      // Only stages the instructor has actually reached are navigable.
      var reachable = !!v[key] || (key === "import") || (key === "analyse" && hasCourse);
      node.disabled = !reachable;
      if (st === "active") node.setAttribute("aria-current", "step");
      else node.removeAttribute("aria-current");
      var num = node.querySelector(".stage-step__num");
      if (!num) return;
      var done = st === "done";
      if (done && !num.firstElementChild) {
        num.textContent = "";
        num.appendChild(D.icon("check", 11));
      } else if (!done && num.firstElementChild) {
        num.textContent = String(D.$$(".stage-step").indexOf(node) + 1);
      }
    });

    var doneCount = Object.keys(map).filter(function (k) {
      return map[k] === "done";
    }).length;
    var fill = document.getElementById("stageFill");
    if (fill) fill.style.width = (doneCount / 6) * 100 + "%";
    renderStageContext();
    renderContext();
  }

  /**
   * The course is named in the stage eyebrow so it stays visible on narrow
   * screens where the header chip is hidden.
   */
  function renderStageContext() {
    D.$$(".stage__context").forEach(function (node) {
      if (!state.courseKey) {
        node.textContent = "";
        node.hidden = true;
        return;
      }
      node.hidden = false;
      node.textContent =
        "  \u00b7  " + state.courseName + "  \u00b7  " + state.cohort.length + " " +
        U.pluralise(state.cohort.length, "student");
    });
  }

  function renderContext() {
    var chip = document.getElementById("contextChip");
    var course = document.getElementById("contextCourse");
    var meta = document.getElementById("contextMeta");
    if (state.courseKey) {
      chip.dataset.visible = "true";
      course.textContent = state.courseName;
      meta.textContent = state.cohort.length + " students";
      chip.title =
        state.courseName +
        " — " +
        state.cohort.length +
        " students, mean " +
        (S.describe(state.cohort.map(function (r) { return r.marks; })).mean || 0).toFixed(1);
    } else {
      chip.dataset.visible = "false";
    }
    // The command bar states where the session stands in one word.
    var empty = document.getElementById("contextEmpty");
    var status = document.getElementById("contextStatus");
    if (empty) {
      empty.hidden = !!state.courseKey;
      empty.textContent = state.analysis ? "Select a course to grade" : "No marks imported";
    }
    if (status) {
      var tone = state.finalized ? "final" : state.analysis ? (state.isDemo ? "demo" : "valid") : null;
      status.hidden = !tone;
      if (tone) {
        status.dataset.tone = tone;
        status.textContent =
          tone === "final" ? "Finalized" :
          tone === "demo" ? "Demo data · validated" :
          "Validated · " + state.analysis.counts.accepted + " rows";
      }
    }
    // Only nag about a missing instructor name once it actually matters.
    instructorInvalid(
      state.stage === "review" && !state.instructor.trim()
        ? "Enter your name in the field at the top of the screen so the report can be attributed."
        : ""
    );
  }

  /* ==================================================================== *
   * Import flow
   * ==================================================================== */

  function setOnboarding(visible) {
    var board = document.getElementById("importOnboarding");
    var help = document.getElementById("showOnboarding");
    if (board) board.hidden = !visible;
    if (help) help.hidden = visible;
    // The same page is upload mode before a file and data-health mode after.
    var title = document.getElementById("importTitle");
    var desc = document.querySelector("#stage-import .stage__desc");
    if (title) title.textContent = visible ? "Import marks" : "Data health";
    if (desc) {
      desc.textContent = visible
        ? "Upload a workbook. Its structure and every row are validated before any grade exists."
        : "What was read from the workbook, what was corrected, and the courses it contains.";
    }
  }

  function adoptAnalysis(analysis, file) {
    state.analysis = analysis;
    state.isDemo = !!(analysis.meta && analysis.meta.demo);
    state.file = file || (analysis.meta ? { name: analysis.meta.name, size: analysis.meta.size } : null);
    state.courseKey = null;
    state.courseName = null;
    state.cohort = [];
    state.cutoffs = G.defaults();
    state.baseline = null;
    state.history = [];
    state.finalized = null;
    state.studentQuery = "";
    state.studentSort = { key: "id", dir: "asc" };
    state.visited.configure = false;
    state.visited.review = false;
    lastRange = null;
    // Once a file is in, the format guidance has done its job and the course
    // picker is what matters.
    setOnboarding(false);
    // Anything belonging to the previous grade set must not survive.
    D.clear(document.getElementById("reviewBody"));
    D.clear(document.getElementById("draftNotice"));
    document.getElementById("draftNotice").hidden = true;
    timerReset();
    if (editor) editor.render(editorState());
    renderStageBar();
    renderContext();
    if (state.persist) saveDraft();
    return analysis;
  }

  function onLoaded(analysis, file) {
    adoptAnalysis(analysis, file);
    announce(
      "Imported " +
        analysis.counts.accepted +
        " rows across " +
        analysis.courses.length +
        " courses. " +
        (analysis.counts.rejected
          ? analysis.counts.rejected + " rows were rejected and are listed in the data health report."
          : "No rows were rejected.")
    );
  }

  /**
   * Re-run validation with a different fractional-mark policy. The rows are
   * still in memory, so this never re-reads the file.
   */
  function reapplyRounding(policy) {
    if (!state.analysis || !state.analysis.sourceRows) return;
    var meta = Object.assign({}, state.analysis.meta, { rounding: policy });
    var next = CF.workbook.readRows(state.analysis.sourceRows, meta);
    next.sheet = state.analysis.sheet;
    if (!next.ok) return;
    /*
     * Same file, same course, same instructor decisions: only the marks move.
     * adoptAnalysis and onCourseSelected both start a *new* grade set, so the
     * band configuration, its history and the grading time are carried across
     * explicitly - otherwise switching the rounding rule silently threw away
     * every cutoff the instructor had set. Finalized state is still cleared by
     * those calls, because the marks it was finalized on have changed.
     */
    var courseKey = state.courseKey;
    var kept = {
      cutoffs: state.cutoffs.slice(),
      baseline: state.baseline ? state.baseline.slice() : null,
      history: state.history.slice(),
      visited: { configure: state.visited.configure, review: state.visited.review },
      timer: Object.assign({}, timer, { running: false, accumulated: elapsed() })
    };
    var wasRunning = timer.running;
    adoptAnalysis(next, state.file);
    if (courseKey && U.byKey(next.courses, courseKey)) {
      onCourseSelected(courseKey);
      state.cutoffs = kept.cutoffs;
      state.baseline = kept.baseline;
      state.history = kept.history;
      state.visited.configure = kept.visited.configure;
      state.visited.review = kept.visited.review;
      timer.accumulated = kept.timer.accumulated;
      timer.engaged = kept.timer.engaged;
      timer.running = false;
      if (wasRunning) timerStart();
      else renderTimer();
      renderAll();
      if (editor) editor.syncInputs();
      renderStageBar();
      setStage("import");
      if (state.persist) saveDraft();
    }
    CF.importPanel.renderReport(
      document.getElementById("importReport"),
      next,
      state.file,
      reportHandlers()
    );
    if (state.courseKey) {
      CF.importPanel.renderCourses(document.getElementById("coursePicker"), next, state.courseKey, onCourseSelected);
    }
    CF.toast.info(
      "Rounding rule changed",
      next.fractionalCount +
        " " +
        U.pluralise(next.fractionalCount, "mark is", 'marks are') +
        " now affected. All values are re-graded."
    );
  }

  function reportHandlers() {
    return {
      onReplace: function () {
        document.getElementById("fileInput").click();
      },
      onRounding: reapplyRounding
    };
  }

  function onCourseSelected(key) {
    var course = U.byKey(state.analysis.courses, key);
    if (!course) return;
    var cohort = state.analysis.records.filter(function (r) {
      return r.courseKey === key;
    });
    state.courseKey = key;
    state.courseName = course.name;
    state.cohort = cohort;
    state.cutoffs = G.defaults();
    state.baseline = null;
    state.history = [];
    state.finalized = null;
    lastRange = null;
    state.visited.configure = false;
    state.visited.review = false;
    timerReset();
    timerStart();

    CF.importPanel.renderCourses(document.getElementById("coursePicker"), state.analysis, key, onCourseSelected);
    instructorInvalid("");
    renderAll();
    setStage("analyse");
    if (state.persist) saveDraft();
    announce(
      "Selected " +
        course.name +
        " with " +
        cohort.length +
        " " +
        U.pluralise(cohort.length, "student") +
        ". Grading timer started."
    );
  }

  /* ==================================================================== *
   * Cutoffs
   * ==================================================================== */

  function setCutoff(index, value, source) {
    var before = state.cutoffs.slice();
    var res = G.applyCutoff(state.cutoffs, index, value);
    if (U.deepEqual(before, res.cutoffs)) return;
    state.baseline = before;
    state.cutoffs = res.cutoffs;
    state.finalized = null;

    var grade = G.GRADES[index];
    var clamped = res.clampedTo !== null;
    record({
      grade: grade,
      text:
        grade +
        " minimum: " +
        before[index] +
        " → " +
        res.cutoffs[index] +
        (clamped ? " (limited to the legal range for this band)" : ""),
      summary: grade + " " + before[index] + " → " + res.cutoffs[index],
      previous: before,
      source: source || "input"
    });

    flashRange(Math.min(before[index], res.cutoffs[index]), Math.max(before[index], res.cutoffs[index]));
    renderAll();
    if (clamped) {
      CF.toast.info(
        grade + " minimum limited to " + res.clampedTo,
        "It cannot pass the band above or below it, or some marks would fall outside every grade."
      );
    }
    if (state.persist) saveDraft();
  }

  /** Briefly highlight the marks whose grade just changed. */
  function flashRange(lo, hi) {
    lastRange = { lo: lo, hi: hi };
    renderConfigure();
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () {
      lastRange = null;
      if (charts.configure) {
        // Partial update: replacing the model here would drop the cutoffs.
        charts.configure.update({ affectedMarks: null });
      }
    }, 1500);
  }

  function record(entry) {
    state.history.push({
      id: "h" + Date.now() + "-" + state.history.length,
      time: new Date().toTimeString().slice(0, 5),
      text: entry.text,
      summary: entry.summary,
      // The configuration as it stood *before* this entry, so undo restores it
      // rather than re-applying it.
      previous: (entry.previous || state.cutoffs).slice(),
      after: state.cutoffs.slice(),
      at: Date.now()
    });
    if (state.history.length > 60) state.history.shift();
  }

  function undoHistory(id) {
    var idx = id
      ? state.history.findIndex(function (h) { return h.id === id; })
      : state.history.length - 1;
    if (idx < 0) return;
    var entry = state.history[idx];
    var after = state.cutoffs.slice();
    state.baseline = after;
    state.cutoffs = entry.previous.slice();
    state.history = state.history.slice(0, idx);
    state.finalized = null;
    record({
      text: "Undone: " + entry.text,
      summary: "reverted to " + entry.summary,
      previous: after,
      source: "undo"
    });
    renderAll();
    editor.syncInputs();
    CF.toast.success("Change undone", entry.text);
    announce("Undone: " + entry.text + ". Cutoffs are now " + state.cutoffs.join(", ") + ".");
    if (state.persist) saveDraft();
  }

  function resetToDefaults() {
    if (U.deepEqual(state.cutoffs, G.defaults())) {
      CF.toast.info("Already on the default bands", "Nothing to reset.");
      return;
    }
    var before = state.cutoffs.slice();
    state.baseline = before;
    state.cutoffs = G.defaults();
    state.finalized = null;
    record({
      text: "Reset all cutoffs to the challenge defaults",
      summary: G.describeCutoffs(G.defaults()),
      previous: before,
      source: "reset"
    });
    renderAll();
    editor.syncInputs();
    CF.toast.success("Default bands restored", "All seven cutoffs are back to the challenge values.", {
      actionLabel: "Undo",
      onAction: function () {
        undoHistory(state.history[state.history.length - 1].id);
      }
    });
    announce("Default grade bands restored. Undo is available.");
    if (state.persist) saveDraft();
  }

  function applySuggestion(cutoffs) {
    var before = state.cutoffs.slice();
    state.baseline = before;
    state.cutoffs = cutoffs.slice();
    state.finalized = null;
    record({
      text: "Applied suggested cutoffs from the class distribution",
      summary: before.join("/") + " → " + cutoffs.join("/"),
      previous: before,
      source: "suggest"
    });
    renderAll();
    CF.toast.success("Suggested cutoffs applied", "Review them, adjust anything you disagree with, then finalize.", {
      actionLabel: "Undo",
      onAction: function () {
        undoHistory(state.history[state.history.length - 1].id);
      }
    });
    if (state.persist) saveDraft();
  }

  /* ==================================================================== *
   * Render
   * ==================================================================== */

  function editorState() {
    return {
      cohort: state.cohort,
      cutoffs: state.cutoffs,
      baseline: state.baseline,
      getCutoffs: function () {
        return state.cutoffs;
      },
      onCutoff: setCutoff
    };
  }

  function affectedMarks() {
    if (!lastRange) return null;
    var set = new Set();
    for (var m = lastRange.lo; m < lastRange.hi; m++) set.add(m);
    return set;
  }

  function renderAll() {
    if (!state.analysis) return;
    renderAnalyse();
    renderConfigure();
    renderContext();
    renderStageBar();
  }

  function renderAnalyse() {
    var stats = S.describe(
      state.cohort.map(function (r) {
        return r.marks;
      })
    );
    CF.analysePanel.renderStats(document.getElementById("statsGrid"), stats, state.cohort);
    CF.analysePanel.renderClusters(document.getElementById("clusterPanel"), stats);
    CF.analysePanel.renderDefaultPreview(document.getElementById("defaultPreview"), state.cohort, G.defaults());

    var desc = document.getElementById("analyseDesc");
    if (desc) {
      desc.textContent = state.cohort.length
        ? stats.count +
          " " +
          U.pluralise(stats.count, "student") +
          " in " +
          state.courseName +
          ". These statistics are computed from exactly the rows that will be graded."
        : "No students in this course.";
    }

    var actions = document.getElementById("analyseActions");
    D.clear(actions);
    actions.appendChild(
      D.button({ label: "Change course", variant: "secondary", icon: "book", onClick: function () { setStage("import"); } })
    );
    actions.appendChild(
      D.button({
        label: "Configure grade bands",
        icon: "sliders",
        disabled: !state.cohort.length,
        onClick: function () {
          setStage("configure");
        }
      })
    );

    if (!charts.analyse) {
      charts.analyse = CF.chart.create(document.getElementById("chartAnalyse"), {
        marks: state.cohort.map(function (r) { return r.marks; }),
        stats: stats
      });
      renderChartLegend("analyse", false);
    } else {
      charts.analyse.update({
        marks: state.cohort.map(function (r) { return r.marks; }),
        stats: stats
      });
    }

    CF.analysePanel.renderStudents(document.getElementById("studentTable"), {
      cohort: state.cohort,
      cutoffs: state.cutoffs,
      baseline: state.baseline,
      sort: state.studentSort,
      query: state.studentQuery,
      onSort: function (key) {
        if (state.studentSort.key === key) {
          state.studentSort.dir = state.studentSort.dir === "asc" ? "desc" : "asc";
        } else {
          state.studentSort = { key: key, dir: key === "id" ? "asc" : "desc" };
        }
        renderAnalyse();
        announce("Sorted by " + key + ", " + state.studentSort.dir + "ending.");
      }
    });
    var hint = document.getElementById("studentPanelHint");
    if (hint) {
      hint.textContent =
        state.cohort.length +
        " " +
        U.pluralise(state.cohort.length, "student") +
        " · grades reflect your current bands";
    }
  }

  function renderChartLegend(which, withBands) {
    var host = document.getElementById("chartLegend" + (which === "analyse" ? "Analyse" : "Configure"));
    if (!host) return;
    D.clear(host);
    if (withBands) {
      D.append(host, CF.chart.legend([
        { ramp: true, label: "Grades A → E" },
        { cut: true, label: "Cutoff" },
        { line: true, dashed: true, colour: "var(--c-ink-400)", label: "Median" },
        { colour: "var(--c-accent)", label: "Just moved" }
      ]));
    } else {
      D.append(host, CF.chart.legend([
        { colour: "var(--chart-g3)", label: "Students per mark" },
        { line: true, colour: "var(--c-ink-700)", label: "Median" },
        { line: true, dashed: true, colour: "var(--c-ink-400)", label: "Mean" }
      ]));
    }
  }

  function renderConfigure() {
    var stats = S.describe(
      state.cohort.map(function (r) {
        return r.marks;
      })
    );
    var bands = G.bandsFromCutoffs(state.cutoffs);
    var marks = state.cohort.map(function (r) { return r.marks; });
    if (!charts.configure) {
      charts.configure = CF.chart.create(document.getElementById("chartConfigure"), {
        marks: marks,
        stats: stats,
        bands: bands,
        cutoffs: state.cutoffs,
        affectedMarks: affectedMarks(),
        onCutoff: setCutoff
      });
      renderChartLegend("configure", true);
    } else {
      charts.configure.update({
        marks: marks,
        stats: stats,
        bands: bands,
        cutoffs: state.cutoffs,
        affectedMarks: affectedMarks()
      });
    }

    editor.render(editorState());

    var badge = document.getElementById("cutoffBadge");
    if (badge) {
      var isDefault = U.deepEqual(state.cutoffs, G.defaults());
      D.clear(badge);
      badge.className = "badge " + (isDefault ? "badge--neutral" : "badge--warning");
      badge.appendChild(
        document.createTextNode(isDefault ? "Defaults" : state.history.length + " change" + (state.history.length === 1 ? "" : "s"))
      );
    }

    var actions = document.getElementById("configureActions");
    D.clear(actions);
    actions.appendChild(
      D.button({
        label: "Undo",
        variant: "secondary",
        icon: "undo",
        disabled: !state.history.length,
        onClick: function () {
          undoHistory();
        }
      })
    );
    actions.appendChild(
      D.button({
        label: "Reset to defaults",
        variant: "secondary",
        icon: "reset",
        disabled: U.deepEqual(state.cutoffs, G.defaults()),
        onClick: resetToDefaults
      })
    );
    actions.appendChild(
      D.button({
        label: "Review & finalize",
        icon: "arrow-right",
        disabled: !state.cohort.length,
        onClick: function () {
          renderReview();
          setStage("review");
        }
      })
    );

    var impactMeta = document.getElementById("impactMeta");
    if (impactMeta) {
      impactMeta.textContent = state.baseline ? "Against the previous configuration" : "Against the default bands";
    }
    CF.impactPanel.renderImpact(document.getElementById("impactPanel"), {
      cohort: state.cohort,
      cutoffs: state.cutoffs,
      baseline: state.baseline,
      baselineLabel: state.baseline ? "previous configuration" : "default bands"
    });

    var histActions = document.getElementById("historyActions");
    D.clear(histActions);
    if (state.history.length) {
      histActions.appendChild(
        D.button({ label: "Undo last", variant: "ghost", size: "sm", icon: "undo", onClick: function () { undoHistory(); } })
      );
      histActions.appendChild(
        D.button({ label: "Clear log", variant: "ghost", size: "sm", icon: "trash", onClick: clearHistory })
      );
    }
    CF.impactPanel.renderHistory(document.getElementById("auditBody"), state.history, {
      canUndo: true,
      onUndo: undoHistory
    });

    renderSuggest();
  }

  function clearHistory() {
    if (!state.history.length) return;
    var snapshot = state.history.slice();
    state.history = [];
    state.baseline = null;
    renderConfigure();
    CF.toast.success("Change log cleared", "The cutoffs themselves are unchanged.", {
      actionLabel: "Undo",
      onAction: function () {
        state.history = snapshot;
        renderConfigure();
      }
    });
  }

  function renderSuggest() {
    var host = document.getElementById("suggestBody");
    D.clear(host);
    if (!state.cohort.length) {
      host.appendChild(D.emptyState("sparkle", "No students", ""));
      return;
    }
    var marks = state.cohort.map(function (r) { return r.marks; });
    var proposal = CF.suggest.suggest(marks);

    if (!proposal.ok) {
      host.appendChild(
        D.notice("info", "info", "A suggestion is not available", D.el("p", { text: proposal.reason }))
      );
      return;
    }

    var isCurrent = U.deepEqual(proposal.cutoffs, state.cutoffs);
    var preview = CF.suggest.preview(state.cohort, state.cutoffs, proposal.cutoffs);

    // cutoffs[i] is the minimum mark for GRADES[i], exactly as in the editor.
    var body = D.el("div.suggest", null, [
      D.el("ul.suggest__cuts", { "aria-label": "Suggested minimum mark for each grade" },
        proposal.cutoffs.map(function (c, i) {
          var differs = c !== state.cutoffs[i];
          return D.el("li.suggest__cut", { dataset: { differs: differs ? "true" : "false" } }, [
            CF.analysePanel.gradeChip(G.GRADES[i], i),
            D.el("span.suggest__value.num", { text: String(c) })
          ]);
        })
      ),
      D.el("div.suggest__row", null, [
        D.el("p.suggest__impact", { dataset: { tone: preview.changed ? "warning" : "neutral" } }, [
          D.el("span", { "aria-hidden": "true" }, [D.icon(preview.changed ? "alert" : "info", 14)]),
          D.el("span", null, preview.changed
            ? [
                D.el("b", { text: preview.changed + " " + U.pluralise(preview.changed, "student") + " would get a different grade" }),
                " · " + preview.up + " up, " + preview.down + " down"
              ]
            : ["Applying this would not change any student's grade."])
        ]),
        D.button({
          label: isCurrent ? "Already using these cutoffs" : "Apply these cutoffs",
          variant: "secondary",
          size: "sm",
          icon: isCurrent ? "check" : "sparkle",
          disabled: isCurrent,
          onClick: function () {
            applySuggestion(proposal.cutoffs);
          }
        })
      ]),
      D.el("p.suggest__method", {
        text: proposal.method + " A starting point only: never applied unless you press the button, and every boundary stays yours to change."
      })
    ]);
    host.appendChild(body);
  }

  /**
   * The review sheet is rebuilt from state on every visit, so its chart element
   * is created once here and handed to the panel to place. Re-creating it inside
   * the panel would orphan the chart instance, which captures its container.
   */
  function reviewChartHost() {
    if (!reviewChart) {
      reviewChart = D.el("div.chart", { id: "chartReview" });
    }
    return reviewChart;
  }

  function renderReview() {
    var host = document.getElementById("reviewBody");
    var reviewTitle = document.getElementById("reviewTitle");
    if (reviewTitle) reviewTitle.textContent = state.finalized ? "Grading complete" : "Final review";
    var chartHost = reviewChartHost();
    CF.reviewPanel.render(host, reviewState(), {
      chartHost: chartHost,
      onBack: function () {
        setStage("configure");
      },
      onPrint: function () {
        window.print();
      },
      onFinalize: function () {
        CF.reviewPanel.confirmExport(reviewState(), {
          onExport: doExport
        });
      }
    });
    var model = {
      marks: state.cohort.map(function (r) { return r.marks; }),
      stats: S.describe(state.cohort.map(function (r) { return r.marks; })),
      bands: G.bandsFromCutoffs(state.cutoffs),
      cutoffs: state.cutoffs,
      readOnly: true
    };
    if (!charts.review) {
      charts.review = CF.chart.create(chartHost, model);
    } else {
      charts.review.update(model);
    }
  }

  function reviewState() {
    return {
      analysis: state.analysis,
      courseName: state.courseName,
      cohort: state.cohort,
      cutoffs: state.cutoffs,
      baseline: state.baseline,
      instructor: state.instructor,
      history: state.history,
      isDemo: state.isDemo,
      finalized: state.finalized,
      elapsedMs: elapsed(),
      now: new Date()
    };
  }

  function doExport() {
    var now = new Date();
    var cutoffs = state.cutoffs.slice();
    var records = state.cohort.slice();
    var ctx = {
      instructor: state.instructor.trim(),
      course: state.courseName,
      cutoffs: cutoffs,
      records: records,
      stats: S.describe(records.map(function (r) { return r.marks; })),
      analysis: state.analysis,
      fileName: state.analysis.meta,
      sheet: state.analysis.sheet,
      counts: state.analysis.counts,
      generatedAt: now,
      elapsedMs: elapsed(),
      changedFrom: U.deepEqual(cutoffs, G.defaults()) ? null : G.defaults(),
      history: state.history
    };

    var gradesName = CF.exporters.gradesFileName(state.courseName, now);
    var summaryName = CF.exporters.summaryFileName(state.courseName, now);
    D.download(gradesName, CF.exporters.studentCsv(records, cutoffs));
    setTimeout(function () {
      D.download(summaryName, CF.exporters.summaryCsv(ctx));
    }, 220);

    state.finalized = { at: now, files: [gradesName, summaryName], elapsedMs: elapsed() };
    timerStop();
    renderStageBar();
    renderReview();
    setStage("review", { announce: false });
    announce(
      "Grade set finalized. " + records.length + " students exported to " + gradesName + " and " + summaryName + "."
    );
    return [gradesName, summaryName];
  }

  /* ==================================================================== *
   * Optional local draft
   * ==================================================================== */

  function saveDraft() {
    if (!state.persist || !state.analysis) return;
    try {
      var payload = {
        v: 1,
        at: Date.now(),
        isDemo: state.isDemo,
        meta: state.analysis.meta,
        sheet: state.analysis.sheet,
        headerRow: state.analysis.headerRow,
        columns: state.analysis.columns,
        records: state.analysis.records,
        issues: state.analysis.issues,
        courses: state.analysis.courses,
        counts: state.analysis.counts,
        rounding: state.analysis.rounding,
        fractionalCount: state.analysis.fractionalCount,
        sourceRows: state.analysis.sourceRows,
        ignoredColumns: state.analysis.ignoredColumns,
        blankRows: state.analysis.blankRows,
        courseKey: state.courseKey,
        instructor: state.instructor,
        cutoffs: state.cutoffs,
        baseline: state.baseline,
        history: state.history
      };
      var json = JSON.stringify(payload);
      if (json.length > DRAFT_LIMIT) {
        CF.toast.warn(
          "This file is too large to keep on this device",
          "Your marks are still safe in this tab, but the session will not survive a refresh."
        );
        return;
      }
      localStorage.setItem(DRAFT_KEY, json);
    } catch (e) {
      CF.toast.warn("Could not save a local draft", "Your marks are still safe in this tab.");
    }
  }

  function clearDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch (e) {
      /* storage unavailable - nothing to clear */
    }
  }

  function renderDraftNotice() {
    var host = document.getElementById("draftNotice");
    if (!host) return;
    D.clear(host);
    host.hidden = false;
    host.appendChild(
      D.notice(
        "info",
        "info",
        "A saved grading session was restored",
        D.el("p", {
          text:
            "Cutoffs, history and the selected course were loaded from this browser only. " +
            "Use “Change course” or import a new file to start fresh."
        })
      )
    );
  }

  function offerDraft(draft) {
    var host = document.getElementById("importError");
    if (!host) return;
    D.clear(host);
    var notice = D.notice(
      "info",
      "clock",
      "A grading session from " + U.humanStamp(new Date(draft.at)) + " is saved in this browser",
      D.el("p", {
        text:
          "Restore it to pick up where you left off, or discard it. The draft never leaves this device."
      })
    );
    var actions = D.el("div.cluster", { style: { "margin-top": "var(--sp-3)" } }, [
      D.button({
        label: "Restore session",
        icon: "undo",
        onClick: function () {
          restoreDraft(draft);
          D.clear(host);
        }
      }),
      D.button({
        label: "Discard it",
        variant: "ghost",
        onClick: function () {
          clearDraft();
          D.clear(host);
        }
      })
    ]);
    host.appendChild(notice);
    host.appendChild(actions);
  }

  function restoreDraft(draft) {
    var records = draft.records || [];
    var analysis = {
      ok: true,
      meta: draft.meta,
      sheet: draft.sheet,
      headerRow: draft.headerRow,
      columns: draft.columns,
      records: records,
      issues: draft.issues || [],
      courses: draft.courses,
      counts: draft.counts,
      // Recomputed rather than stored: derived values must not be trusted
      // across a reload when they can be rebuilt from the source rows.
      stats: S.describe(
        records.map(function (r) {
          return r.marks;
        })
      ),
      ignoredColumns: draft.ignoredColumns || [],
      blankRows: draft.blankRows || 0,
      rounding: draft.rounding || "nearest",
      fractionalCount: draft.fractionalCount || 0,
      sourceRows: draft.sourceRows || null
    };
    state.analysis = analysis;
    state.isDemo = !!draft.isDemo;
    state.instructor = draft.instructor || "";
    state.cutoffs = (draft.cutoffs || G.defaults()).slice();
    state.baseline = draft.baseline || null;
    state.history = draft.history || [];
    state.finalized = null;
    var input = document.getElementById("instructor");
    if (input) input.value = state.instructor;
    var persistBox = document.getElementById("persistDraft");
    if (persistBox) persistBox.checked = true;
    state.persist = true;

    var statusBox = document.getElementById("fileStatus");
    D.clear(statusBox);
    statusBox.appendChild(
      D.el("div.filechip", null, [
        D.el("div.filechip__icon", { "aria-hidden": "true" }, [D.icon("clock", 17)]),
        D.el("div.filechip__body", null, [
          D.el("div.filechip__name.truncate", { text: draft.meta.name }),
          D.el("div.filechip__meta", { text: "Restored from this browser · " + U.humanStamp(new Date(draft.at)) })
        ])
      ])
    );

    var reportBox = document.getElementById("importReport");
    CF.importPanel.renderReport(reportBox, analysis, { name: draft.meta.name, size: draft.meta.size }, reportHandlers());
    CF.importPanel.renderCourses(document.getElementById("coursePicker"), analysis, draft.courseKey, onCourseSelected);
    renderDraftNotice();

    if (draft.courseKey) {
      var course = U.byKey(analysis.courses, draft.courseKey);
      if (course) {
        state.courseKey = course.key;
        state.courseName = course.name;
        state.cohort = analysis.records.filter(function (r) { return r.courseKey === course.key; });
        timerReset();
        timerStart();
        renderAll();
        setStage(state.visited.configure ? "configure" : "analyse");
        CF.toast.success("Session restored", course.name + " · " + state.cohort.length + " students · " + state.cutoffs.join("/"));
      }
    } else {
      renderStageBar();
      CF.toast.success("Session restored", "Select a course to continue.");
    }
  }

  /* ==================================================================== *
   * Instructor field
   * ==================================================================== */

  function wireInstructor() {
    var input = document.getElementById("instructor");
    if (!input) return;

    /*
     * The review sheet is built from state when it is opened, and its
     * instructor check decides whether Finalize is enabled. A name typed while
     * the sheet is open has to rebuild it, or the check keeps reporting the
     * name as missing and the export stays blocked even though the name was
     * saved. Keystrokes are batched to one rebuild per frame.
     */
    var reviewFrame = 0;
    function refreshReview() {
      if (state.stage !== "review" || !state.analysis) return;
      cancelAnimationFrame(reviewFrame);
      reviewFrame = requestAnimationFrame(function () {
        reviewFrame = 0;
        renderReview();
      });
    }

    input.addEventListener("input", function () {
      state.instructor = input.value;
      instructorInvalid("");
      if (state.finalized) {
        state.finalized = null;
        renderStageBar();
        CF.toast.warn("Instructor name changed", "Finalize again so the report and the export agree.");
      }
      refreshReview();
      if (state.persist) saveDraft();
    });
    input.addEventListener("blur", function () {
      input.value = input.value.replace(/\s+/g, " ").trim();
      state.instructor = input.value;
      // Re-applies the "name required" warning if the field was left empty
      // on the review stage; typing alone never nags.
      renderContext();
      refreshReview();
      if (state.persist) saveDraft();
    });
    // Enter commits the name, the way a single-line field is expected to.
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      }
    });
    instructorInvalid("");
  }

  /**
   * The brand is the way home: a fresh import screen. Leaving discards the
   * in-memory session, so once a workbook is loaded the instructor is asked
   * first, in the app's own dialog, with the consequence stated plainly.
   */
  function wireHome() {
    var link = document.getElementById("homeLink");
    if (!link) return;
    link.addEventListener("click", function (e) {
      // New-tab and new-window gestures keep the current session untouched.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      var goHome = function () {
        window.location.assign(link.href);
      };
      if (!state.analysis) {
        goHome();
        return;
      }
      var unsaved = !state.finalized;
      var lead = state.courseKey
        ? "You are grading " + state.courseName + " (" + state.cohort.length + " " +
          U.pluralise(state.cohort.length, "student") + ")" +
          (state.history.length ? " with " + state.history.length + " boundary " +
            (state.history.length === 1 ? "change" : "changes") : "") + "."
        : "A workbook is loaded but no course has been graded yet.";
      var consequence = state.persist
        ? "A copy of this session is kept on this device and will be offered when you return."
        : unsaved
        ? "This session is not saved. Leaving discards the imported marks, your cutoffs and the change history."
        : "The grades were already exported. Leaving clears the session from this screen.";
      CF.modal.open({
        title: unsaved && !state.persist ? "Leave without saving?" : "Leave this session?",
        icon: "alert",
        iconTone: unsaved && !state.persist ? "var(--c-warning)" : null,
        body: [
          D.el("p.confirm__lead", { text: lead }),
          D.el("p.confirm__note", { text: consequence })
        ],
        // "Stay" comes first, so Enter never discards work by accident.
        actions: [
          { label: "Stay", variant: "secondary" },
          {
            label: unsaved && !state.persist ? "Leave and discard" : "Leave",
            variant: unsaved && !state.persist ? "danger" : null,
            icon: "arrow-right",
            onClick: function (close) {
              close();
              goHome();
            }
          }
        ]
      });
    });
  }

  /**
   * The stage bar doubles as navigation. Steps the instructor has not reached
   * yet are disabled, so it doubles as an honest progress indicator.
   */
  function wireStageBar() {
    D.$$(".stage-step").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.disabled) return;
        var target = btn.dataset.stage;
        if (target === "validate") target = state.courseKey ? "analyse" : "import";
        if (target === "export") target = "review";
        if (target === state.stage) {
          window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
          return;
        }
        if ((target === "configure" || target === "review") && state.courseKey) {
          if (target === "review") renderReview();
        }
        setStage(target);
      });
    });
  }

  function instructorInvalid(message) {
    var field = document.getElementById("instructorField");
    var text = document.getElementById("instructorErrorText");
    if (!field) return;
    var filled = !!state.instructor.trim();
    field.dataset.filled = filled ? "true" : "false";
    field.dataset.invalid = message ? "true" : "false";
    if (text) text.textContent = message || "Enter your name so the grade set can be attributed.";
  }

  /* ==================================================================== *
   * Boot
   * ==================================================================== */

  /**
   * The accepted header spellings are rendered from the parser's own alias
   * table, so the guidance on screen cannot drift from what is actually
   * accepted. A few representative variants are shown inline; the rest sit
   * behind a disclosure so the panel does not turn into a wall of chips.
   */
  function renderHeaderVariants() {
    var host = document.getElementById("headerVariants");
    if (!host) return;
    D.clear(host);
    var INLINE = 4;
    ["id", "course", "marks"].forEach(function (field) {
      var aliases = CF.workbook.FIELD_ALIASES[field];
      // The first alias is the canonical header already shown in the table.
      var variants = aliases.slice(1);
      var row = D.el("div", { style: { display: "flex", gap: "5px", "flex-wrap": "wrap", "align-items": "center" } }, [
        D.el("span", {
          style: {
            "font-size": "var(--fs-2xs)",
            "font-weight": "700",
            "letter-spacing": "var(--tracking-eyebrow)",
            "text-transform": "uppercase",
            color: "var(--c-ink-500)",
            "min-width": "66px"
          },
          text: CF.workbook.FIELD_LABEL[field]
        })
      ]);
      variants.slice(0, INLINE).forEach(function (alias) {
        row.appendChild(D.el("code", { text: alias }));
      });
      if (variants.length > INLINE) {
        var more = D.el("details", { style: { display: "inline" } });
        more.appendChild(
          D.el("summary", {
            style: {
              "font-size": "var(--fs-2xs)",
              color: "var(--c-ink-500)",
              cursor: "pointer",
              "list-style": "none"
            },
            text: "+" + (variants.length - INLINE) + " more"
          })
        );
        var full = D.el("div", { style: { display: "flex", gap: "5px", "flex-wrap": "wrap", "margin-top": "5px", width: "100%" } });
        variants.forEach(function (alias) {
          full.appendChild(D.el("code", { text: alias }));
        });
        more.appendChild(full);
        row.appendChild(more);
      }
      host.appendChild(row);
    });
  }

  function init() {
    // The markup declares the accepted types so the console degrades without
    // JavaScript; re-applying them here keeps the two from drifting apart.
    var fileInput = document.getElementById("fileInput");
    if (fileInput) fileInput.accept = CF.workbook.fileAccept();

    var help = D.el("p.visually-hidden", { id: "chartKeyHelp" });
    help.textContent =
      "Each cutoff handle is a slider. Use the left and right arrow keys to move it by one mark, " +
      "Shift with an arrow key to move it by five, Home for the lowest legal value and End for the highest.";
    document.body.appendChild(help);

    editor = CF.bandEditor.create(document.getElementById("bandEditor"), {
      getCutoffs: function () { return state.cutoffs; },
      onCutoff: setCutoff,
          onHover: function (i) {
            if (!charts.configure) return;
            charts.configure.update({ activeBand: i < 0 ? null : i });
          }
    });

    importApi = CF.importPanel.init({
      onLoaded: onLoaded,
      onCourse: onCourseSelected,
      onLoadDemo: loadDemo,
      onRounding: reapplyRounding,
      onFailed: function () {
        state.analysis = null;
        state.courseKey = null;
        state.cohort = [];
        state.cutoffs = G.defaults();
        state.baseline = null;
        state.history = [];
        state.finalized = null;
        timerReset();
        renderStageBar();
        renderContext();
        D.clear(document.getElementById("coursePicker"));
        document.getElementById("coursePicker").hidden = true;
      }
    });

    document.getElementById("loadDemo").addEventListener("click", loadDemo);
    wireInstructor();
    wireStageBar();
    wireHome();

    var showHelp = document.getElementById("showOnboarding");
    if (showHelp) {
      showHelp.addEventListener("click", function () {
        setOnboarding(true);
        window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
        var zone = document.getElementById("dropzone");
        if (zone) zone.focus && zone.focus();
      });
    }

    var persist = document.getElementById("persistDraft");
    if (persist) {
      persist.addEventListener("change", function () {
        state.persist = persist.checked;
        if (state.persist) {
          saveDraft();
          CF.toast.success("Session will be kept on this device", "Nothing is sent anywhere. Untick the box or use “Discard saved session” to remove it.");
        } else {
          clearDraft();
          CF.toast.info("Saved session removed", "This tab keeps working normally.");
        }
      });
    }
    var discard = document.getElementById("discardDraft");
    if (discard) {
      discard.addEventListener("click", function () {
        clearDraft();
        state.persist = false;
        if (persist) persist.checked = false;
        // Remove only this control: clearing the surrounding panel would take
        // the draft toggle with it.
        var row = discard.closest(".session-action");
        if (row && row.parentNode) row.parentNode.removeChild(row);
        else discard.parentNode.removeChild(discard);
        CF.toast.info("Saved session removed", "Nothing was stored in this browser for this console.");
        announce("The saved grading session was removed from this browser.");
      });
    }

    var search = document.getElementById("studentSearch");
    if (search) {
      var debounce = 0;
      search.addEventListener("input", function () {
        state.studentQuery = search.value;
        clearTimeout(debounce);
        debounce = setTimeout(function () {
          CF.analysePanel.renderStudents(document.getElementById("studentTable"), {
            cohort: state.cohort,
            cutoffs: state.cutoffs,
            baseline: state.baseline,
            sort: state.studentSort,
            query: state.studentQuery,
            onSort: function (key) {
              state.studentSort =
                state.studentSort.key === key
                  ? { key: key, dir: state.studentSort.dir === "asc" ? "desc" : "asc" }
                  : { key: key, dir: key === "id" ? "asc" : "desc" };
              renderAnalyse();
            }
          });
        }, 140);
      });
    }

    // Keyboard shortcuts for the workflow.
    document.addEventListener("keydown", function (e) {
      if (e.target.matches("input, select, textarea")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (CF.modal.isOpen()) return;
      if (!state.courseKey) return;
      if (e.key === "u" && !e.shiftKey) {
        if (state.history.length) {
          e.preventDefault();
          undoHistory();
        }
      }
    });

    renderTimer();
    renderStageBar();
    renderHeaderVariants();

    var draft = null;
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      if (raw) draft = JSON.parse(raw);
    } catch (err) {
      draft = null;
    }
    if (draft && draft.v === 1 && draft.records && draft.records.length) {
      offerDraft(draft);
    }

    announce("Grading workspace ready. Import a marks workbook to begin.");
  }

  function loadDemo() {
    var demo = root.CF.demoClass;
    if (!demo) {
      CF.toast.error("Demo data is unavailable", "Reload the page and try again.");
      return;
    }
    var analysis = CF.workbook.readRows(demo.rows, {
      name: demo.fileName,
      size: demo.meta.sizeBytes,
      demo: true
    });
    analysis.sheet = { name: demo.sheetName, skipped: [] };
    if (!analysis.ok) {
      CF.toast.error("Demo data could not be loaded", analysis.fatal ? analysis.fatal.title : "");
      return;
    }
    importApi.reset();
    D.clear(document.getElementById("importError"));
    CF.importPanel.renderReport(
      document.getElementById("importReport"),
      analysis,
      { name: demo.fileName, size: demo.meta.sizeBytes },
      reportHandlers()
    );
    CF.importPanel.renderCourses(document.getElementById("coursePicker"), analysis, null, onCourseSelected);

    var statusBox = document.getElementById("fileStatus");
    D.clear(statusBox);
    statusBox.appendChild(
      D.el("div.filechip", null, [
        D.el("div.filechip__icon", { "aria-hidden": "true" }, [D.icon("sparkle", 17)]),
        D.el("div.filechip__body", null, [
          D.el("div.filechip__name", { text: demo.fileName + " (demo class)" }),
          D.el("div.filechip__meta", {
            text: analysis.counts.accepted + " synthetic students · " + analysis.courses.length + " courses · no real records"
          })
        ]),
        D.badge("Demo data", "info"),
        D.button({
          label: "Replace",
          variant: "ghost",
          size: "sm",
          onClick: function () {
            setOnboarding(true);
            document.getElementById("fileInput").click();
          }
        })
      ])
    );

    onLoaded(analysis, { name: demo.fileName, size: demo.meta.sizeBytes });
    CF.toast.info(
      "Demo class loaded",
      "Four synthetic courses. Pick a course to see the full workflow, then reset or import your own file."
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  CF.app = {
    state: state,
    setCutoff: setCutoff,
    resetToDefaults: resetToDefaults,
    loadDemo: loadDemo,
    doExport: doExport,
    elapsed: elapsed,
    setStage: setStage,
    onCourseSelected: onCourseSelected,
    renderAll: renderAll,
    renderReview: renderReview
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
