# 模块边界与接口

源码使用 `import/export` 声明依赖。`src/entries/` 提供 早期启动、MAIN、ISOLATED、后台、Popup 和 Options 六个入口，由 `scripts/build-extension.mjs` 使用 Vite 分别构建为自包含 IIFE。Manifest 只声明入口产物：early 与 MAIN 在 document_start 启动，ISOLATED 应用在 document_idle 启动。MAIN 保留播放器内部接口、分类数据请求适配和页面 history 通知；Vue、Pinia、手柄输入、协调器、DOM 站点适配和扩展服务均在 ISOLATED。`coordinator.ts` 通过命名导入取得工厂并组装接口，界面通过 `connect(port)` 接收操作和数据端口。生产代码不发布 `window.YTGamepad*` 对象。

生产依赖由 Vite 根据源码导入解析；`scripts/module-graph.mjs` 仅供旧 VM / DOM 测试兼容加载。核心、站点、菜单、播放、输入和浏览模块导出工厂；协调层显式传入 runtime、状态 store、焦点管理、样式、键盘和拼音等协作者，并创建实例。搜索、播放视图和面板的工厂由协调层作为回调注入其宿主，宿主仍拥有子实例的生命周期。

功能模块使用注入的协作者或命名导入；输入和浏览模块使用 `isSearchOpen()`、`isMenuOpen()` 获取必要观察值。实例保存在所属模块的导出绑定中。MAIN 适配器与 ISOLATED 应用各自保留一个 Symbol 生命周期清理句柄，重新注入时销毁旧实例；句柄不暴露业务对象，也不参与模块依赖解析。

业务源码已全部迁移到 TypeScript，Vue 组件使用 `<script setup lang="ts">`。`types/ports.d.ts`、`types/core.ts`、`types/actions.ts` 和 `types/events.d.ts` 定义模块工厂、数据快照、DOM 与播放器边界、动作参数及事件载荷；生产模块通过 `import type` 引入这些契约。快照只读且不包含原生 DOM 或媒体节点；搜索目标与焦点句柄留在操作端口。`npm run check` 对全部 TypeScript 源码和 Vue 组件执行严格类型检查，并检查 `tests/types/ports.ts` 中合法与应被拒绝的调用。`allowJs: false` 与源码检查共同防止业务 JavaScript 回流；构建输出仍是浏览器运行所需的 JavaScript。

小型 VM 和历史 DOM 回归由 `scripts/test-source.mjs` 兼容加载。`tests/bundled-runtime.test.mjs` 直接加载生产产物，在两个独立 JavaScript world 中验证通信、Vue 设置挂载、禁用恢复和重新注入；仅替换 Chrome 权限 API 和手柄采样。扩展 E2E 测试加载实际 `dist/` 或发布包，验证真实扩展权限环境。

## 跨环境通信

`src/bridge/page-server.ts` 在 MAIN 提供三个固定播放器操作：读取受限播放器元数据、显示原生控件、隐藏原生控件，以及不依赖播放器存在的 `ping` 握手。`page-client.ts` 使用同步 DOM CustomEvent 和 JSON 字符串跨 world 请求/响应，以保留同步 SitePort；请求具有版本、操作白名单、关联 ID、长度限制和运行时校验。缺少服务端时立即返回不可用，适配检查会恢复原生界面。页面输出始终视为不可信数据，MAIN 不接收扩展 API 操作。

ISOLATED 在挂载前每 100ms 重试握手，最多等待 3 秒。超时后仍启动应用服务，播放接管由能力检查降级到原生界面。因页面接口缺失而降级时，适配器握手恢复后重新检查；其他播放器故障保留手动重试，避免反复接管。启动等待受 AbortSignal 控制，重新注入、最终 pagehide 和启动失败都会取消重试及销毁资源；bfcache pagehide 保留应用。early 的主题提示和加载节点由同 world 的私有生命周期接口结束，不接受页面 ready/failed 事件；存储回调晚到时不会重建已清理的提示，15 秒兜底定时器处理应用入口完全未启动的情况。

