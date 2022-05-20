import { Module } from "./modules/module";
import { vnode, VNode } from "./vnode";
import * as is from "./is";
import { htmlDomApi, DOMAPI } from "./htmldomapi";

type NonUndefined<T> = T extends undefined ? never : T;

function isUndef(s: any): boolean {
  return s === undefined;
}
function isDef<A>(s: A): s is NonUndefined<A> {
  return s !== undefined;
}

type VNodeQueue = VNode[];

const emptyNode = vnode("", {}, [], undefined, undefined);

function sameVnode(vnode1: VNode, vnode2: VNode): boolean {
  const isSameKey = vnode1.key === vnode2.key;
  const isSameIs = vnode1.data?.is === vnode2.data?.is;
  const isSameSel = vnode1.sel === vnode2.sel;

  return isSameSel && isSameKey && isSameIs;
}

/**
 * @todo Remove this function when the document fragment is considered stable.
 */
function documentFragmentIsNotSupported(): never {
  throw new Error("The document fragment is not supported on this platform.");
}

function isElement(
  api: DOMAPI,
  vnode: Element | DocumentFragment | VNode
): vnode is Element {
  return api.isElement(vnode as any);
}

function isDocumentFragment(
  api: DOMAPI,
  vnode: DocumentFragment | VNode
): vnode is DocumentFragment {
  return api.isDocumentFragment!(vnode as any);
}

type KeyToIndexMap = { [key: string]: number };

type ArraysOf<T> = {
  [K in keyof T]: Array<T[K]>;
};

type ModuleHooks = ArraysOf<Required<Module>>;

function createKeyToOldIdx(
  children: VNode[],
  beginIdx: number,
  endIdx: number
): KeyToIndexMap {
  const map: KeyToIndexMap = {};
  for (let i = beginIdx; i <= endIdx; ++i) {
    const key = children[i]?.key;
    if (key !== undefined) {
      map[key as string] = i;
    }
  }
  return map;
}

const hooks: Array<keyof Module> = [
  "create",
  "update",
  "remove",
  "destroy",
  "pre",
  "post",
];

// TODO Should `domApi` be put into this in the next major version bump?
export type Options = {
  experimental?: {
    fragments?: boolean;
  };
};

