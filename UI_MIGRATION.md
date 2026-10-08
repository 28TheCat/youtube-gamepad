# 页面内设置面板迁移

## 早期启动入口

`bundles/early.js` 在 ISOLATED world 的 `document_start` 执行，不引入 Vue 或启动手柄轮询。它通过临时 `data-ytg-boot`、`data-ytg-boot-theme` 属性准备启动状态和提示外观，不改写 YouTube 的 `dark` 属性，不隐藏或阻止原页面操作。仅在设置启用且标准手柄已连接时显示非阻塞的加载提示。

MAIN 初始化成功发出 `ytg-main-ready`，content 初始化成功通过同一 ISOLATED 环境中的生命周期句柄确认接管；两者均完成后移除提示和临时属性。这仅表示入口初始化完成，播放器及页面适配就绪仍由现有协调器管理。初始化失败、页面退出、存储读取失败或 15 秒超时也会清理。页面事件只控制临时提示，不授予扩展权限。清理后的异步结果不能重新创建提示。

验证：`node --test tests/early-start.test.mjs`、`npm run build:extension`。

页面内设置是页面 UI 的首个迁移单元。`src/settings/InlineSettings.vue` 在现有菜单的 Shadow DOM 中渲染，`inline-settings.js` 保留 `mount(root, container) → dispose` 接口，由 ISOLATED world 的 content 入口挂载和卸载。

`inline-settings-model.ts` 管理面板局部响应状态、设置校验、保存和诊断操作。设置仍由 `chrome.storage.local` 持久化；页面消息只能请求开关面板，不能提交设置值。面板临时状态不需要第二套 Pinia store。

菜单继续负责手柄动作分发、Tab 范围和最终返回原页面。面板通过稳定的 `data-setting` 标识，在 Vue `nextTick` 后恢复焦点；进入子分类聚焦首个操作，手柄分类聚焦当前布局。返回顺序是按键选择、手柄设置、设置分类、快捷菜单、原卡片。外部设置同步和控制器外观变化不抢走菜单返回按钮上的焦点。

关闭时卸载 Vue 应用、移除存储监听和 MutationObserver，并取消排队的焦点恢复。尚未完成的保存可以完成持久化，但不能更新已关闭面板的提示或焦点。

构建通过 Vue 插件预编译组件并替换生产环境常量。关闭静态 HTML 字符串提升，支持页面禁止 Trusted Types policy 的环境，沿用现有 Shadow 样式和主题变量。

验证：

- `npm run check`：包含 Vue 组件与设置模型的类型检查。
- `npm test`：包含失败保存、加载失败、关闭时待完成保存、外部同步的模型测试。
- `npm run test:extension`：包含真实扩展双环境中的虚拟手柄、逐层返回、按键交换、布局隔离、外部同步、重新打开和窄屏测试。

## 描述与评论面板迁移

`WatchPanel.vue` 统一渲染描述、评论正文、折叠状态、回复与加载提示，`mount-watch-panel.ts` 提供同步更新和幂等卸载。面板策略仍由 `watch-panels.ts` 管理，评论与回复请求继续走 YouTube 适配端口；所有页面文本通过 Vue 插值呈现，不作为 HTML 执行。

评论使用稳定的原生 key，按钮提供 `data-focus-id`。列表追加或前插时按按钮标识保持焦点；折叠后不可见的回复按钮不参与手柄导航。返回仍关闭当前面板并恢复原播放按钮。关闭、隐藏和销毁时卸载 Vue，销毁后不再更新或请求评论；切换视频清除旧评论折叠记录。

生产播放视图统一使用 `createVueWatchView`，旧 `watch-view.ts` 与播放策略中的备用 DOM 渲染分支已移除。最小 VM 测试保留独立的 renderer double，生产打包不会包含它。Vue 面板测试 `watch-panels-vue.test.mjs` 验证描述更新、评论文本安全、折叠、回复、分页、焦点保持、加载失败提示和关闭清理，同时覆盖禁止 Trusted Types policy 的页面。