页面 history 包装只在 MAIN 安装；变更通过受限通知传到 ISOLATED 的路由状态机。销毁时只恢复仍由本模块持有的包装，保留页面后装的包装；重新注入与 bfcache 生命周期分别处理。设置、菜单挂载、Escape 回退与诊断使用模块内 ApplicationChannel，不向页面公开设置快照，也不接受页面 postMessage 控制这些服务。旧同环境测试通过显式兼容端口运行，实际扩展测试验证两个 world。

## 职责

| 模块 | 拥有的职责 | 依赖边界 |
| --- | --- | --- |
| `state-machine.ts` | 纯状态转换、不可变交互状态、输入优先级和操作指令 | 不读取 DOM、时间、媒体或浏览器历史 |
| `gamepad.ts` | 手柄采样、按键映射、重复与输入设备切换 | 发送抽象动作，不执行站点操作 |
| `navigation.ts` | 分区和几何方向算法 | 接收测量结果，不读取站点 DOM |
| `core.ts` | 页面候选项、原生弹窗范围、几何测量、焦点与选中框 | 执行注入的输入策略，不读取菜单、播放界面或站点模块的全局状态 |
| `focus.ts` | 临时层恢复记录和焦点所有者注册 | 所有者自行解析目标并应用焦点 |
| `sites/youtube.ts` | YouTube 选择器、数据读取、媒体操作、原生搜索/设置/导航和页面变化监听 | 原生 DOM 引用留在适配层；向播放界面提供数据快照和操作键 |
| `app/route-state.ts` | 导航锁、历史链确认、取消和返回的纯状态规则 | 接收事件，输出状态和副作用描述，不读取浏览器历史 |
| `app/route-controller.ts` | 历史包装、路由监听、合法视频地址检查、执行返回指令 | 通过注入端口读取路由并调用浏览器和协调层 |
| `coordinator.ts` | 模式、适配能力、设置同步、输入所有者、模块连接 | 注入核心与界面端口；路由由 route-controller 执行 |
| `watch.ts` | 播放控件交互、推荐刷新和焦点、进度观察 | 只读取注入的数据端口，不查询 YouTube DOM |
| `ui/watch-view.ts` | 观看浮层的安全 DOM 构造、控件和图标 | 收到激活与关闭回调，不决定输入策略 |
| `ui/watch-panels.ts` | 说明和评论面板渲染、评论快照缓存和加载请求 | 使用注入的数据、状态和焦点端口 |
| `menu.ts` | 菜单宿主、打开关闭、焦点与搜索入口 | 创建搜索实例，并注入宿主和操作端口 |
| `search.ts` | 光标编辑、拼音候选、语言和键盘渲染、历史和提交 | 不查询站点搜索框；经端口同步和提交 |
| `ui/menu.css` / `ui/watch.css` | Shadow DOM 界面样式的维护源文件 | 生成 ui/styles.ts，使用 textContent 同步应用 |
| `runtime.ts` | 模块实例的监听器、定时任务、观察器和清理回调 | ISOLATED 应用使用资源注册表；content.ts 的扩展服务清理纳入同一应用生命周期，MAIN 适配器独立清理 |

会影响交互的状态统一保存在页面级 Pinia `useInteractionStore().state` 的 `app`、`watch` 和 `menu` 中。播放模式、导航锁和返回链、播放区域及选择索引、面板、搜索入口、语言选择、拼音组合和键盘布局，都通过 `transition(state, event)` 更新。界面保留 DOM、数据快照、几何测量、菜单按钮的实际焦点索引和文本光标；焦点层的 DOM 恢复记录继续由 `focus.ts` 管理。

## 数据与原生操作

播放端口由协调层注入，适配层实现以下读取接口：

- `readRoute()`：当前路由键和是否为视频页。
- `readWatchPage()`：标题、频道及头像、订阅/点赞/点踩状态、观看数、说明、推荐及等待状态。推荐仅包含 `key`、文字和图片地址。
- `readPlayback()`：时间、时长、暂停/结束状态、字幕与原生设置状态。视频状态是数据副本。
- `readComments()`：评论键、文字和回复信息；不暴露原生评论节点。