export function init(
  modules: Array<Partial<Module>>,
  domApi?: DOMAPI,
  options?: Options
) {
  const cbs: ModuleHooks = {
    create: [],
    update: [],
    remove: [],
    destroy: [],
    pre: [],
    post: [],
  };

  const api: DOMAPI = domApi !== undefined ? domApi : htmlDomApi;

  for (const hook of hooks) {
    for (const module of modules) {
      const currentHook = module[hook];
      if (currentHook !== undefined) {
        (cbs[hook] as any[]).push(currentHook);
      }
    }
  }

  function emptyNodeAt(elm: Element) {
    const id = elm.id ? "#" + elm.id : "";

    // elm.className doesn't return a string when elm is an SVG element inside a shadowRoot.
    // https://stackoverflow.com/questions/29454340/detecting-classname-of-svganimatedstring
    const classes = elm.getAttribute("class");

    const c = classes ? "." + classes.split(" ").join(".") : "";
    return vnode(
      api.tagName(elm).toLowerCase() + id + c,
      {},
      [],
      undefined,
      elm
    );
  }

  function emptyDocumentFragmentAt(frag: DocumentFragment) {
    return vnode(undefined, {}, [], undefined, frag);
  }

  function createRmCb(childElm: Node, listeners: number) {
    return function rmCb() {
      if (--listeners === 0) {
        const parent = api.parentNode(childElm) as Node;
        api.removeChild(parent, childElm);
      }
    };
  }

  function createElm(vnode: VNode, insertedVnodeQueue: VNodeQueue): Node {
    let i: any;
    // 获取 vnodeData
    let data = vnode.data;

    // 1. 看看当前 vnodeData 中是否右 init 钩子，如果有就执行
    if (data !== undefined) {
      const init = data.hook?.init;
      if (isDef(init)) {
        init(vnode);
        data = vnode.data;
      }
    }

    const children = vnode.children;
    const sel = vnode.sel;
    // 2. sel 如果是 ！为注释节点
    if (sel === "!") {
      // 如果注释节点Vnode text 没有定义要将其换成 空字符串, 不能够为 undefined ,不然展示就为 undefined
      if (isUndef(vnode.text)) {
        vnode.text = "";
      }
      // 根据 text 文本创建真实的 注释节点 dom
      vnode.elm = api.createComment(vnode.text!);
    }
    // 3. sel 不为 undefined，这要创建真实的 dom 的节点
    else if (sel !== undefined) {
      // - 1）Parse selector 获取 tag
      /*
        'div#app.class1.class2' 前置位 # 能够正确的得到 tag
        'div.class1.class2#app' 后位置 # 得到的 tag 为 div.class1.class2
        div || div#app || div.class1能够正确的得到 tag
      */
      const hashIdx = sel.indexOf("#");

      // dotIdx 如果为 -1 并且 hashIdx 不为 -1 代表当前 # 在 class 之后
      const dotIdx = sel.indexOf(".", hashIdx);
      const hash = hashIdx > 0 ? hashIdx : sel.length;

      const dot = dotIdx > 0 ? dotIdx : sel.length;
      const tag =
        hashIdx !== -1 || dotIdx !== -1
          ? sel.slice(0, Math.min(hash, dot))
          : sel;

      // - 2）创建真实的 dom 元素，data.ns 决定所创建的 dom 是否是带指定命名空间的dom(这个作用好像是用来创建 svg 元素的)

      const elm = (vnode.elm =
        isDef(data) && isDef((i = data.ns))
          ? api.createElementNS(i, tag, data)
          : api.createElement(tag, data));

      // - 3）给创建的元素添加上 class id 选择器；对于两者 id ，class 都有的，要把 # 前置
      if (hash < dot) elm.setAttribute("id", sel.slice(hash + 1, dot));
      if (dotIdx > 0)
        elm.setAttribute("class", sel.slice(dot + 1).replace(/\./g, " "));

      // - 4) 当元素创建的时候，需要触发所有模块的钩子函数
      // 模块的 create 生命周期钩子为什么要传 空节点
      for (i = 0; i < cbs.create.length; ++i) cbs.create[i](emptyNode, vnode);

      // - 5）当前 vnode 对象的 dom 创建完成，需要考虑其内容，看看内容是子节点还是文本节点

      // 如果内容有子节点，继续递归调用 createElm，并把最后创建的元素挂在到当前 vnode 的 真实 dom 上
      if (is.array(children)) {
        for (i = 0; i < children.length; ++i) {
          const ch = children[i];
          if (ch != null) {
            api.appendChild(elm, createElm(ch as VNode, insertedVnodeQueue));
          }
        }
      }
      // 内容为文本节点，创建文本节点，挂载到当前 vnode对象的 elm 上
      else if (is.primitive(vnode.text)) {
        api.appendChild(elm, api.createTextNode(vnode.text));
      }

      // 到这里 vnodeData 中的 hook 的create 钩子的里面通过 vnode 对象的 elm 可以拿到他自己真实的 dom 和所有的子节点
      const hook = vnode.data!.hook;
      if (isDef(hook)) {
        hook.create?.(emptyNode, vnode);
        if (hook.insert) {
          insertedVnodeQueue.push(vnode);
        }
      }
    }
    // 4. Fragment 是碎片节点，他不属于 dom 树的一部分， 他的变化不会触发 dom树重新渲染，所以不会导致性能问题。
    // Fragment 用处：创建一个碎片节点，把所有的真实 dom 子节点  添加到 碎片节点里面，然后在把整个 碎片节点添加到父节点里面，这样只会渲染一次，性能更好。
    else if (options?.experimental?.fragments && vnode.children) {
      // 如果在调用 init 函数第三个参数有传 options, 并且 experimental.fragments 的值 为 true ，说明开启了碎片节点选项
      // 接下来只要在创建 vnode 的时候，将 sel === undefined ，这时候会创建 framents 碎片节点
      const children = vnode.children;

      // 如果当前浏览器不支持 createDocumentFrament API 就抛出异常，否则创建碎片节点
      vnode.elm = (
        api.createDocumentFragment ?? documentFragmentIsNotSupported
      )();
      for (i = 0; i < cbs.create.length; ++i) cbs.create[i](emptyNode, vnode);

      // 遍历所有的子节点，然后调用 createElm 递归去创建所有子节点，并将其挂载到碎片节点上
      for (i = 0; i < children.length; ++i) {
        const ch = children[i];
        if (ch != null) {
          api.appendChild(
            vnode.elm,
            createElm(ch as VNode, insertedVnodeQueue)
          );
        }
      }
    }
    // 5. sel 为空，也不是 fragments ，就创建空的文本节点
    else {
      vnode.elm = api.createTextNode(vnode.text!);
    }

    // 6. 返回当前根据 vnode 对象所创建的真实的 dom
    return vnode.elm;
  }

  function addVnodes(
    parentElm: Node,
    before: Node | null,
    vnodes: VNode[],
    startIdx: number,
    endIdx: number,
    insertedVnodeQueue: VNodeQueue
  ) {
    for (; startIdx <= endIdx; ++startIdx) {
      const ch = vnodes[startIdx];
      if (ch != null) {
        api.insertBefore(parentElm, createElm(ch, insertedVnodeQueue), before);
      }
    }
  }
  // 触发 vnode 对象中的 vnodeData.hook 中定义的destory 钩子，然后触发模块的 destory 钩子
  function invokeDestroyHook(vnode: VNode) {
    const data = vnode.data;
    if (data !== undefined) {
      data?.hook?.destroy?.(vnode);
      for (let i = 0; i < cbs.destroy.length; ++i) cbs.destroy[i](vnode);
      if (vnode.children !== undefined) {
        // vnode 内容如果是子节点 vnode ，递归触发其 destory 钩子
        for (let j = 0; j < vnode.children.length; ++j) {
          const child = vnode.children[j];
          if (child != null && typeof child !== "string") {
            invokeDestroyHook(child);
          }
        }
      }
    }
  }

  function removeVnodes(
    parentElm: Node,
    vnodes: VNode[],
    startIdx: number,
    endIdx: number
  ): void {
    for (; startIdx <= endIdx; ++startIdx) {
      let listeners: number;
      let rm: () => void;
      // 取到当前 vnode 对象
      const ch = vnodes[startIdx];
      if (ch != null) {
        // 判断当前是否有定义 sel
        if (isDef(ch.sel)) {
          // 触发当前要删除的 vnode 和其所有的子节点 vnode 的 并且模块中的 destory 钩子
          invokeDestroyHook(ch);

          // 根据所有第三方模块所拥有 remove 钩子的个数，并且加上 1
          listeners = cbs.remove.length + 1;

          // 如果第三方模块中和当前 vnode 对象中的 vnodeData 有 remove 钩子，将将删除操作移交给第三方模块和定义vnode的用户。
          // 假如说第三方模块中有三个模块带 remove 钩子，此时listener 就是 4， 也就意味着要调用 4 次 rm 函数才会删除当前 vnode 对象的 elm
          rm = createRmCb(ch.elm!, listeners);
          for (let i = 0; i < cbs.remove.length; ++i) cbs.remove[i](ch, rm);
          const removeHook = ch?.data?.hook?.remove;
          if (isDef(removeHook)) {
            removeHook(ch, rm);
          } else {
            rm();
          }
        } else {
          // 没有定义 sel 是文本节点
          // Text node
          api.removeChild(parentElm, ch.elm!);
        }
      }
    }
  }

  function updateChildren(
    parentElm: Node,
    oldCh: VNode[],
    newCh: VNode[],
    insertedVnodeQueue: VNodeQueue
  ) {
    let oldStartIdx = 0;
    let newStartIdx = 0;
    let oldEndIdx = oldCh.length - 1;
    let oldStartVnode = oldCh[0];
    let oldEndVnode = oldCh[oldEndIdx];
    let newEndIdx = newCh.length - 1;
    let newStartVnode = newCh[0];
    let newEndVnode = newCh[newEndIdx];
    let oldKeyToIdx: KeyToIndexMap | undefined;
    let idxInOld: number;
    let elmToMove: VNode;
    let before: any;

    while (oldStartIdx <= oldEndIdx && newStartIdx <= newEndIdx) {
      if (oldStartVnode == null) {
        oldStartVnode = oldCh[++oldStartIdx]; // Vnode might have been moved left
      } else if (oldEndVnode == null) {
        oldEndVnode = oldCh[--oldEndIdx];
      } else if (newStartVnode == null) {
        newStartVnode = newCh[++newStartIdx];
      } else if (newEndVnode == null) {
        newEndVnode = newCh[--newEndIdx];
      } else if (sameVnode(oldStartVnode, newStartVnode)) {
        patchVnode(oldStartVnode, newStartVnode, insertedVnodeQueue);
        oldStartVnode = oldCh[++oldStartIdx];
        newStartVnode = newCh[++newStartIdx];
      } else if (sameVnode(oldEndVnode, newEndVnode)) {
        patchVnode(oldEndVnode, newEndVnode, insertedVnodeQueue);
        oldEndVnode = oldCh[--oldEndIdx];
        newEndVnode = newCh[--newEndIdx];
      } else if (sameVnode(oldStartVnode, newEndVnode)) {
        // Vnode moved right
        patchVnode(oldStartVnode, newEndVnode, insertedVnodeQueue);
        api.insertBefore(
          parentElm,
          oldStartVnode.elm!,
          api.nextSibling(oldEndVnode.elm!)
        );
        oldStartVnode = oldCh[++oldStartIdx];
        newEndVnode = newCh[--newEndIdx];
      } else if (sameVnode(oldEndVnode, newStartVnode)) {
        // Vnode moved left
        patchVnode(oldEndVnode, newStartVnode, insertedVnodeQueue);
        api.insertBefore(parentElm, oldEndVnode.elm!, oldStartVnode.elm!);
        oldEndVnode = oldCh[--oldEndIdx];
        newStartVnode = newCh[++newStartIdx];
      } else {
        if (oldKeyToIdx === undefined) {
          oldKeyToIdx = createKeyToOldIdx(oldCh, oldStartIdx, oldEndIdx);
        }
        idxInOld = oldKeyToIdx[newStartVnode.key as string];
        if (isUndef(idxInOld)) {
          // New element
          api.insertBefore(
            parentElm,
            createElm(newStartVnode, insertedVnodeQueue),
            oldStartVnode.elm!
          );
        } else {
          elmToMove = oldCh[idxInOld];
          if (elmToMove.sel !== newStartVnode.sel) {
            api.insertBefore(
              parentElm,
              createElm(newStartVnode, insertedVnodeQueue),
              oldStartVnode.elm!
            );
          } else {
            patchVnode(elmToMove, newStartVnode, insertedVnodeQueue);
            oldCh[idxInOld] = undefined as any;
            api.insertBefore(parentElm, elmToMove.elm!, oldStartVnode.elm!);
          }
        }
        newStartVnode = newCh[++newStartIdx];
      }
    }

    if (newStartIdx <= newEndIdx) {
      before = newCh[newEndIdx + 1] == null ? null : newCh[newEndIdx + 1].elm;
      addVnodes(
        parentElm,
        before,
        newCh,
        newStartIdx,
        newEndIdx,
        insertedVnodeQueue
      );
    }
    if (oldStartIdx <= oldEndIdx) {
      removeVnodes(parentElm, oldCh, oldStartIdx, oldEndIdx);
    }
  }

  function patchVnode(
    oldVnode: VNode,
    vnode: VNode,
    insertedVnodeQueue: VNodeQueue
  ) {
    const hook = vnode.data?.hook;
    hook?.prepatch?.(oldVnode, vnode);
    const elm = (vnode.elm = oldVnode.elm)!;
    const oldCh = oldVnode.children as VNode[];
    const ch = vnode.children as VNode[];
    if (oldVnode === vnode) return;
    if (
      vnode.data !== undefined ||
      (isDef(vnode.text) && vnode.text !== oldVnode.text)
    ) {
      vnode.data ??= {};
      oldVnode.data ??= {};
      for (let i = 0; i < cbs.update.length; ++i)
        cbs.update[i](oldVnode, vnode);
      vnode.data?.hook?.update?.(oldVnode, vnode);
    }
    if (isUndef(vnode.text)) {
      if (isDef(oldCh) && isDef(ch)) {
        if (oldCh !== ch) updateChildren(elm, oldCh, ch, insertedVnodeQueue);
      } else if (isDef(ch)) {
        if (isDef(oldVnode.text)) api.setTextContent(elm, "");
        addVnodes(elm, null, ch, 0, ch.length - 1, insertedVnodeQueue);
      } else if (isDef(oldCh)) {
        removeVnodes(elm, oldCh, 0, oldCh.length - 1);
      } else if (isDef(oldVnode.text)) {
        api.setTextContent(elm, "");
      }
    } else if (oldVnode.text !== vnode.text) {
      if (isDef(oldCh)) {
        removeVnodes(elm, oldCh, 0, oldCh.length - 1);
      }
      api.setTextContent(elm, vnode.text!);
    }
    hook?.postpatch?.(oldVnode, vnode);
  }

  return function patch(
    oldVnode: VNode | Element | DocumentFragment,
    vnode: VNode
  ): VNode {
    let i: number, elm: Node, parent: Node;
    const insertedVnodeQueue: VNodeQueue = [];
    for (i = 0; i < cbs.pre.length; ++i) cbs.pre[i]();

    // 1. 当前 oldVnode 是否是一个真实的 dom || 真实的 fragment节点 ，如果是的为其创建空的 空的 vnode 作为 oldVnode
    if (isElement(api, oldVnode)) {
      // 如果是真实的 dom 节点，会创建一个空的 vnode 对象，不过对于真实 dom 的子节点并没有创建 vnode 对象，也就是说 当前空的 vnode 只有 sel, elm 属性，其他均为空
      oldVnode = emptyNodeAt(oldVnode);
    } else if (isDocumentFragment(api, oldVnode)) {
      oldVnode = emptyDocumentFragmentAt(oldVnode);
    }

    // 2. 对比新旧 vnode 看看是否是 sameVnode, 两个 vnode sel属性，key 属性是否是相等的
    if (sameVnode(oldVnode, vnode)) {
      // 2.1 是相等的话，使用 diff算法 对比起差异部分
      patchVnode(oldVnode, vnode, insertedVnodeQueue);
    } else {
      // 2.2 如果不是相等的，
      elm = oldVnode.elm!;

      // - 获取当前 oldVnode 上的 elm（真实 dom） 的父节点
      parent = api.parentNode(elm) as Node;

      // - 根据 新的 vnode 对象创建创建真实的元素
      createElm(vnode, insertedVnodeQueue);

      // - 当前 oldVnode 上的 elm（真实 dom） 的父节点不为空，在页面上，插入新 vnode 对象上的 真实 dom ，并删除 oldvnode 对象上的vnode
      if (parent !== null) {
        api.insertBefore(parent, vnode.elm!, api.nextSibling(elm));
        removeVnodes(parent, [oldVnode], 0, 0);
      }
    }

    // 此时到这里所有的 节点 都被添加到页面上了，触发各个创建的 vnode 对象上的 vnodeData insert 钩子
    for (i = 0; i < insertedVnodeQueue.length; ++i) {
      insertedVnodeQueue[i].data!.hook!.insert!(insertedVnodeQueue[i]);
    }

    // 触发第三方模块的post钩子
    for (i = 0; i < cbs.post.length; ++i) cbs.post[i]();

    // 返回新的 vnode 最为下次调用 patch 函数的 oldVnode
    return vnode;
  };
}
