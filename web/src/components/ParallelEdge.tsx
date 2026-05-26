import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
} from '@xyflow/react'

export interface ParallelEdgeData {
  /** 0-based position within the (source, target) bundle */
  index: number
  /** Total number of edges in this (source, target) bundle */
  total: number
  /** Rendered label (e.g. "fk_col → pk_col") */
  label: string
  [key: string]: unknown
}

/**
 * Custom React Flow edge that fans parallel edges (same source-target
 * node pair) apart along the perpendicular axis. With React Flow's
 * default bezier edge two parallel relationships render on top of
 * each other, hiding one of the FKs entirely.
 *
 * Routing: a quadratic bezier with the control point offset from the
 * straight-line midpoint by `(index - (total-1)/2) * SPAN`, in the
 * direction perpendicular to source→target. The middle edge (when
 * `total` is odd) routes straight; outer edges fan above and below.
 */
const SPAN_PX = 35

export function ParallelEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  markerEnd,
  style,
}: EdgeProps) {
  const d = data as unknown as ParallelEdgeData
  const offset = (d.index - (d.total - 1) / 2) * SPAN_PX

  const midX = (sourceX + targetX) / 2
  const midY = (sourceY + targetY) / 2

  const dx = targetX - sourceX
  const dy = targetY - sourceY
  const len = Math.hypot(dx, dy) || 1
  // Perpendicular unit vector. Sign chosen so positive offset fans
  // "downward" (in screen coords) for an LR layout — purely aesthetic.
  const px = -dy / len
  const py = dx / len

  const cpX = midX + px * offset
  const cpY = midY + py * offset

  const path = `M ${sourceX},${sourceY} Q ${cpX},${cpY} ${targetX},${targetY}`

  // Quadratic bezier value at t = 0.5
  const labelX = 0.25 * sourceX + 0.5 * cpX + 0.25 * targetX
  const labelY = 0.25 * sourceY + 0.5 * cpY + 0.25 * targetY

  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="parallel-edge-label nodrag nopan"
        >
          {d.label}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
