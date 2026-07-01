// admin-chart.js
// Vanilla SVG line chart với dual y-axis, filter buttons, metric toggles.
// Không phụ thuộc thư viện ngoài.

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Vẽ line chart với 2 metrics trên dual y-axis.
 * @param {SVGElement} svg
 * @param {Array<{bucket: string, value: number}>} revenueSeries
 * @param {Array<{bucket: string, value: number}>} pvSeries
 * @param {{showRevenue: boolean, showPageViews: boolean}} opts
 */
export function renderLineChart(svg, revenueSeries, pvSeries, opts) {
  // Clear
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const W = 800, H = 300;
  const padding = { top: 20, right: 60, bottom: 40, left: 60 };
  const chartW = W - padding.left - padding.right;
  const chartH = H - padding.top - padding.bottom;

  // Union of buckets
  const bucketSet = new Set();
  if (opts.showRevenue) revenueSeries.forEach(p => bucketSet.add(p.bucket));
  if (opts.showPageViews) pvSeries.forEach(p => bucketSet.add(p.bucket));
  const buckets = Array.from(bucketSet).sort();

  if (buckets.length === 0) {
    svg.style.display = 'none';
    return false; // empty
  }

  svg.style.display = 'block';

  // Map bucket → index
  const xScale = (i) => padding.left + (buckets.length === 1 ? chartW / 2 : (i / (buckets.length - 1)) * chartW);

  // Revenue scale (left axis)
  const revMax = Math.max(1, ...revenueSeries.map(p => Number(p.value) || 0)) * 1.1;
  const yScaleRev = (v) => padding.top + chartH - (v / revMax) * chartH;

  // PV scale (right axis)
  const pvMax = Math.max(1, ...pvSeries.map(p => Number(p.value) || 0)) * 1.1;
  const yScalePv = (v) => padding.top + chartH - (v / pvMax) * chartH;

  // Grid lines + Y axis labels
  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const y = padding.top + (chartH / gridLines) * i;
    const line = createSvg('line', {
      x1: padding.left, x2: W - padding.right,
      y1: y, y2: y,
      stroke: '#e2e8f0', 'stroke-width': 1, 'stroke-dasharray': '2,3'
    });
    svg.appendChild(line);

    // Left axis label (revenue)
    if (opts.showRevenue) {
      const revVal = revMax * (1 - i / gridLines);
      const label = createSvg('text', {
        x: padding.left - 8, y: y + 4,
        'text-anchor': 'end', 'font-size': 10, fill: '#64748b'
      });
      label.textContent = formatVndShort(revVal);
      svg.appendChild(label);
    }
    // Right axis label (page views)
    if (opts.showPageViews) {
      const pvVal = pvMax * (1 - i / gridLines);
      const label = createSvg('text', {
        x: W - padding.right + 8, y: y + 4,
        'text-anchor': 'start', 'font-size': 10, fill: '#64748b'
      });
      label.textContent = Math.round(pvVal).toString();
      svg.appendChild(label);
    }
  }

  // X axis labels (show subset to avoid crowding)
  const maxLabels = 8;
  const labelStep = Math.max(1, Math.ceil(buckets.length / maxLabels));
  buckets.forEach((b, i) => {
    if (i % labelStep !== 0 && i !== buckets.length - 1) return;
    const label = createSvg('text', {
      x: xScale(i), y: H - padding.bottom + 16,
      'text-anchor': 'middle', 'font-size': 10, fill: '#64748b'
    });
    label.textContent = formatBucketLabel(b);
    svg.appendChild(label);
  });

  // Axes
  svg.appendChild(createSvg('line', {
    x1: padding.left, x2: padding.left,
    y1: padding.top, y2: padding.top + chartH,
    stroke: '#cbd5e1', 'stroke-width': 1
  }));
  svg.appendChild(createSvg('line', {
    x1: padding.left, x2: W - padding.right,
    y1: padding.top + chartH, y2: padding.top + chartH,
    stroke: '#cbd5e1', 'stroke-width': 1
  }));

  // Draw lines
  if (opts.showRevenue && revenueSeries.length > 0) {
    drawLine(svg, revenueSeries, buckets, xScale, yScaleRev, '#2563eb', 2.5, 'revenue');
  }
  if (opts.showPageViews && pvSeries.length > 0) {
    drawLine(svg, pvSeries, buckets, xScale, yScalePv, '#10b981', 2.5, 'pageViews');
  }

  return true;
}

function drawLine(svg, series, allBuckets, xScale, yScale, color, strokeWidth, id) {
  // Build map for lookup
  const dataMap = new Map(series.map(p => [p.bucket, Number(p.value) || 0]));

  // Build path
  let pathD = '';
  allBuckets.forEach((b, i) => {
    const v = dataMap.get(b);
    if (v == null) return;
    const x = xScale(i);
    const y = yScale(v);
    pathD += (pathD === '' ? 'M' : 'L') + ` ${x} ${y}`;
  });

  if (pathD) {
    const path = createSvg('path', {
      d: pathD, fill: 'none', stroke: color, 'stroke-width': strokeWidth,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', id: `chart-line-${id}`
    });
    svg.appendChild(path);
  }

  // Dots
  allBuckets.forEach((b, i) => {
    const v = dataMap.get(b);
    if (v == null) return;
    const dot = createSvg('circle', {
      cx: xScale(i), cy: yScale(v), r: 3.5,
      fill: color, stroke: 'white', 'stroke-width': 1.5,
      'data-bucket': b, 'data-value': v, 'data-id': id,
      class: 'chart-dot'
    });
    svg.appendChild(dot);
  });
}

function createSvg(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  return el;
}

function formatVndShort(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'k';
  return Math.round(n).toString();
}

function formatBucketLabel(isoDate) {
  const d = new Date(isoDate);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}