## 搜索界面迁移

搜索已拆分为 `search-model.ts`（搜索策略和状态）、`search-text.ts`（文本及 UTF-16 光标操作）、`SearchPanel.vue`、`SearchKeyboard.vue`、`CandidateList.vue` 和 `mount-search.ts`。拼音算法和键位规则继续由 `pinyin.ts`、`keyboard.ts` 提供。

模型把已确认的 query 与尚未确认的 composition 分开；候选确认、删除、光标移动和提交均沿用现有业务操作。Vue 只负责渲染，搜索仍经由 controller 的原生 YouTube 搜索适配接口提交。未确认拼音会阻止提交；提交失败不会关闭搜索或写入历史。

菜单通过注入的 renderer 挂载搜索。`mount-search.ts` 使用同步 Vue render，使现有手柄操作可以在更新后立即按稳定的 `data-focus-id` 及键位坐标恢复焦点。关闭、切换视图和销毁菜单时卸载 Vue 树；renderer 的 dispose 幂等，卸载后的 update 不再渲染。

返回契约仍由菜单状态机决定：先退出语言选择或取消拼音，再根据搜索入口返回快捷菜单或原页面，并恢复原焦点。搜索 UI 不另建一套返回状态机。

验证入口：`npm run check`、`npm run build:extension`、`node --test tests/back-search.test.mjs tests/pinyin.test.mjs`，以及真实扩展测试 `node --test tests/search-vue.test.mjs`。后者覆盖 Vue 输入、emoji 删除、键位恢复、拼音确认、逐层返回、重开、原生搜索提交、历史文本转义及窄屏；需浏览器能够正常启动才算完成运行验证。

搜索专项验收（2026-10-08）：`node scripts/check-vue.cjs -p tsconfig.search.json` 通过；真实扩展搜索测试 3/3 通过，补充覆盖 R3 在键盘/候选之间切换、LB/RB 候选分页和使用原始拼音。默认 Chromium 在本机启动报 `spawn UNKNOWN`，实际验收使用 Edge 154 的 CDP 扩展加载：

```powershell
$env:YTG_BROWSER_EXECUTABLE = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$env:YTG_EXTENSION_CDP_LOAD = '1'
node --test --test-concurrency=1 tests/search-vue.test.mjs
```

手柄测试依赖页面处于活动状态；在该 Edge 环境应串行运行多个扩展测试文件，避免前台焦点竞争。

## 播放旧渲染路径清理

生产播放入口仅使用 Vue 展示接口。`watch.ts` 不再根据 presentation 是否存在切换旧 DOM 渲染；协调器要求注入 createWatchView，旧的 src/ui/watch-view.ts 已移除。WatchView 契约只保留业务操作、焦点和面板所需的节点，不再暴露标题、图标及其他旧渲染字段。

VM 测试的最小 DOM 展示替身位于 tests/helpers/watch-view-fixture.ts，仅由测试加载器使用，不进入扩展产物。真实 Vue 渲染由 playback-vue.test.mjs 验证；浏览器无法启动时，单元测试不能替代真实浏览器验证。

## 播放业务与视图解耦

播放业务 `src/playback/watch.ts` 通过 `WatchDependencies.createSurface` 接收视图端口，不再持有标题、按钮、进度条、推荐卡片或评论节点。端口提供可跳转状态、可用操作、推荐目标及面板目标的数据快照；业务通过目标 ID 请求聚焦，通过操作接口请求显示、滚动、反馈和销毁。

`src/ui/watch-surface.ts` 负责把这些请求落实到 Vue 视图，并收集焦点事件和评论滚动距离。DOM 查询、动画、事件阻止传播以及面板节点均留在 UI 层。推荐焦点 ID 使用视频 key 和重复出现次数，列表重排后仍按身份解析目标，避免选错卡片或同时高亮重复视频。

新增 `tests/watch-surface.test.mjs` 验证数据快照、不可跳转状态、推荐重排、重复视频、评论焦点及销毁后的延迟更新；保留现有播放状态机和模型测试。