界面通过 `openRecommendation(key)`、`openChannel()`、`openSettings()`、`backSettings()`、`expandReplies(key)`、`loadComments()`、`seekTo(time)` 和 `perform(action)` 请求操作。协调层组合导航前的模式切换、返回链记录和焦点刷新。适配层检查原生元素是否仍可用；推荐激活还会重新核对目标地址。

订阅、点赞、点踩和保存经 `request('watchAction', action)` 调用适配层的 `performWatchAction(action)`，共用协调层的禁用和导航锁。保存优先点击原生保存按钮；按钮被折叠时查找原生更多菜单中的保存项，等待期间校验路由，并在两秒后停止。账号提示、订阅管理和播放列表选择由原生弹窗负责，输入仍由核心的原生弹窗层处理。

搜索使用 `readSearch`、`syncSearch`、`moveSearchCursor`、`submitSearch` 和 `readTheme`。搜索入口传入的元素仅作为适配操作的句柄，菜单不读取或修改该元素。`submitSearch` 找到可用的原生搜索框和按钮后，先调用成功前回调保存历史并关闭菜单，再执行原生点击；找不到时保留搜索界面并反馈错误。

`observePage(onChange)` 由适配层监听页面变化，协调层请求播放界面刷新。播放界面保留自己的进度刷新和空闲时间计时，自动隐藏是否允许由协调层决定。

## 动作归属

协调层向核心注入 `getPriorityLayer`、`getInputLayer`、`handleLayer`、`handleShortcut`、`handleRegion`、`handleBase`、`isNavigating`、`isFocusOwned`、`getFocusOwner`、`shouldShowSelection`、`ownsKeyboardEvent` 和 `onDisable`。核心执行通用分发机制，不自行决定某个具体菜单是否打开。

优先级为：

1. 禁用或路由切换锁：阻止动作。
2. 已打开的菜单/搜索：独占动作。
3. 原生弹窗：只接收导航、确认、返回，阻止其他快捷操作。
4. 说明/评论面板：独占动作。
5. 通用提示层、全局菜单快捷键。
6. 当前界面区域、基础播放，再到普通页面操作。

所有者处理函数返回 `handled`、`blocked` 或 `pass`。只有明确返回 `pass` 才继续分发；独占层的 `pass` 也会转为 `blocked`，避免输入穿透。B 和真实 Escape 都进入逐层 `back` 动作，遵守相同的导航锁。输入层在窗口捕获阶段消费真实 Escape，避免原生和 Shadow DOM 监听器重复处理；repeat 不重复分发，合成的关闭 Escape 不进入该入口。拔掉当前手柄仍发送 `yt-gamepad-exit`，恢复操作发送 `yt-gamepad-resume`；协调层临时停用导航核心与电视式界面，保留用户设置。Shadow DOM 界面通过注入的 `dispatchAction` 发送其他动作。

## 验证

### 自动降级

`sites/youtube.ts.inspectWatchCapabilities()` 检查原生播放器及属于该播放器的视频播放能力。读取失败返回失败观察，不把异常传播到界面。可选数据和直播时长不作为接管前提。`inspectOptionalCapabilities()` 分别观察推荐、评论、频道、字幕、设置及社交操作；`readWatchFeatures()` 返回可用、缺失或失败状态。可选端口隔离同步异常和异步拒绝，推荐失败清空其来源映射，评论失败清空回复映射并显示局部提示，后续检查允许恢复。

协调层通过状态机的 `ADAPTATION` 事件记录路由、`inactive / waiting / ready / fallback` 状态和原因。应用模式保留用户意图；对界面和导航暴露的有效模式只有能力就绪时才允许播放/控制栏模式。打开视频的导航锁和返回链仍由原状态机管理，验证前不提前应用播放布局。

