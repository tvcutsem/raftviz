/**
 * cluster.js — Cluster container
 *
 * Holds the set of Node instances that form a Raft cluster and exposes
 * a simple lookup interface used by the Scheduler and tests.
 */

import { Node } from './node.js';

export class Cluster {
  /**
   * @param {string[]} nodeIds  Ordered list of node IDs (e.g. ['A','B','C'])
   */
  constructor(nodeIds) {
    this._nodeIds = [...nodeIds];
    this._nodes   = new Map();
    for (const id of this._nodeIds) {
      this._nodes.set(id, new Node(id, this._nodeIds));
    }
  }

  /** All node IDs in the cluster. */
  get nodeIds() { return this._nodeIds; }

  /** Number of nodes. */
  get size() { return this._nodeIds.length; }

  /**
   * Look up a node by its ID.
   * @param {string} id
   * @returns {Node}
   */
  getNode(id) {
    const node = this._nodes.get(id);
    if (!node) throw new Error(`Unknown node: ${id}`);
    return node;
  }

  /** Iterate over all nodes. */
  allNodes() { return [...this._nodes.values()]; }
}
