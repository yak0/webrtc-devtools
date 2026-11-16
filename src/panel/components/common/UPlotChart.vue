<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import uPlot from 'uplot';

export interface ChartSeries {
  label: string;
  data: (number | null)[];
  color?: string;
  /** Put the series on a secondary (right) axis. */
  right?: boolean;
}

const props = withDefaults(
  defineProps<{
    times: number[];
    series: ChartSeries[];
    /** Bump to redraw with new data. */
    version: number;
    height?: number;
    format?: (v: number) => string;
    formatRight?: (v: number) => string;
    legend?: boolean;
    /** Charts sharing a key move their cursors together. */
    syncKey?: string;
    /** x values are seconds since an origin, not wall clock. */
    relativeX?: boolean;
  }>(),
  { height: 160, legend: true }
);

const PALETTE = ['#2080f0', '#18a058', '#f0a020', '#d03050', '#8a2be2', '#00b3b3', '#e05ac0', '#7a7a7a'];
const el = ref<HTMLDivElement>();
let plot: uPlot | null = null;
let signature = '';
let ro: ResizeObserver | null = null;

const isDarkTheme = inject<boolean>('dark', false);

function data(): uPlot.AlignedData {
  return [props.times.map((t) => t / 1000), ...props.series.map((s) => s.data)] as uPlot.AlignedData;
}

function create() {
  plot?.destroy();
  if (!el.value) return;
  const isDark = isDarkTheme;
  const grid = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const text = isDark ? '#aaa' : '#555';
  const fmt = props.format ?? ((v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${+v.toFixed(2)}`));
  const hasRight = props.series.some((s) => s.right);
  // uPlot sides: 0 top, 1 right, 2 bottom, 3 left. Always pass one explicitly:
  // `side: undefined` is not treated as the default and puts the axis on top.
  const axis = (scale: string, f: (v: number) => string, side: 1 | 3): uPlot.Axis => ({
    scale,
    side,
    stroke: text,
    grid: { stroke: grid, width: 1, show: side === 3 },
    ticks: { stroke: grid, width: 1 },
    size: 74,
    space: 18,
    values: (_u, vals) => vals.map((v) => (v === null ? '' : f(v)))
  });
  const opts: uPlot.Options = {
    width: el.value.clientWidth || 400,
    height: props.height,
    legend: { show: props.legend, live: true },
    cursor: { drag: { x: true, y: false }, points: { size: 5 }, ...(props.syncKey ? { sync: { key: props.syncKey } } : {}) },
    scales: { x: { time: !props.relativeX }, y: { auto: true, range: (_u, min, max) => [Math.min(0, min), max > 0 ? max * 1.1 : 1] }, r: { auto: true } },
    axes: [
      {
        stroke: text,
        grid: { stroke: grid, width: 1 },
        ticks: { stroke: grid, width: 1 },
        size: 28,
        ...(props.relativeX ? { values: (_u: uPlot, vals: number[]) => vals.map((v) => `${v}s`) } : {})
      },
      axis('y', fmt, 3),
      ...(hasRight ? [axis('r', props.formatRight ?? fmt, 1)] : [])
    ],
    series: [
      {},
      ...props.series.map((s, i) => ({
        label: s.label,
        scale: s.right ? 'r' : 'y',
        stroke: s.color ?? PALETTE[i % PALETTE.length],
        width: 1.5,
        spanGaps: false,
        points: { show: false },
        value: (_u: uPlot, v: number | null) => (v === null || v === undefined ? '—' : (s.right ? (props.formatRight ?? fmt) : fmt)(v))
      }))
    ]
  };
  plot = new uPlot(opts, data(), el.value);
  signature = props.series.map((s) => s.label + (s.right ? 'R' : '')).join('|');
}

function update() {
  const sig = props.series.map((s) => s.label + (s.right ? 'R' : '')).join('|');
  if (!plot || sig !== signature) create();
  else plot.setData(data());
}

onMounted(() => {
  create();
  ro = new ResizeObserver(() => {
    if (plot && el.value) plot.setSize({ width: el.value.clientWidth, height: props.height });
  });
  ro.observe(el.value!);
});
onBeforeUnmount(() => {
  ro?.disconnect();
  plot?.destroy();
  plot = null;
});
watch(() => props.version, update);
watch(() => props.series.length, update);
</script>

<template>
  <div ref="el" class="wrd-chart" />
</template>

<style scoped>
.wrd-chart {
  width: 100%;
  min-width: 0;
}
</style>
