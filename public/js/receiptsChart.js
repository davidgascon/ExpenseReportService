// Single-series column chart of receipt uploads over time, on the admin
// dashboard. Deliberately hand-rolled SVG rather than pulling in a charting
// library - one series, no legend needed, and this keeps the app dependency-
// free on the frontend like everything else here.
(function () {
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var VIEW_WIDTH = 800;
  var VIEW_HEIGHT = 220;
  var MARGIN = { top: 12, right: 10, bottom: 24, left: 30 };
  var MAX_BAR_WIDTH = 24;
  var BAR_GAP = 2;
  var MAX_X_LABELS = 8;

  function niceMax(value) {
    if (value <= 0) return 4;
    var magnitude = Math.pow(10, Math.floor(Math.log(value) / Math.LN10));
    var normalized = value / magnitude;
    var step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return step * magnitude;
  }

  // A rect with rounded top corners, square at the baseline - drawn as a
  // path since SVG's native rx/ry rounds all four corners uniformly.
  function roundedTopRectPath(x, y, w, h, r) {
    if (h <= 0) return '';
    var radius = Math.min(r, w / 2, h);
    if (radius <= 0) {
      return 'M' + x + ',' + (y + h) + ' L' + x + ',' + y + ' L' + (x + w) + ',' + y + ' L' + (x + w) + ',' + (y + h) + ' Z';
    }
    return [
      'M' + x + ',' + (y + h),
      'L' + x + ',' + (y + radius),
      'Q' + x + ',' + y + ' ' + (x + radius) + ',' + y,
      'L' + (x + w - radius) + ',' + y,
      'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + radius),
      'L' + (x + w) + ',' + (y + h),
      'Z',
    ].join(' ');
  }

  function el(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    for (var key in attrs) node.setAttribute(key, attrs[key]);
    return node;
  }

  function getTooltip() {
    var tooltip = document.getElementById('chartTooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'chartTooltip';
      tooltip.className = 'chart-tooltip';
      document.body.appendChild(tooltip);
    }
    return tooltip;
  }

  function showTooltip(evt, text) {
    var tooltip = getTooltip();
    tooltip.textContent = text;
    tooltip.style.left = evt.clientX + 12 + 'px';
    tooltip.style.top = evt.clientY + 12 + 'px';
    tooltip.classList.add('visible');
  }

  function hideTooltip() {
    var tooltip = document.getElementById('chartTooltip');
    if (tooltip) tooltip.classList.remove('visible');
  }

  function render(container, data) {
    container.innerHTML = '';
    var labels = data.labels;
    var counts = data.counts;
    var max = niceMax(Math.max.apply(null, counts.concat([0])));

    var plotWidth = VIEW_WIDTH - MARGIN.left - MARGIN.right;
    var plotHeight = VIEW_HEIGHT - MARGIN.top - MARGIN.bottom;
    var slotWidth = plotWidth / labels.length;
    var barWidth = Math.min(MAX_BAR_WIDTH, slotWidth - BAR_GAP);

    var svg = el('svg', { viewBox: '0 0 ' + VIEW_WIDTH + ' ' + VIEW_HEIGHT, preserveAspectRatio: 'none' });

    // Gridlines at 0%, 50%, 100% of the nice max, with only the two ends
    // labeled - the tooltip carries the exact value per bar.
    [0, 0.5, 1].forEach(function (fraction) {
      var y = MARGIN.top + plotHeight * (1 - fraction);
      svg.appendChild(el('line', { class: 'gridline', x1: MARGIN.left, x2: VIEW_WIDTH - MARGIN.right, y1: y, y2: y }));
      if (fraction === 0 || fraction === 1) {
        var label = el('text', { class: 'axis-label', x: MARGIN.left - 6, y: y + 3, 'text-anchor': 'end' });
        label.textContent = Math.round(max * fraction);
        svg.appendChild(label);
      }
    });

    var labelStep = Math.max(1, Math.ceil(labels.length / MAX_X_LABELS));

    labels.forEach(function (label, i) {
      var count = counts[i];
      var barHeight = (count / max) * plotHeight;
      var x = MARGIN.left + i * slotWidth + (slotWidth - barWidth) / 2;
      var y = MARGIN.top + (plotHeight - barHeight);

      if (barHeight > 0) {
        var bar = el('path', { class: 'bar', d: roundedTopRectPath(x, y, barWidth, barHeight, 4) });
        svg.appendChild(bar);
      }

      // A full-height hit target (not just the visible bar) makes even a
      // zero-value day easy to hover for its tooltip.
      var hit = el('rect', {
        class: 'bar-hit',
        x: MARGIN.left + i * slotWidth,
        y: MARGIN.top,
        width: slotWidth,
        height: plotHeight,
      });
      hit.addEventListener('mousemove', function (evt) {
        showTooltip(evt, label + ': ' + count + ' receipt' + (count === 1 ? '' : 's'));
      });
      hit.addEventListener('mouseleave', hideTooltip);
      svg.appendChild(hit);

      if (i % labelStep === 0 || i === labels.length - 1) {
        var xLabel = el('text', { class: 'axis-label', x: x + barWidth / 2, y: VIEW_HEIGHT - MARGIN.bottom + 16, 'text-anchor': 'middle' });
        xLabel.textContent = label;
        svg.appendChild(xLabel);
      }
    });

    container.appendChild(svg);
  }

  function loadChart(container, range) {
    fetch('/admin/receipts-chart?range=' + range)
      .then(function (resp) { return resp.json(); })
      .then(function (data) { render(container, data); })
      .catch(function () {
        container.textContent = 'Could not load chart data.';
      });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var container = document.getElementById('receiptsChart');
    var rangeSelect = document.getElementById('receiptsChartRange');
    if (!container || !rangeSelect) return;

    loadChart(container, rangeSelect.value);
    rangeSelect.addEventListener('change', function () {
      loadChart(container, rangeSelect.value);
    });
  });
})();
