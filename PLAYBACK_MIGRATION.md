# 播放控件与浏览辅助界面 Vue 迁移

生产隔离环境的应用入口向 coordinator 注入 `createVueWatchView`、`mountBrowseOverlay` 和浏览网格挂载接口。MAIN 入口仅提供页面内部播放器信息及页面操作的桥接。播放按钮、标题、时间轴、推荐卡片、控制提示及媒体反馈由预编译 Vue 组件渲染，业务层提供播放和页面快照。Vue 不读取或替换 YouTube 播放器，也不创建新的模式或返回状态机。

`playback/watch.ts` 继续负责命令、自动隐藏、手柄导航、焦点恢复和生命周期。呈现接口同步提交 Vue 更新，然后业务层聚焦已渲染的元素，保持现有同步动作契约。控件节点保持稳定；推荐卡片保留视频标识，图片错误处理由卡片组件负责。时间轴沿用直播可跳转窗口，并避免零长度范围生成非有限进度。

`BrowseOverlay.vue` 接收导航模块测量得到的焦点位置、尺寸、圆角、调整状态和帮助显示状态。`BrowseGrid.vue` 通过独立挂载区域呈现 Pinia 浏览快照；`youtube-browse.ts` 继续读取原生数据和执行原生导航、加载更多。接管时隐藏原生卡片呈现，保留原生节点作为数据和操作来源；关闭时恢复原页面。组件沿用主题变量与现有焦点和返回策略。

`playback-model.ts` 管理播放快照、可跳转范围和拖动预览；`Timeline.vue`、`VolumeControl.vue` 把用户意图交回模型及原有操作接口。拖动预览不被后台时间快照覆盖，关闭、路由变化和卸载时取消预览。

描述与评论面板也由 `WatchPanel.vue` 渲染，通过独立挂载区域接收原有评论业务层的数据和操作接口。生产入口必须注入 Vue 播放呈现器；旧播放渲染器仅作为 `tests/helpers/watch-view-fixture.ts` 中的模拟环境夹具保留。导航模块未注入 Vue 的绘制路径仍用于轻量 VM 回归测试。

销毁时卸载 Vue 控件、反馈及浏览辅助组件。卸载后的呈现接口不再更新 DOM；现有 runtime 负责取消监听、定时器、动画和观察器。

验证入口：

- `npm run check`：源码端口及 Vue SFC 类型检查。
- `npm test`：现有行为和模拟环境回归。
- `npm run build:extension`：构建可加载扩展。
- `node --test tests/playback-vue.test.mjs`：真实浏览器中的时间轴拖动、快照更新期间的预览、直播范围及原生视频节点保留。
- `node --test tests/playback-extension.test.mjs`：真实扩展与虚拟手柄、播放暂停、焦点节点稳定性、时间轴调整和推荐视频导航。
- `node --test tests/browse-vue.test.mjs`：浏览网格接管、异步数据到达、更新后焦点保留、原生加载更多及退出恢复。

扩展测试使用可用的 Chromium。若改用本机 Chrome，设置 `YTG_BROWSER_EXECUTABLE` 为浏览器绝对路径，设置 `YTG_EXTENSION_CDP_LOAD=1`，通过调试 API 加载扩展。Trusted Types 两种页面环境均需验证。
