# 模块边界与接口

本项目使用 Manifest 中按顺序加载的原生 JavaScript 模块。`coordinator.js` 最后加载，负责组装接口和应用策略。`window.YTGamepad*` 是模块入口；界面通过 `connect(port)` 接收运行时依赖。

加载前置依赖声明在 `scripts/module-graph.mjs`，由清单检查和测试加载器共同使用。源码继续采用独立闭包和静态清单加载，保持 MAIN / ISOLATED 环境边界；协调层通过端口连接站点与界面实例。工厂模块只定义构造方法，菜单与播放模块拥有各自实例。

## 职责

| 模块 | 拥有的职责 | 依赖边界 |
| --- | --- | --- |
| `state-machine.js` | 纯状态转换、不可变交互状态、输入优先级和操作指令 | 不读取 DOM、时间、媒体或浏览器历史 |
| `gamepad.js` | 手柄采样、按键映射、重复与输入设备切换 | 发送抽象动作，不执行站点操作 |
| `navigation.js` | 分区和几何方向算法 | 接收测量结果，不读取站点 DOM |
| `core.js` | 页面候选项、原生弹窗范围、几何测量、焦点与选中框 | 执行注入的输入策略，不读取菜单、播放界面或站点模块的全局状态 |
| `focus.js` | 临时层恢复记录和焦点所有者注册 | 所有者自行解析目标并应用焦点 |
| `sites/youtube.js` | YouTube 选择器、数据读取、媒体操作、原生搜索/设置/导航和页面变化监听 | 原生 DOM 引用留在适配层；向播放界面提供数据快照和操作键 |
| `app/route-state.js` | 导航锁、历史链确认、取消和返回的纯状态规则 | 接收事件，输出状态和副作用描述，不读取浏览器历史 |
| `app/route-controller.js` | 历史包装、路由监听、合法视频地址检查、执行返回指令 | 通过注入端口读取路由并调用浏览器和协调层 |
| `coordinator.js` | 模式、适配能力、设置同步、输入所有者、模块连接 | 注入核心与界面端口；路由由 route-controller 执行 |
| `watch.js` | 播放控件交互、推荐刷新和焦点、进度观察 | 只读取注入的数据端口，不查询 YouTube DOM |
| `ui/watch-view.js` | 观看浮层的安全 DOM 构造、控件和图标 | 收到激活与关闭回调，不决定输入策略 |
| `ui/watch-panels.js` | 说明和评论面板渲染、评论快照缓存和加载请求 | 使用注入的数据、状态和焦点端口 |
| `menu.js` | 菜单宿主、打开关闭、焦点与搜索入口 | 创建搜索实例，并注入宿主和操作端口 |
| `search.js` | 光标编辑、拼音候选、语言和键盘渲染、历史和提交 | 不查询站点搜索框；经端口同步和提交 |
| `ui/menu.css` / `ui/watch.css` | Shadow DOM 界面样式的维护源文件 | 生成 ui/styles.js，使用 textContent 同步应用 |
| `runtime.js` | 模块实例的监听器、定时任务、观察器和清理回调 | MAIN 与 ISOLATED 各自拥有独立资源注册表 |

会影响交互的状态统一保存在 `YTGamepadInteraction.state` 的 `app`、`watch` 和 `menu` 中。播放模式、导航锁和返回链、播放区域及选择索引、面板、搜索入口、语言选择、拼音组合和键盘布局，都通过 `transition(state, event)` 更新。界面保留 DOM、数据快照、几何测量、菜单按钮的实际焦点索引和文本光标；焦点层的 DOM 恢复记录继续由 `focus.js` 管理。

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

`sites/youtube.js.inspectWatchCapabilities()` 检查原生播放器、属于该播放器的视频及播放/设置按钮。读取失败返回失败观察，不把异常传播到界面。可选数据和直播时长不作为接管前提。

协调层通过状态机的 `ADAPTATION` 事件记录路由、`inactive / waiting / ready / fallback` 状态和原因。应用模式保留用户意图；对界面和导航暴露的有效模式只有能力就绪时才允许播放/控制栏模式。打开视频的导航锁和返回链仍由原状态机管理，验证前不提前应用播放布局。

每 500 毫秒及页面变化时检查关键能力。初始加载最多等待 5 秒；等待期间保留原生界面，已接管后能力失效立即降级。降级状态在当前路由保持稳定，用户点击“重试适配”或进入新路由时重新检查。

恢复先设置 `data-ytg-native` 样式安全开关，再关闭临时界面、撤销接管类并隐藏播放浮层。所有接管播放器布局和隐藏控制栏的样式均受该开关约束，即使界面渲染部分失败也不会继续遮蔽原生控件。读取数据或渲染异常使用同一恢复路径。降级不改变媒体播放状态或后台管理的窗口全屏。

