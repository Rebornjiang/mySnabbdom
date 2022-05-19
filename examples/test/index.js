/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  init,
  attributesModule,
  h,
  classModule,
  propsModule,
  styleModule,
  eventListenersModule,
} from "../../build/index.js";

const patch = init([
  // 通过传入模块初始化 patch 函数
  classModule, // 开启 classes 功能
  propsModule, // 支持传入 props
  styleModule, // 支持内联样式同时支持动画
  eventListenersModule, // 添加事件监听
  // 创建自定义模块
  {
    pre() {
      console.log("我的模块中的 pre 钩子函数触发");
    },
  },
]);

// 调试 h 函数
const vnode = h(
  "div#app.container",
  {
    class: { active: true },
    attrs: { value: "123" },
  },
  [
    "这是一个单一的文本节点，即将会被 h 函数转换为 vnode对象",
    h("hr"),
    h("input", {
      attrs: { value: "文本节点" },
      on: {
        input: (thisArgs, event, vnode) => {
          console.log("input 框 input 事件触发了", { thisArgs, event, vnode });
        },
      },
    }),
  ]
);
