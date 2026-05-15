/**
 * components/flow/dagLayout.ts — pure layout helpers for the per-task DAG.
 *
 * Wraps `dagre` so React Flow nodes/edges get positioned in a top-down
 * graph. Kept pure (no React imports) so it's trivially testable.
 */
import dagre from 'dagre'
import type { Edge, Node } from '@xyflow/react'

const NODE_WIDTH = 220
const NODE_HEIGHT = 86

export interface LayoutOptions {
  rankdir?: 'TB' | 'LR'
  rankSep?: number
  nodeSep?: number
}

export function layoutDag<T extends Record<string, unknown>>(
  nodes: Node<T>[],
  edges: Edge[],
  options: LayoutOptions = {},
): { nodes: Node<T>[]; edges: Edge[] } {
  if (nodes.length === 0) {
    return { nodes, edges }
  }
  const g = new dagre.graphlib.Graph()
  g.setGraph({
    rankdir: options.rankdir ?? 'TB',
    ranksep: options.rankSep ?? 70,
    nodesep: options.nodeSep ?? 40,
    marginx: 20,
    marginy: 20,
  })
  g.setDefaultEdgeLabel(() => ({}))

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }

  dagre.layout(g)

  const positioned = nodes.map((node) => {
    const pos = g.node(node.id)
    if (!pos) return node
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    }
  })

  return { nodes: positioned, edges }
}
