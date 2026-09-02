import type { AABB, Vec3 } from '@assemble/domain';
import { vec3Max, vec3Min } from './aabb.js';

export interface BroadPhaseResult {
  /** 待精判的候选零件对 */
  candidates: Array<[string, string]>;
  /** 参与检测的叶子数（零件包围体数） */
  leafCount: number;
}

/** 二叉 AABB 树节点（线性存储，索引 0 为根） */
interface BvhNode {
  left: number;
  right: number;
  /** 是否叶子 */
  leaf: boolean;
  /** 该节点覆盖的 AABB 上界 */
  aabb: AABB;
  /** 叶子持有零件 id，非叶子为 -1 */
  partId: string;
}

/**
 * Bounding Volume Hierarchy —— Broad Phase 空间索引。
 *
 * 构造时以中位切分轴循环剖分包围体集合，叶子携带单个零件 AABB。
 * query 阶段做「树 vs 树 / 树 vs 叶子」的对撞遍历，快速剔除不相交对，
 * 仅把候选对送入 narrow phase。
 *
 * 实现要点：
 *  - 切分轴按包围体最长的维度循环选择，降低树深、提升剔除率。
 *  - 遍历时利用「父包围盒不相交 => 子树整体不相交」的剪枝。
 */
export class Bvh {
  private nodes: BvhNode[] = [];
  private leaves: BvhNode[] = [];
  private rootBox: AABB = { min: [0, 0, 0], max: [0, 0, 0] };

  private constructor() {}

  /** 空树 */
  static empty(): Bvh {
    return new Bvh();
  }

  /**
   * 从一组带 AABB 的零件构建 BVH。
   * @param items 零件 id -> 包围盒
   */
  static build(items: Array<{ partId: string; box: AABB }>): Bvh {
    const tree = new Bvh();
    if (items.length === 0) return tree;
    // 拷贝并保持排序稳定
    const arr = items.map((it) => ({ ...it }));
    const idx: number[] = arr.map((_, i) => i);

    // 全局根范围
    let min: Vec3 = [Infinity, Infinity, Infinity];
    let max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const it of arr) {
      min = vec3Min(min, it.box.min);
      max = vec3Max(max, it.box.max);
    }
    tree.rootBox = { min, max };

    const buildNode = (list: number[]): number => {
      const n = list.length;
      let box: AABB = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      for (const i of list) {
        box.min = vec3Min(box.min, arr[i]!.box.min);
        box.max = vec3Max(box.max, arr[i]!.box.max);
      }
      // 先分配本节点索引（占位），确保 children 使用更大的索引，避免互相覆盖
      const nodeIdx = tree.nodes.length;
      if (n === 1) {
        const leaf: BvhNode = {
          left: -1,
          right: -1,
          leaf: true,
          aabb: box,
          partId: arr[list[0]!]!.partId,
        };
        tree.nodes.push(leaf);
        tree.leaves.push(leaf);
        return nodeIdx;
      }
      // 选最长维度切分
      const extents = [
        box.max[0] - box.min[0],
        box.max[1] - box.min[1],
        box.max[2] - box.min[2],
      ];
      let axis = 0;
      if (extents[1]! > extents[axis]!) axis = 1;
      if (extents[2]! > extents[axis]!) axis = 2;
      const mid =
        (box.min[axis]! + box.max[axis]!) / 2;
      const leftList: number[] = [];
      const rightList: number[] = [];
      for (const i of list) {
        const center =
          (arr[i]!.box.min[axis]! + arr[i]!.box.max[axis]!) / 2;
        if (center <= mid) leftList.push(i);
        else rightList.push(i);
      }
      // 避免退化（如全在一边）
      if (leftList.length === 0 || rightList.length === 0) {
        const half = n >> 1;
        leftList.length = 0;
        rightList.length = 0;
        for (let k = 0; k < n; k++) {
          (k < half ? leftList : rightList).push(list[k]!);
        }
      }
      // 先 push 内部节点占位（拿到 nodeIdx），children 在更靠后的索引
      const inner: BvhNode = {
        left: -1,
        right: -1,
        leaf: false,
        aabb: box,
        partId: '',
      };
      tree.nodes.push(inner);
      const left = buildNode(leftList);
      const right = buildNode(rightList);
      // 回填 children 索引与包围盒
      tree.nodes[nodeIdx] = { ...inner, left, right };
      return nodeIdx;
    };

    const rootIdx = buildNode(idx);
    tree.nodes[rootIdx] = tree.nodes[rootIdx]!;
    return tree;
  }

  /** 根包围盒（供整体对撞） */
  get root(): AABB {
    return this.rootBox;
  }

  get nodeCount(): number {
    return this.nodes.length;
  }

  private nodeAt(i: number): BvhNode {
    return this.nodes[i]!;
  }

  /** 静态：两 AABB 是否相交 */
  static aabbOverlap(a: AABB, b: AABB): boolean {
    return (
      a.min[0] <= b.max[0] && a.max[0] >= b.min[0] &&
      a.min[1] <= b.max[1] && a.max[1] >= b.min[1] &&
      a.min[2] <= b.max[2] && a.max[2] >= b.min[2]
    );
  }

  /**
   * 全对撞：返回本树内自相交的候选零件对（排除自身）。
   * 供服务端离线整线预检使用（所有零件一次性入树）。
   *
   * 采用标准 self-collision：根内部 = 左子树自撞 ∪ 右子树自撞 ∪ 左×右 两两碰撞，
   * 保证每对叶子只被精确访问一次，无重复候选。
   */
  selfIntersect(): Array<[string, string]> {
    const out: Array<[string, string]> = [];

    const emitPair = (pa: string, pb: string): void => {
      if (pa === pb) return;
      out.push(pa < pb ? [pa, pb] : [pb, pa]);
    };

    /** 两棵互不相同的子树之间的候选对 */
    const collideNodes = (a: number, b: number): void => {
      const na = this.nodeAt(a);
      const nb = this.nodeAt(b);
      if (!Bvh.aabbOverlap(na.aabb, nb.aabb)) return;
      if (na.leaf && nb.leaf) {
        emitPair(na.partId, nb.partId);
        return;
      }
      // 下钻更粗的一方（非叶优先拆分）
      if (na.leaf) {
        collideNodes(a, nb.left);
        collideNodes(a, nb.right);
      } else {
        collideNodes(na.left, b);
        collideNodes(na.right, b);
      }
    };

    /** 节点内部的自我碰撞 */
    const selfCollide = (i: number): void => {
      const node = this.nodeAt(i);
      if (node.leaf) return;
      selfCollide(node.left);
      selfCollide(node.right);
      collideNodes(node.left, node.right);
    };

    if (this.nodes.length > 1) selfCollide(0);
    return out;
  }

  /**
   * 树 vs 叶子：返回某新增零件（单 AABB）与已存在零件集合的候选对。
   * 供前端实时装配（逐步插入零件做交互检测）使用。
   */
  queryAgainstSingle(newPartId: string, box: AABB): string[] {
    const out: string[] = [];
    const stack: number[] = [0];
    while (stack.length) {
      const i = stack.pop()!;
      const node = this.nodeAt(i);
      if (!Bvh.aabbOverlap(node.aabb, box)) continue;
      if (node.leaf) {
        if (node.partId !== newPartId) out.push(node.partId);
      } else {
        stack.push(node.left, node.right);
      }
    }
    return out;
  }
}
