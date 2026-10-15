import type { FlagDependencyGraph, FlagStatus } from "@iwifunni/contracts";

import type { DependencyRow, FlagStatusRef } from "./flags.types.js";

type EdgeMap = Map<string, Set<string>>;

function addEdge(map: EdgeMap, from: string, to: string): void {
  const existing = map.get(from);

  if (existing) existing.add(to);
  else map.set(from, new Set([to]));
}

function reachable(start: string, edges: EdgeMap): Set<string> {
  const seen = new Set<string>();
  const queue = [...(edges.get(start) ?? [])];

  while (queue.length > 0) {
    const next = queue.shift();

    if (!next || seen.has(next)) continue;

    seen.add(next);
    queue.push(...(edges.get(next) ?? []));
  }

  return seen;
}

/** Depth-first order in which every node follows the nodes it requires. */
function topological(nodes: Set<string>, requiresOf: EdgeMap): string[] {
  const ordered: string[] = [];
  const visited = new Set<string>();

  function visit(node: string): void {
    if (visited.has(node)) return;

    visited.add(node);

    for (const dependency of requiresOf.get(node) ?? []) {
      if (nodes.has(dependency)) visit(dependency);
    }

    ordered.push(node);
  }

  for (const node of nodes) visit(node);

  return ordered;
}

function longestChain(
  node: string,
  edges: EdgeMap,
  nodes: Set<string>,
  visiting: Set<string>,
): number {
  if (visiting.has(node)) return 0;

  visiting.add(node);
  let depth = 0;

  for (const next of edges.get(node) ?? []) {
    if (!nodes.has(next)) continue;

    depth = Math.max(depth, 1 + longestChain(next, edges, nodes, visiting));
  }

  visiting.delete(node);

  return depth;
}

/**
 * Edges from the flag to its furthest ancestor (or descendant): the longest
 * chain counted in hops, not in nodes, and zero when nothing is related.
 */
function maxDistance(nodes: Set<string>, edges: EdgeMap): number {
  if (nodes.size === 0) return 0;

  let depth = 0;

  for (const node of nodes) {
    depth = Math.max(depth, longestChain(node, edges, nodes, new Set()));
  }

  return depth + 1;
}

/**
 * Turns the flat `flag_dependencies` rows around one flag into the graph the
 * dependencies screen draws. `requires` is evaluated before `referencedIn`, so
 * the evaluation order is the upstream chain, the flag, then what depends on it.
 */
export function buildDependencyGraph(
  flagKey: string,
  rows: DependencyRow[],
  statuses: FlagStatusRef[],
): FlagDependencyGraph {
  const requiresOf: EdgeMap = new Map();
  const dependentsOf: EdgeMap = new Map();

  for (const row of rows) {
    addEdge(requiresOf, row.key, row.requires);
    addEdge(dependentsOf, row.requires, row.key);
  }

  const upstream = reachable(flagKey, requiresOf);
  const downstream = reachable(flagKey, dependentsOf);
  const statusByKey = new Map(
    statuses.map((entry) => [entry.key, entry.status]),
  );

  const toNode = (key: string, isSelf = false) => ({
    key,
    status: (statusByKey.get(key) ?? "active") as FlagStatus,
    isSelf,
  });

  const upstreamOrder = topological(upstream, requiresOf);
  const downstreamOrder = topological(downstream, requiresOf);

  const circular = upstream.has(flagKey) || downstream.has(flagKey);

  return {
    upstream: [...upstream].sort(),
    downstream: [...downstream].sort(),
    summary: {
      upstream: upstream.size,
      downstream: downstream.size,
      circular,
      maxDepth: Math.max(
        maxDistance(upstream, requiresOf),
        maxDistance(downstream, dependentsOf),
      ),
    },
    evaluationOrder: [
      ...upstreamOrder.map((key) => toNode(key)),
      toNode(flagKey, true),
      ...downstreamOrder.map((key) => toNode(key)),
    ],
  };
}
