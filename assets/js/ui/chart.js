/**
 * Distribution chart.
 *
 * Replaces the starter's fixed 380x240 canvas, which had three defects worth
 * naming: it was not scaled for the device pixel ratio (blurry on any modern
 * display), its geometry was hard-coded so clearing and drawing could disagree
 * with the displayed size, and it overlaid a normal-distribution curve on the
 * data - implying the class was normally distributed when it frequently is not.
 *
 * This version:
 *   - is SVG, so it is crisp at any density and reflows with its container;
 *   - uses one bar per whole mark, so a cutoff is exact to a single mark
 *     instead of being blurred across a 10-mark bin;
 *   - draws honest descriptive markers (median, mean) instead of a fitted
 *     normal curve, and never asserts a distribution it has not tested;
 *   - exposes each cutoff as a real ARIA slider, so the whole band design is
 *     possible from the keyboard, and keeps focus on it across redraws;
 *   - animates a moved cutoff to its new position and briefly marks the bars
 *     whose grade just changed, so cause and consequence read as one motion;
 *   - pairs with a visually-hidden data table for screen readers.
 *
 * Three modes share one renderer: "analyse" (marks only, with median and
 * mean), "configure" (grade regions and draggable cutoffs) and "report" (the
 * printed, read-only boundaries).
 */