每 500 毫秒及页面变化时检查关键能力。手柄确认视频时立即用独立电视加载画面覆盖页面，导航完成前不使用旧播放器判断新视频已就绪。初始加载最多等待 5 秒；等待期间原生播放器保留在加载画面下方，能力就绪后直接显示电视播放界面。导航取消、关闭手柄操作或适配失败时清除加载画面；已接管后能力失效立即降级。降级状态在当前路由保持稳定，用户点击“重试适配”或进入新路由时重新检查。

恢复先设置 `data-ytg-native` 样式安全开关，再关闭临时界面、撤销接管类并隐藏播放浮层。所有接管播放器布局和隐藏控制栏的样式均受该开关约束，即使界面渲染部分失败也不会继续遮蔽原生控件。读取数据或渲染异常使用同一恢复路径。降级不改变媒体播放状态或后台管理的窗口全屏。

运行 `node scripts/check.mjs` 和 `node --test tests/*.test.mjs`。边界测试覆盖：禁止播放界面访问原生 DOM时仍能渲染和操作、禁止核心读取具体模块时仍能分发、数据快照与原生节点隔离、失效推荐和旧视频数据处理。另有输入、搜索、焦点、原生设置、返回链和后台全屏回归。

自动测试使用模拟 DOM 和扩展 API。真实 YouTube 页面、浏览器扩展执行环境以及实体手柄仍需要验收。

## 状态机执行约定

`state-machine.ts` 只提供初始状态、纯转换规则与快照冻结。`transition(state, event)` 返回 `{ nextState, effects, disposition }`；相同输入得到相同输出，旧状态不会被修改。Pinia 的 `dispatch()` 提交并冻结新状态，随后调用方执行操作指令。状态对象可序列化；DOM 引用和函数不进入状态。

- `INPUT_OWNER`：根据启用、导航锁和当前层的观察值选择唯一输入归属。核心只执行分发结果。
- `BASE_INPUT`、`WATCH_INPUT`、`MENU_INPUT`：决定基础播放、播放区域和菜单的动作、阻止或放行结果。
- `WATCH_SHOW/FOCUS/PANEL/RESET`：处理界面展开、实际焦点观察、面板开关和路由重置。
- `MENU_SEARCH/BACK/COMPOSE/SET_LANGUAGE/FRAME`：处理搜索来源、逐层返回、组合输入、语言和键盘布局。
- `PREPARE_VIDEO/NAV_START/HISTORY/NAV_FINISH/NAV_CANCEL/POPSTATE/PAGE_BACK`：计算导航锁与可验证的返回链。
- `AUTO_HIDE`：只使用传入的空闲时长、播放和临时层观察值，不读取时钟。

`coordinator.ts` 执行媒体和模式指令，`app/route-controller.ts` 执行历史和返回指令，`watch.ts` 与 `menu.ts` 执行渲染和焦点指令。执行副作用前必须先提交状态，例如页面返回先设置导航锁，再调用浏览器历史。界面事件不能直接给状态字段赋值。新增交互应先添加纯转换规则和序列测试，再添加指令执行代码。

路由和返回事件由 `state-machine.ts` 委托给 `app/route-state.ts`，仍通过同一个 store 提交；没有新增第二份导航状态。浏览器历史操作由 `app/route-controller.ts` 执行。

## 生命周期与发布

长期监听通过 `runtime.scope(name).listen()` 注册，定时器、动画帧和观察器也由 scope 管理。已完成任务会释放资源；销毁会取消任务，并阻止已排队回调继续产生操作。同名 scope 替换旧实例前先清理。短生命周期按钮监听绑定在其 DOM 节点上，移除宿主后由浏览器回收，避免资源表保留每一次渲染的旧节点。

- 关闭界面：隐藏宿主并恢复外部焦点，保留实例供下次打开。
- 禁用功能：沿用 ENABLE 状态转换，恢复原生界面，保留接收设置和再次启用的能力。
- 销毁实例：调用模块的 destroy()，移除宿主、释放焦点所有者、原生节点缓存与后台任务。
- 销毁整个应用实例：ISOLATED 中调用 YTGamepadRuntime.destroy()；MAIN 播放器/history 适配器独立存活至页面退出或重新注入。路由包装只在仍是当前包装函数时恢复；站点后续安装的包装保留，旧包装变为无状态副作用的透传函数。非 bfcache 的 pagehide 自动销毁；bfcache 保留实例。

