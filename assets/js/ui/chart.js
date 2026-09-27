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
 *     possible from the keyboard;
 *   - pairs with a visually-hidden data table for screen readers.
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

  function layout(width, withCutoffs) {
    var narrow = width < 560;
    var cutoffs = !!withCutoffs;
    return {
      width: width,
      height: narrow ? (cutoffs ? 226 : 200) : cutoffs ? 288 : 258,
      ml: narrow ? 30 : 38,
      mr: 10,
      mt: narrow ? (cutoffs ? 42 : 30) : cutoffs ? 48 : 36,
      mb: narrow ? 40 : 44,
      narrow: narrow
    };
  }

  /**
   * model = {
   *   marks, stats, bands?, cutoffs?, activeBand?, affectedMarks?, onCutoff?
   * }
   */
  function create(container, model) {
    var current = null;
    var tip = null;
    var ro = null;
    var pending = 0;

    function destroy() {
      if (ro) ro.disconnect();
      ro = null;
    }

    function draw() {
      current = model;
      if (!container) return;
      var width = Math.max(240, Math.floor(container.clientWidth || 640));
      var L = layout(width, current && current.cutoffs);
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

      D.clear(container);
      var svg = D.svg("svg", {
        class: "chart__svg",
        viewBox: "0 0 " + L.width + " " + L.height,
        width: L.width,
        height: L.height,
        role: "img",
        "aria-label": describeChart(stats, hist, current.bands)
      });

      var defs = D.svg("defs");
      defs.appendChild(
        D.svg("clipPath", { id: clipId(container) }, [D.svg("rect", { x: x0, y: L.mt - 6, width: plotW + binW, height: plotH + 8 })])
      );
      svg.appendChild(defs);

      /* ---- grade band regions ------------------------------------------ */
      if (current.bands) {
        current.bands.forEach(function (b, i) {
          var bx = x(b.min);
          var bw = x(b.max + 1) - bx;
          var isActive = current.activeBand === i;
          svg.appendChild(
            D.svg("rect", {
              class: "chart__band",
              x: bx,
              y: L.mt - 12,
              width: Math.max(0, bw),
              height: plotH + 12,
              fill: isActive ? "rgba(169,103,24,0.10)" : i % 2 ? "rgba(13,21,38,0.030)" : "rgba(13,21,38,0.012)",
              "clip-path": "url(#" + clipId(container) + ")"
            })
          );
          // On a narrow viewport the regions are a few pixels wide and the
          // letters collide; the band editor below carries them instead. The
          // printed report labels the cutoffs instead, so it needs neither.
          if (!L.narrow && !current.readOnly && bw >= 15) {
            svg.appendChild(
              D.svg("text", {
                class: "chart__band-label",
                x: bx + bw / 2,
                y: L.mt - 14,
                dataset: isActive ? { active: "true" } : null,
                text: b.grade
              })
            );
          }
        });
      }

      /* ---- y gridlines and labels -------------------------------------- */
      axis.ticks.forEach(function (t) {
        if (t === 0) return;
        svg.appendChild(
          D.svg("line", { class: "chart__grid-line", x1: x0, x2: x0 + plotW + binW, y1: y(t), y2: y(t) })
        );
        svg.appendChild(
          D.svg("text", { class: "chart__tick", x: x0 - 7, y: y(t) + 3.5, "text-anchor": "end", text: t })
        );
      });
      svg.appendChild(
        D.svg("line", { class: "chart__axis-line", x1: x0, x2: x0 + plotW + binW, y1: y1, y2: y1 })
      );

      /* ---- bars -------------------------------------------------------- */
      var g = D.svg("g", { "clip-path": "url(#" + clipId(container) + ")" });
      var maxCount = hist.peak;
      for (var m = 0; m <= 100; m++) {
        var c = hist.bins[m];
        if (!c) continue;
        var bandIndex = bandIndexFor(m, current.bands);
        var isAffected =
          current.affectedMarks && current.affectedMarks.has
            ? current.affectedMarks.has(m)
            : false;
        g.appendChild(
          D.svg("rect", {
            class: "chart__bar",
            x: x(m) + binW * 0.12,
            y: y(c),
            width: Math.max(1, binW * 0.76),
            height: Math.max(1, y1 - y(c)),
            fill: isAffected ? "var(--c-accent)" : bandIndex === null ? "var(--c-primary)" : RAMP[bandIndex],
            "clip-path": "url(#" + clipId(container) + ")"
          })
        );
      }
      svg.appendChild(g);

      /* ---- descriptive markers ----------------------------------------- */
      if (!current.bands) {
        drawMarker(svg, stats.median, "median", "var(--c-ink-500)", x0, plotW, L, y1);
        if (stats.mean !== null && stats.stdDev !== null) {
          drawMarker(svg, stats.mean, "mean " + fmt(stats.mean, 1), "var(--c-ink-400)", x0, plotW, L, y1);
        }
      }

      /* ---- x axis ------------------------------------------------------- */
      var tickStep = L.narrow ? 20 : plotW > 620 ? 10 : 20;
      for (var t2 = 0; t2 <= 100; t2 += tickStep) {
        svg.appendChild(
          D.svg("text", {
            class: "chart__tick" + (t2 % 50 === 0 ? " chart__tick--strong" : ""),
            x: x(t2) + binW / 2,
            y: y1 + 15,
            "text-anchor": "middle",
            text: t2
          })
        );
        svg.appendChild(
          D.svg("line", { class: "chart__grid-line", x1: x(t2), x2: x(t2), y1: y1, y2: y1 + 4 })
        );
      }
      svg.appendChild(
        D.svg("text", {
          class: "chart__axis-title",
          x: x0 + plotW / 2,
          y: L.height - 8,
          "text-anchor": "middle",
          text: "Total marks out of 100"
        })
      );
      if (!L.narrow) {
        svg.appendChild(
          D.svg("text", {
            class: "chart__axis-title",
            x: 12,
            y: L.mt - 18,
            text: "Students"
          })
        );
      }

      /* ---- cutoffs ------------------------------------------------------ */
      // A chart with no onCutoff handler (the printed report) still shows where
      // the boundaries are, just without the draggable handles.
      var showCutoffs = current.cutoffs && (current.onCutoff || current.readOnly);
      if (showCutoffs) {
        current.cutoffs.forEach(function (c, i) {
          var cx = x(c);
          svg.appendChild(
            D.svg("line", { class: "chart__cutoff", x1: cx, x2: cx, y1: L.mt - 12, y2: y1 })
          );
          var gradeLabel = CF.grading.GRADES[i];
          if (current.readOnly) {
            svg.appendChild(
              D.svg("text", { class: "chart__cutoff-value", x: cx, y: L.mt - 6, text: gradeLabel + " " + c })
            );
            return;
          }
          var g2 = D.svg("g", {
            class: "chart__cutoff-grip-wrap",
            tabindex: "0",
            role: "slider",
            "aria-label": gradeLabel + " minimum mark",
            "aria-valuemin": "1",
            "aria-valuemax": "100",
            "aria-valuenow": String(c),
            "aria-valuetext": c + " marks and above",
            "aria-describedby": "chartKeyHelp"
          });
          g2.appendChild(
            D.svg("rect", {
              class: "chart__cutoff-grip",
              dataset: { cutoff: String(i) },
              x: cx - 7.5,
              y: L.mt - 27,
              width: 15,
              height: 15,
              rx: 4.5
            })
          );
          g2.appendChild(
            D.svg("rect", { class: "chart__cutoff-focus", x: cx - 10, y: L.mt - 29.5, width: 20, height: 20, rx: 7 })
          );
          g2.appendChild(D.svg("text", { class: "chart__cutoff-value", x: cx, y: L.mt - 32, text: c }));
          g2.addEventListener("keydown", function (e) {
            var step = e.shiftKey ? 5 : 1;
            var v = current.cutoffs[i];
            var next = null;
            if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = v - step;
            else if (e.key === "ArrowRight" || e.key === "ArrowUp") next = v + step;
            else if (e.key === "PageDown") next = v - 10;
            else if (e.key === "PageUp") next = v + 10;
            else if (e.key === "Home") next = 1;
            else if (e.key === "End") next = 100;
            if (next === null) return;
            e.preventDefault();
            current.onCutoff(i, next, "keyboard");
          });
          svg.appendChild(g2);
        });
      }

      /* ---- hit layer for hover tooltips -------------------------------- */
      var hit = D.svg("rect", {
        class: "chart__bar-hit",
        x: x0,
        y: L.mt - 14,
        width: plotW + binW,
        height: plotH + 14,
        "data-chart-hit": "1"
      });
      svg.appendChild(hit);
      hit.addEventListener("mousemove", function (e) {
        var rect = svg.getBoundingClientRect();
        var scale = L.width / rect.width;
        var px = (e.clientX - rect.left) * scale;
        var mark = Math.max(0, Math.min(100, Math.floor((px - x0) / binW)));
        showTip(tip, mark, hist, current, x(mark) / scale, (y(hist.bins[mark]) / scale) - 2, rect);
      });
      hit.addEventListener("mouseleave", function () {
        if (tip) tip.dataset.visible = "false";
      });

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
      function makeTip() {
        if (!tip) tip = D.el("div.chart__tooltip", { role: "presentation" });
        tip.dataset.visible = "false";
        container.appendChild(tip);
      }
      makeTip();
    }

    function attachCutoffBehaviour() {
      /*
       * Drag handling lives on the container, not on the grip, because the SVG
       * is rebuilt on every change. Attaching it to the grip destroyed the
       * element mid-drag, so the very first pointermove cancelled the gesture.
       */
      var dragIndex = null;
      var pendingFrame = 0;
      var lastClientX = 0;

      function valueFromClientX(clientX) {
        var svgEl = container.querySelector("svg");
        if (!svgEl) return null;
        var rect = svgEl.getBoundingClientRect();
        if (!rect.width) return null;
        var L = layout(svgEl.getAttribute("viewBox").split(" ").slice(2).map(Number), true);
        var scale = L.width / rect.width;
        var px = (clientX - rect.left) * scale;
        var x0 = L.ml;
        var binW = (L.width - L.ml - L.mr) / 101;
        return Math.round((px - x0) / binW);
      }

      container.addEventListener("pointerdown", function (e) {
        var grip = e.target.closest ? e.target.closest("[data-cutoff]") : null;
        if (!grip || !container.contains(grip)) return;
        dragIndex = Number(grip.dataset.cutoff);
        lastClientX = e.clientX;
        container.setPointerCapture && container.setPointerCapture(e.pointerId);
        container.style.touchAction = "none";
        grip.dataset.dragging = "true";
        e.preventDefault();
      });

      container.addEventListener("pointermove", function (e) {
        if (dragIndex === null) return;
        lastClientX = e.clientX;
        if (pendingFrame) return;
        pendingFrame = requestAnimationFrame(function () {
          pendingFrame = 0;
          if (dragIndex === null || !current || !current.onCutoff) return;
          var v = valueFromClientX(lastClientX);
          if (v === null) return;
          current.onCutoff(dragIndex, v, "drag");
        });
      });

      var end = function (e) {
        if (dragIndex === null) return;
        var grip = container.querySelector('[data-cutoff="' + dragIndex + '"][data-dragging]');
        if (grip) delete grip.dataset.dragging;
        dragIndex = null;
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
          if (current) draw();
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

  function bandIndexFor(mark, bands) {
    if (!bands) return null;
    for (var i = 0; i < bands.length; i++) {
      if (mark >= bands[i].min && mark <= bands[i].max) return i;
    }
    return null;
  }

  function drawMarker(svg, value, label, colour, x0, plotW, L, y1) {
    if (value === null || !isFinite(value)) return;
    var binW = plotW / 101;
    var px = x0 + value * binW;
    svg.appendChild(
      D.svg("line", { class: "chart__stat-line", x1: px, x2: px, y1: L.mt, y2: y1, stroke: colour })
    );
    // Labelled at the top of the plot: on the baseline the label collided with
    // the bars, which is exactly where the interesting data is.
    var anchor = value > 92 ? "end" : value < 8 ? "start" : "middle";
    var dx = value > 92 ? -4 : value < 8 ? 4 : 0;
    svg.appendChild(
      D.svg("text", {
        class: "chart__stat-label",
        x: px + dx,
        y: L.mt - 5,
        "text-anchor": anchor,
        fill: colour,
        text: label
      })
    );
  }

  function showTip(tip, mark, hist, m, xPx, yPx, svgRect) {
    if (!tip) return;
    var count = hist.bins[mark];
    D.clear(tip);
    var grade = m.bands ? gradeForMark(mark, m.bands) : null;
    tip.appendChild(
      D.el("div", null, [
        D.el("b", { text: mark + (mark === 100 ? " marks" : count === 1 ? " mark" : " marks") }),
        grade ? D.el("span", { text: "  " + grade }) : null
      ])
    );
    tip.appendChild(
      D.el("div.chart__tooltip-row", null, [
        D.el("span", { text: "Students" }),
        D.el("span", { text: String(count) })
      ])
    );
    tip.dataset.visible = "true";
    var left = U.clamp(xPx, 70, svgRect.width - 70);
    tip.style.left = left + "px";
    tip.style.top = Math.max(56, yPx) + "px";
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
    var table = D.el("table", { class: "visually-hidden" });
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
    return table;
  }

  function fmt(v, dp) {
    if (v === null || v === undefined || !isFinite(v)) return "n/a";
    return dp === 1 ? v.toFixed(1) : String(Math.round(v * 100) / 100);
  }

  var idCount = 0;
  function clipId(container) {
    if (!container.dataset.clipId) container.dataset.clipId = "cf-clip-" + ++idCount;
    return container.dataset.clipId;
  }

  function legend(items) {
    var box = D.el("div.chart-legend");
    items.forEach(function (it) {
      var sw = D.el("span.chart-legend__swatch", {
        class: it.line ? "chart-legend__swatch--line" : it.cut ? "chart-legend__swatch--cut" : "",
        style: it.colour ? { background: it.colour, borderColor: it.colour } : null
      });
      if (it.line) sw.style.borderTopColor = it.colour || "";
      if (it.cut) sw.style.borderLeftColor = it.colour || "";
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