(function (root) {
  "use strict";

  var CF = (root.CF = root.CF || {});
  var D = CF.dom;
  var S = CF.statistics;
  var U = CF.util;

  var reduceMotion =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  var RAMP = [
    "var(--chart-g1)", "var(--chart-g2)", "var(--chart-g3)", "var(--chart-g4)",
    "var(--chart-g5)", "var(--chart-g6)", "var(--chart-g7)", "var(--chart-g8)"
  ];
  var SINGLE = "var(--chart-g3)";

  function modeOf(model) {
    if (model.readOnly) return "report";
    if (model.cutoffs && model.onCutoff) return "configure";
    return "analyse";
  }

  /**
   * Geometry for a given pixel width. `mode` may be a mode name, or `true`
   * for the interactive configure layout.
   */
  function layout(width, mode) {
    if (mode === true) mode = "configure";
    mode = mode || "analyse";
    var narrow = width < 560;
    var heights = {
      configure: narrow ? 240 : 318,
      report: narrow ? 214 : 262,
      analyse: narrow ? 210 : 322
    };
    var tops = {
      configure: narrow ? 42 : 48,
      report: 30,
      analyse: 30
    };
    return {
      width: width,
      height: heights[mode],
      ml: narrow ? 28 : 36,
      mr: narrow ? 8 : 12,
      mt: tops[mode],
      mb: narrow ? 32 : 38,
      narrow: narrow,
      mode: mode
    };
  }

  /**
   * model = {
   *   marks, stats, bands?, cutoffs?, activeBand?, affectedMarks?, onCutoff?,
   *   readOnly?
   * }
   */
  function create(container, model) {
    var tip = null;
    var ro = null;
    var pending = 0;
    var lastL = null;
    var dragIndex = null;
    var prevCutX = {};
    var prevWidth = 0;

    function destroy() {
      if (ro) ro.disconnect();
      ro = null;
    }

    function draw() {
      if (!container) return;
      var current = model;
      var mode = modeOf(current);
      var width = Math.max(240, Math.floor(container.clientWidth || 640));
      var L = layout(width, mode);
      lastL = L;
      var hist = S.histogram(current.marks || []);
      var stats = current.stats || S.describe(current.marks || []);
      var plotW = L.width - L.ml - L.mr;
      var plotH = L.height - L.mt - L.mb;
      var x0 = L.ml;
      var y1 = L.mt + plotH;
      var binW = plotW / 101;
      var axis = S.axisTicks(hist.peak);
      var y = function (v) {
        return y1 - (axis.top ? (v / axis.top) * plotH : 0);
      };
      var x = function (mark) {
        return x0 + mark * binW;
      };

      // Keep keyboard focus on the slider being moved: the SVG is rebuilt on
      // every change, and a keyboard user must not be dropped to <body>.
      var focusedCut = null;
      var active = document.activeElement;
      if (active && container.contains(active) && active.dataset && active.dataset.cutoff !== undefined) {
        focusedCut = active.dataset.cutoff;
      }

      D.clear(container);
      var svg = D.svg("svg", {
        class: "chart__svg chart__svg--" + mode,
        viewBox: "0 0 " + L.width + " " + L.height,
        width: L.width,
        height: L.height,
        // A group, not an image, when it holds sliders: role="img" would hide
        // its interactive children from assistive technology.
        role: mode === "configure" ? "group" : "img",
        "aria-label": describeChart(stats, hist, current.bands)
      });

      var clip = clipId(container);
      svg.appendChild(
        D.svg("defs", null, [
          D.svg("clipPath", { id: clip }, [
            D.svg("rect", { x: x0, y: L.mt - 2, width: plotW + binW, height: plotH + 2 })
          ])
        ])
      );

      /* ---- grade regions: a whisper of structure ----------------------- */
      var bands = current.bands;
      if (bands && mode !== "analyse") {
        bands.forEach(function (b, i) {
          var bx = x(b.min);
          var bw = x(b.max + 1) - bx;
          var isActive = current.activeBand === i;
          svg.appendChild(
            D.svg("rect", {
              class: "chart__band",
              x: r2(bx),
              y: L.mt,
              width: r2(Math.max(0, bw)),
              height: plotH,
              dataset: { active: isActive ? "true" : "false", odd: i % 2 ? "true" : "false" }
            })
          );
        });
      }

      /* ---- y gridlines and labels -------------------------------------- */
      axis.ticks.forEach(function (t) {
        if (t === 0) return;
        svg.appendChild(
          D.svg("line", { class: "chart__grid-line", x1: x0, x2: r2(x0 + plotW + binW), y1: r2(y(t)), y2: r2(y(t)) })
        );
        svg.appendChild(
          D.svg("text", { class: "chart__tick", x: x0 - 9, y: r2(y(t) + 3.5), "text-anchor": "end", text: t })
        );
      });

      /* ---- hover column ------------------------------------------------ */
      var hover = D.svg("rect", {
        class: "chart__hover",
        x: x0,
        y: L.mt,
        width: r2(binW),
        height: plotH,
        dataset: { visible: "false" }
      });
      svg.appendChild(hover);

      // Configure's median is a reference line, so it sits behind the bars.
      if (mode === "configure" && stats.count && stats.median !== null) {
        var mx = r2(x(stats.median) + binW / 2);
        svg.appendChild(
          D.svg("line", { class: "chart__stat-line chart__stat-line--quiet", x1: mx, x2: mx, y1: L.mt, y2: y1 })
        );
      }

      /* ---- bars -------------------------------------------------------- */
      var barW = Math.max(1.5, binW * 0.7);
      var barInset = (binW - barW) / 2;
      var radius = Math.min(2, barW / 2);
      var g = D.svg("g", { class: "chart__bars", "clip-path": "url(#" + clip + ")" });
      for (var m = 0; m <= 100; m++) {
        var c = hist.bins[m];
        if (!c) continue;
        var bandIndex = mode === "analyse" ? null : bandIndexFor(m, bands);
        g.appendChild(
          D.svg("path", {
            class: "chart__bar",
            d: barPath(x(m) + barInset, y(c), barW, y1 - y(c), radius),
            fill: bandIndex === null ? SINGLE : RAMP[bandIndex]
          })
        );
      }
      svg.appendChild(g);

      /* ---- the marks whose grade just changed -------------------------- */
      var affected = current.affectedMarks && current.affectedMarks.has ? current.affectedMarks : null;
      if (affected && mode === "configure") {
        var flash = D.svg("g", { class: "chart__flash" + (reduceMotion ? "" : " is-animated"), "aria-hidden": "true" });
        affected.forEach(function (mk) {
          var n = hist.bins[mk];
          if (!n) return;
          flash.appendChild(
            D.svg("path", {
              class: "chart__bar chart__bar--affected",
              d: barPath(x(mk) + barInset, y(n), barW, y1 - y(n), radius)
            })
          );
        });
        svg.appendChild(flash);
      }

      svg.appendChild(
        D.svg("line", { class: "chart__axis-line", x1: x0, x2: r2(x0 + plotW + binW), y1: y1, y2: y1 })
      );

      /* ---- descriptive markers ----------------------------------------- */
      if (mode === "analyse" && stats.count) {
        var meanOk = stats.mean !== null && stats.stdDev !== null;
        var med = stats.median;
        var mean = meanOk ? stats.mean : null;
        var close = meanOk && Math.abs(x(mean) - x(med)) < 96;
        var medFirst = !meanOk || med <= mean;
        drawMarker(svg, med, "Median " + fmt(med, 1), "median", x(med) + binW / 2, L, y1,
          close ? (medFirst ? "end" : "start") : null);
        if (meanOk) {
          drawMarker(svg, mean, "Mean " + fmt(mean, 1), "mean", x(mean) + binW / 2, L, y1,
            close ? (medFirst ? "start" : "end") : null);
        }
      }

      /* ---- x axis ------------------------------------------------------- */
      var tickStep = L.narrow ? 20 : plotW > 560 ? 10 : 20;
      for (var t2 = 0; t2 <= 100; t2 += tickStep) {
        svg.appendChild(
          D.svg("text", {
            class: "chart__tick" + (t2 % 50 === 0 ? " chart__tick--strong" : ""),
            x: r2(x(t2) + binW / 2),
            y: y1 + 17,
            "text-anchor": "middle",
            text: t2
          })
        );
        svg.appendChild(
          D.svg("line", { class: "chart__axis-tick", x1: r2(x(t2) + binW / 2), x2: r2(x(t2) + binW / 2), y1: y1, y2: y1 + 4 })
        );
      }
      if (!L.narrow) {
        svg.appendChild(
          D.svg("text", {
            class: "chart__axis-title",
            x: r2(x0 + plotW + binW),
            y: L.height - 4,
            "text-anchor": "end",
            text: "Marks out of 100"
          })
        );
        if (mode !== "configure") {
          svg.appendChild(
            D.svg("text", { class: "chart__axis-title", x: 0, y: L.mt - 12, text: "Students" })
          );
        }
      }

      /* ---- cutoffs ------------------------------------------------------ */
      var cutGroups = [];
      if (current.cutoffs && mode === "report") {
        current.cutoffs.forEach(function (cv, i) {
          var cx = r2(x(cv));
          svg.appendChild(D.svg("line", { class: "chart__cutoff chart__cutoff--report", x1: cx, x2: cx, y1: L.mt - 6, y2: y1 }));
          svg.appendChild(
            D.svg("text", {
              class: "chart__cutoff-label",
              x: cx,
              y: L.mt - 11,
              text: L.narrow ? String(cv) : CF.grading.GRADES[i] + " " + cv
            })
          );
        });
      }

      if (current.cutoffs && mode === "configure") {
        var pillW = L.narrow ? 23 : 32;
        var pillH = L.narrow ? 18 : 20;
        var pillY = L.mt - pillH - 12;

        // Grade letters ride in the handle row, between the boundaries.
        if (bands) {
          bands.forEach(function (b, i) {
            var bx = x(b.min);
            var bw = x(b.max + 1) - bx;
            if (bw < pillW + 18) return;
            svg.appendChild(
              D.svg("text", {
                class: "chart__band-label",
                x: r2(bx + bw / 2),
                y: r2(pillY + pillH / 2 + 4),
                dataset: { active: current.activeBand === i ? "true" : "false" },
                text: b.grade
              })
            );
          });
        }

        current.cutoffs.forEach(function (cv, i) {
          var cx = r2(x(cv));
          var px = U.clamp(cx, pillW / 2 + 1, L.width - pillW / 2 - 1);
          var gradeLabel = CF.grading.GRADES[i];
          var grp = D.svg("g", {
            class: "chart__cut",
            tabindex: "0",
            role: "slider",
            dataset: dragIndex === i ? { cutoff: String(i), dragging: "true" } : { cutoff: String(i) },
            "aria-label": gradeLabel + " minimum mark",
            "aria-valuemin": "1",
            "aria-valuemax": "100",
            "aria-valuenow": String(cv),
            "aria-valuetext": cv + " marks and above",
            "aria-describedby": "chartKeyHelp"
          });
          // A generous invisible target along the whole boundary.
          grp.appendChild(D.svg("line", { class: "chart__cut-hit", x1: cx, x2: cx, y1: pillY, y2: y1 }));
          grp.appendChild(D.svg("line", { class: "chart__cutoff", x1: cx, x2: cx, y1: pillY + pillH, y2: y1 }));
          grp.appendChild(D.svg("circle", { class: "chart__cut-foot", cx: cx, cy: y1, r: 2.5 }));
          grp.appendChild(
            D.svg("rect", {
              class: "chart__cutoff-focus",
              x: r2(px - pillW / 2 - 3),
              y: pillY - 3,
              width: pillW + 6,
              height: pillH + 6,
              rx: 7
            })
          );
          grp.appendChild(
            D.svg("rect", {
              class: "chart__cutoff-grip",
              x: r2(px - pillW / 2),
              y: pillY,
              width: pillW,
              height: pillH,
              rx: 5
            })
          );
          grp.appendChild(
            D.svg("text", { class: "chart__cutoff-value", x: px, y: r2(pillY + pillH / 2 + 3.8), text: cv })
          );
          grp.addEventListener("keydown", function (e) {
            var step = e.shiftKey ? 5 : 1;
            var v = model.cutoffs[i];
            var next = null;
            if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = v - step;
            else if (e.key === "ArrowRight" || e.key === "ArrowUp") next = v + step;
            else if (e.key === "PageDown") next = v - 10;
            else if (e.key === "PageUp") next = v + 10;
            else if (e.key === "Home") next = 1;
            else if (e.key === "End") next = 100;
            if (next === null) return;
            e.preventDefault();
            model.onCutoff(i, next, "keyboard");
          });
          svg.appendChild(grp);
          cutGroups.push({ node: grp, i: i, x: cx });
        });
      }

      /* ---- hover and tooltip -------------------------------------------- */
      svg.addEventListener("mousemove", function (e) {
        if (dragIndex !== null) return hideTip();
        var rect = svg.getBoundingClientRect();
        if (!rect.width) return;
        var scale = L.width / rect.width;
        var px = (e.clientX - rect.left) * scale;
        var py = (e.clientY - rect.top) * scale;
        if (px < x0 || px > x0 + plotW + binW || py < L.mt - 4 || py > y1 + 6) return hideTip();
        var mark = Math.max(0, Math.min(100, Math.floor((px - x0) / binW)));
        hover.setAttribute("x", r2(x(mark)));
        hover.dataset.visible = "true";
        showTip(tip, mark, hist, stats, current, (x(mark) + binW / 2) / scale, y(hist.bins[mark] || 0) / scale, rect);
      });
      svg.addEventListener("mouseleave", hideTip);

      function hideTip() {
        if (tip) tip.dataset.visible = "false";
        hover.dataset.visible = "false";
      }

      container.appendChild(svg);

      /* ---- accessible data table ---------------------------------------- */
      container.appendChild(dataTable(stats, hist, current.bands));

      if (reduceMotion) svg.classList.add("chart--static");

      /*
       * draw() clears the container, which removes any tooltip element from a
       * previous draw. It must be (re-)attached every time - guarding with
       * `if (!tip)` kept a reference to a node that was no longer in the
       * document, so after the first redraw tooltips silently stopped
       * appearing.
       */
      if (!tip) tip = D.el("div.chart__tooltip", { role: "presentation" });
      tip.dataset.visible = "false";
      container.appendChild(tip);

      /* ---- motion: glide each moved cutoff from where it was ------------ */
      var animate = !reduceMotion && dragIndex === null && prevWidth === L.width;
      var moving = [];
      cutGroups.forEach(function (cg) {
        var was = prevCutX[cg.i];
        if (animate && was !== undefined && was !== cg.x) {
          cg.node.style.transform = "translateX(" + r2(was - cg.x) + "px)";
          moving.push(cg.node);
        }
        prevCutX[cg.i] = cg.x;
      });
      prevWidth = L.width;
      if (moving.length) {
        // Commit the start position, then release it on the next frame.
        void svg.getBoundingClientRect();
        requestAnimationFrame(function () {
          moving.forEach(function (n) {
            n.style.transition = "transform var(--dur-2) var(--ease-out)";
            n.style.transform = "translateX(0px)";
          });
        });
      }

      if (focusedCut !== null) {
        var again = container.querySelector('[data-cutoff="' + focusedCut + '"]');
        if (again) again.focus({ preventScroll: true });
      }
    }

    function attachCutoffBehaviour() {
      /*
       * Drag handling lives on the container, not on the grip, because the SVG
       * is rebuilt on every change. Attaching it to the grip destroyed the
       * element mid-drag, so the very first pointermove cancelled the gesture.
       */
      var pendingFrame = 0;
      var lastClientX = 0;

      function valueFromClientX(clientX) {
        var svgEl = container.querySelector("svg");
        if (!svgEl || !lastL) return null;
        var rect = svgEl.getBoundingClientRect();
        if (!rect.width) return null;
        var L = lastL;
        var scale = L.width / rect.width;
        var px = (clientX - rect.left) * scale;
        var binW = (L.width - L.ml - L.mr) / 101;
        return Math.round((px - L.ml) / binW);
      }

      container.addEventListener("pointerdown", function (e) {
        if (e.button !== undefined && e.button !== 0) return;
        var grip = e.target.closest ? e.target.closest("[data-cutoff]") : null;
        if (!grip || !container.contains(grip) || !model.onCutoff) return;
        dragIndex = Number(grip.dataset.cutoff);
        lastClientX = e.clientX;
        container.setPointerCapture && container.setPointerCapture(e.pointerId);
        container.style.touchAction = "none";
        container.dataset.dragging = "true";
        grip.dataset.dragging = "true";
        if (tip) tip.dataset.visible = "false";
        e.preventDefault();
      });

      container.addEventListener("pointermove", function (e) {
        if (dragIndex === null) return;
        lastClientX = e.clientX;
        if (pendingFrame) return;
        pendingFrame = requestAnimationFrame(function () {
          pendingFrame = 0;
          if (dragIndex === null || !model || !model.onCutoff) return;
          var v = valueFromClientX(lastClientX);
          if (v === null || !isFinite(v)) return;
          if (v === model.cutoffs[dragIndex]) return;
          model.onCutoff(dragIndex, v, "drag");
        });
      });

      var end = function (e) {
        if (dragIndex === null) return;
        var index = dragIndex;
        dragIndex = null;
        delete container.dataset.dragging;
        var grip = container.querySelector('[data-cutoff="' + index + '"]');
        if (grip) {
          delete grip.dataset.dragging;
          grip.focus({ preventScroll: true });
        }
        container.style.touchAction = "";
        if (container.hasPointerCapture && e.pointerId !== undefined && container.hasPointerCapture(e.pointerId)) {
          container.releasePointerCapture(e.pointerId);
        }
      };
      container.addEventListener("pointerup", end);
      container.addEventListener("pointercancel", end);
      container.addEventListener("lostpointercapture", end);
    }

    if (typeof ResizeObserver === "function" && container) {
      ro = new ResizeObserver(function () {
        cancelAnimationFrame(pending);
        pending = requestAnimationFrame(function () {
          if (model && container.clientWidth && Math.floor(container.clientWidth) !== prevWidth) draw();
        });
      });
      ro.observe(container);
    }

    attachCutoffBehaviour();
    draw();

    return {
      /**
       * Merge into the current model and redraw. Updates are always partial,
       * so a caller can never accidentally drop the cutoff handler and leave
       * the chart without its interactive layer.
       */
      update: function (next) {
        model = Object.assign({}, model, next);
        draw();
      },
      getModel: function () {
        return model;
      },
      destroy: destroy
    };
  }

  /** A bar with rounded top corners and a square foot on the baseline. */
  function barPath(bx, by, w, h, r) {
    h = Math.max(1, h);
    r = Math.max(0, Math.min(r, w / 2, h));
    var X = r2(bx);
    var Y = r2(by);
    var R = r2(bx + w);
    var B = r2(by + h);
    return (
      "M" + X + "," + B +
      "V" + r2(by + r) +
      "Q" + X + "," + Y + " " + r2(bx + r) + "," + Y +
      "H" + r2(bx + w - r) +
      "Q" + R + "," + Y + " " + R + "," + r2(by + r) +
      "V" + B + "Z"
    );
  }

  function r2(v) {
    return Math.round(v * 100) / 100;
  }

  function bandIndexFor(mark, bands) {
    if (!bands) return null;
    for (var i = 0; i < bands.length; i++) {
      if (mark >= bands[i].min && mark <= bands[i].max) return i;
    }
    return null;
  }

  function drawMarker(svg, value, label, kind, px, L, y1, side) {
    if (value === null || !isFinite(value)) return;
    px = r2(px);
    svg.appendChild(
      D.svg("line", { class: "chart__stat-line chart__stat-line--" + kind, x1: px, x2: px, y1: L.mt - 8, y2: y1 })
    );
    // Labelled above the plot: on the baseline the label collided with the
    // bars, which is exactly where the interesting data is. When median and
    // mean sit close together their labels part to either side of the lines.
    var anchor = side || (value > 90 ? "end" : value < 10 ? "start" : "middle");
    var dx = anchor === "end" ? -5 : anchor === "start" ? 5 : 0;
    svg.appendChild(
      D.svg("text", {
        class: "chart__stat-label chart__stat-label--" + kind,
        x: px + dx,
        y: L.mt - 12,
        "text-anchor": anchor,
        text: label
      })
    );
  }

  function showTip(tip, mark, hist, stats, m, xPx, yPx, svgRect) {
    if (!tip) return;
    var count = hist.bins[mark] || 0;
    D.clear(tip);
    var grade = m.bands ? gradeForMark(mark, m.bands) : null;
    tip.appendChild(
      D.el("div.chart__tooltip-head", null, [
        D.el("span", null, [D.el("b", { text: String(mark) }), mark === 1 ? " mark" : " marks"]),
        grade ? D.el("span.chart__tooltip-grade", { text: grade }) : null
      ])
    );
    tip.appendChild(
      D.el("div.chart__tooltip-row", null, [
        D.el("span", { text: count === 1 ? "Student" : "Students" }),
        D.el("span", { text: String(count) })
      ])
    );
    if (stats.count) {
      tip.appendChild(
        D.el("div.chart__tooltip-row", null, [
          D.el("span", { text: "Share" }),
          D.el("span", { text: ((count / stats.count) * 100).toFixed(1) + "%" })
        ])
      );
    }
    tip.dataset.visible = "true";
    var left = U.clamp(xPx, 66, svgRect.width - 66);
    tip.style.left = r2(left) + "px";
    tip.style.top = r2(Math.max(64, yPx - 8)) + "px";
  }

  function gradeForMark(mark, bands) {
    for (var i = 0; i < bands.length; i++) {
      if (mark >= bands[i].min && mark <= bands[i].max) return bands[i].grade;
    }
    return null;
  }

  function describeChart(stats, hist, bands) {
    if (!stats.count) return "Marks distribution chart. No students in this course yet.";
    var s =
      "Marks distribution for " +
      stats.count +
      " " +
      U.pluralise(stats.count, "student") +
      ". Lowest mark " +
      stats.min +
      ", highest mark " +
      stats.max +
      ", median " +
      fmt(stats.median, 1) +
      ". Busiest mark " +
      hist.bins.indexOf(hist.peak) +
      " with " +
      hist.peak +
      " " +
      U.pluralise(hist.peak, "student") +
      ".";
    if (bands) {
      s +=
        " Grade bands: " +
        bands.map(function (b) { return b.grade + " " + b.min + " to " + b.max; }).join(", ") +
        ".";
    }
    return s;
  }

  function dataTable(stats, hist, bands) {
    var rows = [];
    for (var m = 0; m <= 100; m++) {
      if (!hist.bins[m]) continue;
      rows.push([m, hist.bins[m], gradeForMark(m, bands || [])]);
    }
    // Wrapped, not hidden itself: engines ignore overflow on table boxes, so a
    // hidden table's rows would still stretch the page's scroll height.
    var table = D.el("table");
    var caption = D.el("caption", {
      text: "Marks distribution" + (stats.count ? "" : " - no data")
    });
    table.appendChild(caption);
    var thead = D.el("thead");
    thead.appendChild(
      D.el("tr", null, [
        D.el("th", { scope: "col", text: "Marks" }),
        D.el("th", { scope: "col", text: "Students" }),
        D.el("th", { scope: "col", text: "Grade" })
      ])
    );
    table.appendChild(thead);
    var tbody = D.el("tbody");
    rows.forEach(function (r) {
      tbody.appendChild(
        D.el("tr", null, [
          D.el("th", { scope: "row", text: r[0] }),
          D.el("td", { text: r[1] }),
          D.el("td", { text: r[2] || "not graded" })
        ])
      );
    });
    table.appendChild(tbody);
    return D.el("div.visually-hidden", null, table);
  }

  function fmt(v, dp) {
    if (v === null || v === undefined || !isFinite(v)) return "n/a";
    if (dp === 1) return v === Math.round(v) ? String(v) : v.toFixed(1);
    return String(Math.round(v * 100) / 100);
  }

  var idCount = 0;
  function clipId(container) {
    if (!container.dataset.clipId) container.dataset.clipId = "cf-clip-" + ++idCount;
    return container.dataset.clipId;
  }

  function legend(items) {
    var box = D.el("div.chart-legend");
    items.forEach(function (it) {
      var kind = it.line ? "line" : it.cut ? "cut" : it.ramp ? "ramp" : "box";
      var sw = D.el("span.chart-legend__swatch", {
        class: "chart-legend__swatch--" + kind + (it.dashed ? " chart-legend__swatch--dashed" : ""),
        "aria-hidden": "true",
        style: it.colour && kind === "box" ? { background: it.colour } : null
      });
      if (kind === "line" && it.colour) sw.style.borderTopColor = it.colour;
      if (kind === "cut" && it.colour) sw.style.background = it.colour;
      box.appendChild(D.el("span.chart-legend__item", null, [sw, it.label]));
    });
    return box;
  }

  CF.chart = {
    create: create,
    legend: legend,
    layout: layout
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