修改 Shadow 样式后运行 `npm run styles`；生成的 `ui/styles.ts` 随源码提交。执行 `npm run build:extension` 后加载 `dist/`。`npm run check` 校验入口、资源、ESM 语法、类型和样式生成一致性。`npm test` 运行纯规则和模拟环境回归；`npm run test:browser` 必须成功启动浏览器，不能以跳过代替验证。

`npm run build` 先检查源码并构建五个入口，再按清单、页面资源和许可证白名单生成独立发布目录，旁置 SHA-256 文件清单；`npm run check:release` 核对文件完整性，拒绝多余文件、遗漏、路径越界、符号链接和文件变化。测试、抓取资料、调试日志与开发脚本不会被打包。`YTG_EXTENSION_ROOT=latest-release` 让产物测试和扩展 E2E 读取最新发布包；旧 DOM 回归仍通过兼容加载器验证源码行为。

CI 从锁文件安装开发依赖，运行完整回归、生成发布包、核对完整性，再对发布包重复浏览器验证。浏览器测试使用本地构造的 YouTube 页面和全部 MAIN 脚本，验证实际 DOM、焦点、观察器、销毁和重新注入；线上 YouTube、扩展权限环境与实体手柄仍需要人工验收。

可通过 `YTGamepadCoordinator.interactionState` 读取完整不可变快照。排查问题时可将快照和事件传给 `YTGamepadStateMachine.transition()` 重放，不需要 YouTube 页面。`tests/state-machine.test.mjs` 在没有 DOM、历史和时钟的环境下验证纯转换，并覆盖多层返回、输入优先级、自动隐藏和重复导航。

## Vue 快捷菜单与页面级 Pinia

`entries/main.ts` 创建页面级 Pinia 和 `useInteractionStore()`，将同一个交互 store 注入 coordinator、菜单和播放等服务。`app/interaction-store.ts` 是交互状态的唯一容器，`dispatch()` 调用现有纯转换函数、提交新状态并返回 effects。生产代码不再创建旧的 `createStore()`，也不再订阅或复制快照到第二个 store。手柄动作继续经过原有 coordinator 和菜单指令。

`ui/QuickMenu.vue` 在现有 Shadow Root 内渲染快捷菜单，直接读取同一 Pinia 的交互状态。按钮动作交回菜单模块，媒体操作、焦点选择、搜索和设置返回规则继续由现有服务执行。搜索键盘和设置容器沿用当前渲染路径。关闭或切换面板只卸载 Vue，导航和播放状态继续保留；Pinia 由页面 runtime 的交互 scope 在业务模块清理后统一销毁。轻量 VM fixtures 的非响应式状态容器仅存在于测试适配脚本，不进入生产 bundle；真实 Pinia 的提交顺序、隔离和面板生命周期由 `tests/interaction-pinia.test.mjs` 验证。

`npm run check` 包含快捷菜单和 Pinia 的 Vue 类型检查。`tests/quick-menu-vue.test.mjs` 属于扩展回归，覆盖实际 Vue 面板、手柄选择与返回、重复开关后的焦点恢复，以及禁止 Trusted Types policy 的页面。

## 自定义浏览列表的 DOM 归属

`sites/youtube-browse.ts` 从 YouTube 原生卡片读取可序列化 `BrowseSnapshot`，保留原生卡片作为导航与 continuation 的来源；`app/browse-store.ts` 在页面级 Pinia 保存列表和稳定的 `activeItemId`。`BrowseGrid.vue` / `VideoCard.vue` 只管理扩展自己创建的 `#ytg-browse-grid`，不接管原生列表的子节点。该区域使用独立根节点和限定 CSS，以便现有 document 导航算法直接发现可聚焦卡片。