运行 `node scripts/check.mjs` 和 `node --test tests/*.test.mjs`。边界测试覆盖：禁止播放界面访问原生 DOM时仍能渲染和操作、禁止核心读取具体模块时仍能分发、数据快照与原生节点隔离、失效推荐和旧视频数据处理。另有输入、搜索、焦点、原生设置、返回链和后台全屏回归。

自动测试使用模拟 DOM 和扩展 API。真实 YouTube 页面、浏览器扩展执行环境以及实体手柄仍需要验收。

## 状态机执行约定

`state-machine.js` 在核心和界面之前加载。`transition(state, event)` 返回 `{ nextState, effects, disposition }`；相同输入得到相同输出，旧状态不会被修改。`createStore()` 提交并冻结新状态，随后调用方执行操作指令。状态对象可序列化；DOM 引用和函数不进入状态。

- `INPUT_OWNER`：根据启用、导航锁和当前层的观察值选择唯一输入归属。核心只执行分发结果。
- `BASE_INPUT`、`WATCH_INPUT`、`MENU_INPUT`：决定基础播放、播放区域和菜单的动作、阻止或放行结果。
- `WATCH_SHOW/FOCUS/PANEL/RESET`：处理界面展开、实际焦点观察、面板开关和路由重置。
- `MENU_SEARCH/BACK/COMPOSE/SET_LANGUAGE/FRAME`：处理搜索来源、逐层返回、组合输入、语言和键盘布局。
- `PREPARE_VIDEO/NAV_START/HISTORY/NAV_FINISH/NAV_CANCEL/POPSTATE/PAGE_BACK`：计算导航锁与可验证的返回链。
- `AUTO_HIDE`：只使用传入的空闲时长、播放和临时层观察值，不读取时钟。

`coordinator.js` 执行媒体和模式指令，`app/route-controller.js` 执行历史和返回指令，`watch.js` 与 `menu.js` 执行渲染和焦点指令。执行副作用前必须先提交状态，例如页面返回先设置导航锁，再调用浏览器历史。界面事件不能直接给状态字段赋值。新增交互应先添加纯转换规则和序列测试，再添加指令执行代码。

路由和返回事件由 `state-machine.js` 委托给 `app/route-state.js`，仍通过同一个 store 提交；没有新增第二份导航状态。浏览器历史操作由 `app/route-controller.js` 执行。

## 生命周期与发布

长期监听通过 `runtime.scope(name).listen()` 注册，定时器、动画帧和观察器也由 scope 管理。已完成任务会释放资源；销毁会取消任务，并阻止已排队回调继续产生操作。同名 scope 替换旧实例前先清理。短生命周期按钮监听绑定在其 DOM 节点上，移除宿主后由浏览器回收，避免资源表保留每一次渲染的旧节点。

- 关闭界面：隐藏宿主并恢复外部焦点，保留实例供下次打开。
- 禁用功能：沿用 ENABLE 状态转换，恢复原生界面，保留接收设置和再次启用的能力。
- 销毁实例：调用模块的 destroy()，移除宿主、释放焦点所有者、原生节点缓存与后台任务。
- 销毁整个页面实例：MAIN 中调用 YTGamepadRuntime.destroy()。路由包装只在仍是当前包装函数时恢复；站点后续安装的包装保留，旧包装变为无状态副作用的透传函数。非 bfcache 的 pagehide 自动销毁；bfcache 保留实例。

修改 Shadow 样式后运行 `npm run styles`；生成的 `ui/styles.js` 随源码提交，源码文件夹仍能直接加载。`npm run check` 校验加载依赖、重复资源、语法和样式生成一致性。`npm test` 运行纯规则和模拟环境回归；`npm run test:browser` 必须找到 Playwright 并成功启动浏览器，不能以跳过代替验证。

`npm run build` 按清单、弹窗资源和许可证白名单生成独立发布目录，旁置 SHA-256 文件清单；`npm run check:release` 核对文件完整性，拒绝多余文件、遗漏、路径越界、符号链接和文件变化。测试、抓取资料、调试日志、依赖与开发脚本不会被打包。`YTG_EXTENSION_ROOT=latest-release` 可让浏览器集成测试直接读取最新发布包。

CI 从锁文件安装开发依赖，运行完整回归、生成发布包、核对完整性，再对发布包重复浏览器验证。浏览器测试使用本地构造的 YouTube 页面和全部 MAIN 脚本，验证实际 DOM、焦点、观察器、销毁和重新注入；线上 YouTube、扩展权限环境与实体手柄仍需要人工验收。

可通过 `YTGamepadCoordinator.interactionState` 读取完整不可变快照。排查问题时可将快照和事件传给 `YTGamepadStateMachine.transition()` 重放，不需要 YouTube 页面。`tests/state-machine.test.mjs` 在没有 DOM、历史和时钟的环境下验证纯转换，并覆盖多层返回、输入优先级、自动隐藏和重复导航。