按照用户要求，浏览模式接管启动时立即隐藏原生卡片，数据未到时 Vue 显示加载态；原生节点仍保留布局，分页适配器通过原生续页节点继续加载。关闭扩展或离开浏览模式时移除隐藏标记并隐藏 Vue 区域。原生侧栏保留，网格根据其几何边界布置。分类 endpoint 可用时，Vue 分类栏替换原生分类显示，通过 MAIN 的固定 browse/search 请求适配读取视频和 continuation；首次加载与分页均由 API 提供，原生 DOM 数据仅作为无分类 endpoint 页面的兼容路径。选中分类、加载和错误状态保存在 Pinia；切换会清空旧列表、取消旧请求，并通过版本校验忽略过期结果。分类参数、会话上下文与认证只留在 MAIN，跨 world 返回规范化视频数据和不透明分页句柄。数据以视频身份去重，追加和重排不会改变焦点身份；移除选中卡片时选择仍存在的邻居。Vue 更新后通过 `nextTick()` 恢复焦点与局部滚动，导航算法仍在原模块中。

`tests/browse-model.test.mjs` 验证稳定身份、列表更新、分页与原生来源复用；`tests/browse-vue.test.mjs` 加载生产 bundle，验证真实 Vue 卡片、手柄方向输入、追加后的焦点恢复、接管时立即隐藏、迟到数据、原生分页以及退出后恢复。`tsconfig.browse.json` 提供这条链路的 Vue 类型检查。

## Popup 与 Options 页面

`src/entries/popup.ts` 和 `src/entries/options.ts` 各自创建 Vue 应用与 Pinia 容器。HTML 只保留挂载点、现有样式和本地 bundle 引用，页面关闭时卸载应用。`Popup.vue` 保留连接轮询和打开 YouTube 内嵌设置；`Options.vue` 保留分类 hash、旧深链接与键盘导航，组合 `BindingsPanel.vue`、`BindingRow.vue` 和 `DiagnosticsPanel.vue`。

两页共用 `src/shared/settings.ts` 的默认值、校验和旧版自动全屏迁移，以及 `src/settings/store.ts` 的加载、保存、错误反馈和跨页 storage 同步。按键仍使用已有 schema 与 storage 键，播放页和浏览页独立保存；诊断导出仍经过本地记录的边界限制与隐私过滤，清除操作经过后台消息鉴权。`usePageAppearance` 管理主题、手柄提示及其监听器和定时器生命周期。

构建继续通过 `scripts/build-extension.mjs` 生成独立 IIFE，发布目录保持 `src/popup/popup.html`、`src/settings/options.html` 和 `bundles/*.js`，无需远程脚本或运行时模板编译。`npm run check` 使用 TypeScript 7 检查现有端口，并通过兼容的 TypeScript 5.9 别名运行 vue-tsc 检查 SFC 和页面入口；Vue 类型检查工具暂不支持 TypeScript 7 的 tsc 目录布局。

## 播放快照、时间轴与音量

`playback/playback-model.ts` 接收现有播放接口的数据快照，提供只读展示状态、拖动预览和播放意图。`ui/PlaybackControls.vue` 复用既有播放外壳，组合 `playback/Timeline.vue` 与 `playback/VolumeControl.vue`；组件不查找 YouTube 播放器或原生视频节点。`ui/vue-watch-view.ts` 负责挂载及模型清理，业务侧 `watch.ts` 通过原有媒体请求和 seek 接口执行动作。

播放时间继续由业务层每 500ms 更新，以及操作后主动刷新。拖动期间模型显示预览位置，播放器快照更新不会拉回滑块；松开后仅提交一次 seek。直播时间轴使用现有 start、end 和 ranges，空档位置选择最近可跳转边界，移动窗口、不可跳转状态、路由切换、关闭控件和销毁均处理预览清理。异步 seek 的旧结果不能覆盖新路由预览。

自动隐藏、临时面板和手柄返回继续由既有状态机和业务层管理，组件不创建自动隐藏定时器。`tests/playback-model.test.mjs` 覆盖快照、拖动、直播范围和失败处理；`tests/playback-vue.test.mjs` 在真实浏览器验证展示、拖动、单次 seek、音量意图、Trusted Types 和原生视频节点身份保留。
