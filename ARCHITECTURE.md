# 模块边界与接口

通用导航为当前页面和原生弹层维护候选引用、区域/顺序/重复项身份和位置索引，方向输入复用稳定索引，不逐键查询候选 DOM 或重新测量所有按钮。显隐、禁用、内容、样式、路由、窗口/全屏尺寸和字体变化使相关索引失效；滚动只使位置失效，不重新发现候选。按键处理前消费尚未送达回调的 MutationObserver 记录，避免选中同一轮中刚隐藏、禁用或移除的元素。焦点装饰 class 不使索引失效，焦点框仍读取当前目标的最新位置。主动刷新与销毁释放缓存；原生菜单切页会重建候选及页面身份，返回时保留原有焦点恢复行为。

`ui/ui-api.ts` 是 ISOLATED 内的本地界面控制接口，提供 setTheme、setLayout、focus、openPanel、closePanel 与只读快照。接口通过可注销的 owner port 连接现有状态，不复制 Pinia、账号弹层或播放面板状态。设置写入按类型串行，保存失败、owner 更换或销毁后不返回成功；content.ts 负责设置存储及主题 DOM 适配。BrowseHeader、menu 和 watch-surface 分别注册账号、设置/搜索及播放面板，默认关闭遵循临时层优先级。浏览表面注册语义焦点入口，将查找、可见性检查和焦点操作留在适配层；界面卸载注销入口，应用销毁使接口失效。MAIN 和页面消息均不能调用这些接口。

`ui/browse-surface.ts` 分别处理显示状态、数据初始化、列表发布、布局测量和返回恢复。页面 class 通知仅比较接管与页头显隐状态；无关 class 变化不初始化数据、不测量布局、不恢复焦点。进入浏览模式或完成路由导航时初始化数据，会话配置迟到使用独立的有界重试。列表响应直接发布快照；仅快照变化或重新接管后刷新导航与恢复位置。窗口/页头尺寸、分类栏出现与布局设置变化在动画帧内合并测量，不调用数据初始化或焦点恢复。离开页面和导航开始会使待执行的恢复失效，销毁会释放重试、布局任务和 Vue 监听。

`sites/youtube-account.ts` 通过页面登录会话发送只读 `account/accounts_list` 请求，使用 YouTube.js `account.getInfo(true)` 解析头像、名称、频道标识及账号列表。MAIN 仅缓存有界展示字段，不向 Vue 返回身份切换命令、Cookie 或私有 token；账号选择变化或退出登录使缓存失效，重复请求共用正在进行的加载。BrowseHeader 与 AccountPage 通过异步 pageAccess 读取快照，已移除原生头像读取、账号菜单扫描、MutationObserver 和模拟点击。账号页提供官方登录、Google 账号管理、YouTube 账号切换及设置页面入口；本阶段不直接执行身份切换。

频道页对一次 API 响应只执行一次 YouTube.js 页面解析：库的 Tab 注册适配保留所有频道标签的元数据和 endpoint，仅解析选中标签的 content；卡片、分页、标签及排序复用同一份解析结果，新版筛选使用 `Channel(..., already_parsed=true)`。频道首屏及标签使用 getChannel，地址使用 resolveURL；续页从已保存 token 重建 ChannelListContinuation，使用当前请求的 Session 调用 getContinuation。排序部分响应经公开 call API 解析。正常频道响应不再先运行旧卡片解析器，也不再重建仅含选中标签的第二个 Channel。已删除原始 JSON 卡片及分页回退；分类读取异常不丢弃已解析卡片。

`sites/youtube-watch-info.ts` 使用当前页面会话适配 YouTube.js 的视频详情、评价及订阅接口。点赞状态直接使用 VideoInfo，收藏列表直接读取 contents/actions 的 PlaylistAddToOption 解析节点；已删除两处原始 JSON 递归扫描。库 Menu 节点注册适配补齐旧版点赞按钮的解析白名单，按钮由库解析一次。MAIN 缓存当前路由的元数据与可操作状态，播放列表选择接口返回已有列表；列表的增删 endpoint 和私有参数仅留在 MAIN，Vue 只得到有界文本、选中状态和临时句柄。账号写入串行执行、超时取消且不自动重试，确认成功才更新状态；切换路由取消请求并丢弃陈旧响应。`page-client.ts` 对异步操作关联请求 ID，应用销毁会解除监听及计时器。收藏使用现有 Vue 面板和焦点状态机选择列表；视频播放、字幕、设置与布局继续操作原生播放器。

`sites/youtube-comments.ts` 在 MAIN world 创建不含 Cookie 的 YouTube.js Session，仅允许库发起 `/youtubei/v1/next` continuation 请求；实际发送由页面会话适配完成，保留账号和品牌频道选择。`Innertube.getComments`、`Comments.getContinuation` 及线程回复接口解析评论及 entity mutations。评论和回复分别去重并保存续页游标；失败保留内容及游标；单请求锁、20 秒超时及路由检查阻止重复和陈旧响应。切换视频及销毁取消请求并释放库对象。桥接只返回有界文本快照及 loading/failed/hasMore 状态，不返回 Cookie、库对象或续页 token。ISOLATED 站点只通过 pageAccess 对接现有 Vue 评论面板；已移除原生评论节点扫描、滚动预加载、点击展开回复及对应遮罩样式。缺少 pageAccess 时返回空列表和不可执行状态。每视频最多 100 条评论、每线程最多 100 条回复、展示快照共用 200 条回复预算；连续两页没有新增评论时停止续页。

`sites/youtube-channel.ts` 在 MAIN 中使用 YouTube.js 的 NavigationEndpoint/Channel 解析频道地址解析响应、标签、SortFilterSubMenu 以及新版 chip/dropdown 筛选。只向现有 feed 服务返回经限制的 browse 参数，Vue 只获得分类 ID、显示文本和卡片。频道列表先收窄到 selected tab，再由共用 browse 解析器处理，避免隐藏标签污染视频和续页 token。频道标签与排序控件按路由缓存；排序响应没有完整频道标签时保留已有控件，换标签清除上一标签的排序上下文。正常切换频道分类重新请求以同步控件与参数，SPA 返回继续使用现有列表/分页/焦点恢复。Session 仅为解析协作者，不持有 Cookie，不初始化播放器，不执行网络调用。

`sites/youtube-parser.ts` 通过 YouTube.js 对每个列表响应解析一次，统一读取解析后的内容容器、NavigationEndpoint、ContinuationItem/ContinuationItemView 及 continuation 对象，排除广告、隐藏标签和 header reload 分页。针对固定版本的少数可选字段，在库节点注册入口补默认值，不修改原始缓存响应。`sites/youtube-search.ts` 将解析节点转换为共用卡片，覆盖首页、搜索、订阅、历史、播放列表和频道；扩展只保留目标校验、展示字段、顺序和队列身份等自身规则。

`sites/youtube-next.ts` 从共用解析结果中限定推荐和队列分支，复用卡片转换及分页对象读取，按尺寸选择 HTTPS 缩略图，保留时长、播放列表序号、Mix 参数、选中状态及重复视频的独立队列键。旧的单卡解析包装和原始 JSON 遍历已删除。会话、取消、重试、返回缓存和播放器控制继续由现有服务维护。

`sites/youtube-search.ts` 只负责调用共用 YouTube.js 页面解析及展示字段转换，不创建 Session、不发送请求、不持有页面上下文。搜索与其他列表共用 feed 服务的 send 入口，正常流程直接读取库节点；旧的 parseFeed 别名及接受原始 endpoint 的 feedEndpoint 包装已删除。认证、账号选择、超时、取消及路由检查集中留在 feed 服务。分类、分页参数由已校验的 endpoint 提供，无额外请求包装层。

源码使用 `import/export` 声明依赖。`src/entries/` 提供 早期启动、MAIN、ISOLATED、后台、Popup 和 Options 六个入口，由 `scripts/build-extension.mjs` 使用 Vite 分别构建为自包含 IIFE。Manifest 只声明入口产物：early 与 MAIN 在 document_start 启动，ISOLATED 应用在 document_idle 启动。MAIN 保留原生播放器控件接口、API 数据与账号操作适配和页面 history 通知；Vue、Pinia、手柄输入、协调器、DOM 站点适配和扩展服务均在 ISOLATED。`coordinator.ts` 通过命名导入取得工厂并组装接口，界面通过 `connect(port)` 接收操作和数据端口。生产代码不发布 `window.YTGamepad*` 对象。

生产依赖由 Vite 根据源码导入解析；`scripts/module-graph.mjs` 仅供旧 VM / DOM 测试兼容加载。核心、站点、菜单、播放、输入和浏览模块导出工厂；协调层显式传入 runtime、状态 store、焦点管理、样式、键盘和拼音等协作者，并创建实例。搜索、播放视图和面板的工厂由协调层作为回调注入其宿主，宿主仍拥有子实例的生命周期。

功能模块使用注入的协作者或命名导入；输入和浏览模块使用 `isSearchOpen()`、`isMenuOpen()` 获取必要观察值。实例保存在所属模块的导出绑定中。MAIN 适配器与 ISOLATED 应用各自保留一个 Symbol 生命周期清理句柄，重新注入时销毁旧实例；句柄不暴露业务对象，也不参与模块依赖解析。

业务源码已全部迁移到 TypeScript，Vue 组件使用 `<script setup lang="ts">`。`types/ports.d.ts`、`types/core.ts`、`types/actions.ts` 和 `types/events.d.ts` 定义模块工厂、数据快照、DOM 与播放器边界、动作参数及事件载荷；生产模块通过 `import type` 引入这些契约。快照只读且不包含原生 DOM 或媒体节点；搜索目标与焦点句柄留在操作端口。`npm run check` 对全部 TypeScript 源码和 Vue 组件执行严格类型检查，并检查 `tests/types/ports.ts` 中合法与应被拒绝的调用。`allowJs: false` 与源码检查共同防止业务 JavaScript 回流；构建输出仍是浏览器运行所需的 JavaScript。

小型 VM 和历史 DOM 回归由 `scripts/test-source.mjs` 兼容加载。`tests/bundled-runtime.test.mjs` 直接加载生产产物，在两个独立 JavaScript world 中验证通信、Vue 设置挂载、禁用恢复和重新注入；仅替换 Chrome 权限 API 和手柄采样。扩展 E2E 测试加载实际 `dist/` 或发布包，验证真实扩展权限环境。

## 跨环境通信

`src/bridge/page-server.ts` 在 MAIN 提供固定播放器操作：读取 API 元数据缓存、显示原生控件、隐藏原生控件，以及不依赖播放器存在的 `ping` 握手。播放页的 `readWatchNext` 同步返回缓存并异步启动 InnerTube 请求，`moreWatchNext` 请求后续页。`page-client.ts` 使用同步 DOM CustomEvent 和 JSON 字符串跨 world 请求/响应，以保留同步 SitePort；请求具有版本、操作白名单、关联 ID、长度限制和运行时校验。缺少服务端时立即返回不可用，适配检查会恢复原生界面。页面输出始终视为不可信数据，MAIN 不接收扩展 API 操作。

`sites/youtube-next.ts` 负责 `/youtubei/v1/next` 的会话认证、相关推荐和播放列表队列解析。只解析相关推荐列、播放列表及对应的 continuation 响应，跳过广告分支；队列与推荐分别管理分页 token 和最多 120 条记录。队列条目保留播放列表、序号及 Mix 参数，重复视频的不同队列位置具有独立身份。切路由取消请求并丢弃旧结果，最多缓存 10 个路由、有效期两分钟；失败保留已有数据，五秒后允许重试同一请求。认证信息及分页 token 不跨 world，客户端校验目标地址与展示字段。Vue 在推荐行前部展示未选中的队列条目并标注播放列表，点击通过统一原生导航或整页导航执行；播放器控制和播放结束后的原生连续播放保持原实现。播放页已移除原生推荐卡片扫描、来源节点映射和滚动原生续页节点的兼容路径。请求完成或失败后通过不携带数据的固定事件通知 ISOLATED 刷新缓存快照，旧路由响应不发通知；界面更新不依赖原生 DOM 变化。

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

导航核心的窗口和 Shadow DOM 滚动监听只更新已保存的页面坐标及列表 scrollTop，不重新扫描候选项或采集布局。滚动共用一帧一次的调度，只刷新选中目标的焦点框；内容变化、窗口变化及显式刷新才执行焦点恢复。已排队的滚动绘制可升级为恢复，避免漏掉同帧删除焦点目标的 DOM 变化。选中项、同区域顺序和分类仍在选中或导航等时机保存，返回期间及导航锁内的滚动不会覆盖原有记录。专项测试覆盖千张卡片下的原生窗口和 Shadow DOM 滚动、焦点框对齐、路由返回及同帧内容变化；测量次数验证不等于线上帧率保证。

会影响交互的状态统一保存在页面级 Pinia `useInteractionStore().state` 的 `app`、`watch` 和 `menu` 中。播放模式、导航锁和返回链、播放区域及选择索引、面板、搜索入口、语言选择、拼音组合和键盘布局，都通过 `transition(state, event)` 更新。界面保留 DOM、数据快照、几何测量、菜单按钮的实际焦点索引和文本光标；焦点层的 DOM 恢复记录继续由 `focus.ts` 管理。

## 数据与原生操作

浏览页由 `ui/BrowsePage.vue` 组合侧栏、`BrowseCategoryTabs.vue` 和 `BrowseGrid.vue`。分类栏只接收分类数据并发出切换意图；网格保留布局测量、卡片注册、焦点同步和滚动加载入口，加载、空列表及错误提示由 `FeedStatus.vue` 展示。组件拆分保留现有 DOM 标识与滚动容器，供手柄导航及返回恢复继续使用。

`app/browse-feed-controller.ts` 管理分类请求、分页去重、旧请求失效及有界的路由/分类缓存，通过注入端口连接 feed client、store 和界面更新。`BrowseGrid.vue` 在扩展滚动容器内观察底部标记，距底部 400px 时通过 feed controller 请求下一页；首屏不足会继续填充。加载中、错误、后台或隐藏界面不自动请求，连续两页无新增视频后停止自动加载，仍可手动继续。`ui/browse-surface.ts` 负责挂载、设置同步、原生页面观察、布局与焦点端口；feed controller 不直接读取 DOM。跨路由切换或界面关闭后，旧请求的成功和失败、延迟初始化及焦点回调均不能作用于旧页面。销毁时取消请求、清除缓存；Vue 卸载时断开底部观察器。

播放端口由协调层注入，适配层实现以下读取接口：

- `readRoute()`：当前路由键和是否为视频页。
- `readWatchPage()`：标题、频道及头像、订阅/点赞/点踩状态、观看数、说明、推荐及等待状态。推荐仅包含 `key`、文字和图片地址。
- `readPlayback()`：时间、时长、暂停/结束状态、字幕与原生设置状态。视频状态是数据副本。
- `readComments()`：评论键、文字和回复信息；不暴露原生评论节点。

界面通过 `openRecommendation(key)`、`openChannel()`、`openSettings()`、`backSettings()`、`expandReplies(key)`、`loadComments()`、`seekTo(time)` 和 `perform(action)` 请求操作。协调层组合导航前的模式切换、返回链记录和焦点刷新。适配层检查原生元素是否仍可用；推荐激活还会重新核对目标地址。

订阅、点赞、点踩和保存经 `request('watchAction', action)` 调用适配层的 `performWatchAction(action)`，共用协调层的禁用和导航锁。保存优先点击原生保存按钮；按钮被折叠时查找原生更多菜单中的保存项，等待期间校验路由，并在两秒后停止。账号提示、订阅管理和播放列表选择由原生弹窗负责，输入仍由核心的原生弹窗层处理。

搜索使用 `readSearch`、`syncSearch`、`moveSearchCursor`、`submitSearch` 和 `readTheme`。搜索入口传入的元素仅作为适配操作的句柄，菜单不读取或修改该元素。`submitSearch` 校验非空且最长 256 字符的查询，保存历史并关闭菜单后，通过固定 search endpoint 路由进入结果页；原生路由不可用时导航到同源结果地址。搜索栏只读写扩展自己的输入框，结果仍由现有 API feed 服务加载，不依赖原生搜索框或提交按钮。

`observePage(onChange)` 由适配层监听页面变化，协调层请求播放界面刷新。播放界面保留自己的进度刷新和空闲时间计时，自动隐藏是否允许由协调层决定。

## 动作归属

连续摇杆滚动经输入层的 `scroll(delta)` 端口进入协调层，按菜单、原生弹窗、观看界面、普通页面的顺序选择唯一所有者。各界面在自己的 DOM 范围内解析滚动容器；`navigation/stick-scroll.ts` 仅沿焦点祖先和指定的默认容器查找，不扫描卡片，也不改变选中项。滚到内层边缘不向背景传递，松杆和生命周期中断恢复临时禁用的滚动吸附。右手预设交换导航与滚动摇杆，输入设备和导航锁仍由协调层管理。

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

播放页只由协调器持有一个 500ms 周期任务，同时请求能力检查、播放快照刷新与空闲隐藏判断。三者进入同一个动画帧，与 API/媒体通知合并；播放视图不创建周期定时器。未就绪时只检查能力，刚恢复就绪时复用首次渲染；后台、停用、离开播放页及销毁时释放周期任务，待导航和回到前台时按需恢复。空闲判断在播放刷新后执行，临时弹层和导航期间重置空闲时间。

播放页的 API 通知、页面观察、媒体事件、账号操作完成通知及周期能力检查统一由协调层合并到动画帧。同帧只执行一次能力检查和至多一次页面刷新；从等待变为就绪时，`renderMode → watch.sync` 已完成刷新，不再重复调用 `watch.refresh`。仅检查播放器能力的事件不刷新页面数据，旧路由、停用和销毁后的任务不得更新界面。

`sites/youtube-watch-data.ts` 由 MAIN 页面服务持有，供详情和推荐共享当前路由的首屏 `next` 请求及成功响应，只解码一次 JSON。请求按路由、页面 context 和账号选择隔离；包含播放列表、序号及 Mix 参数，直接 Shorts 地址使用对应视频 ID。消费者取消只结束自己的等待，路由切换、账号上下文变化或销毁才取消底层请求；失败响应不缓存。推荐与队列续页、评论续页和账号写入各自请求，不进入首屏共享缓存。

导航核心的滚动监听仅更新已有记忆中的页面坐标和浏览列表滚动位置，不扫描候选元素、不重新保存分类或焦点顺序。完整焦点状态在选中项变化及导航离开等必要时机保存。连续滚动只在每帧合并更新选中目标的焦点框；同帧出现 DOM 或尺寸变化时升级为焦点修复，不能因已有滚动任务而漏掉修复。window 和扩展 Shadow Root 的滚动监听使用 passive 捕获。

### 自动降级

自建列表不论是否启用虚拟渲染，都由 `BrowseGrid.vue` 使用 `indexFeedRows` 的卡片 ID → 行列索引决定相邻项。索引只在数据或列数改变时重建；连续输入基于待提交 ID 前进，经过短行保留目标列。列表右边和底部保持当前位置，顶部和左侧边界继续使用跨区域导航。`data-ytg-indexed-feed` 标记下的选择跳过导航核心的整表测量及行焦点计算，滚动只测量目标卡片（Shorts 为整条 shelf）和视口；焦点记忆保存当前 ID，Vue 数据层负责删除项后的邻居选择。分类、路由或列数改变会取消过期移动。浏览器回归同时覆盖 60 条和 400 条列表的测量数量、连续输入、虚拟窗口、侧栏往返与返回恢复。

`sites/youtube.ts.inspectWatchCapabilities()` 检查原生播放器及属于该播放器的视频播放能力。读取失败返回失败观察，不把异常传播到界面。可选数据和直播时长不作为接管前提。`inspectOptionalCapabilities()` 分别观察推荐、评论、频道、字幕、设置及社交操作；`readWatchFeatures()` 返回可用、缺失或失败状态。可选端口隔离同步异常和异步拒绝，推荐失败清空其来源映射，评论失败清空回复映射并显示局部提示，后续检查允许恢复。

协调层通过状态机的 `ADAPTATION` 事件记录路由、`inactive / waiting / ready / fallback` 状态和原因。应用模式保留用户意图；对界面和导航暴露的有效模式只有能力就绪时才允许播放/控制栏模式。打开视频的导航锁和返回链仍由原状态机管理；视频框在准备阶段应用选定布局，加载完成只开放控制功能，不改变视频框尺寸。

播放布局仅有 `fullscreen / windowed`，两者共用 `WatchModule` 和自定义播放控件。协调层根据保存的布局和当前输入方式设置 `data-ytg-playback-layout`；手柄使用保存值，鼠标与键盘使用非全屏界面且不覆盖保存值。全屏使用视频浮层和多列推荐，非全屏使用左侧视频与信息、右侧推荐与评论。旧 `normal / wide` 迁移为 `windowed`，旧 `page` 迁移为 `fullscreen`；兼容转换集中在 `shared/playback-layout.ts`，已移除原生影院模式布局切换。

仅在启用且可见的播放页或等待视频跳转期间，每 500 毫秒检查关键能力；浏览页、后台标签和禁用时销毁健康检查定时器，恢复可见时立即重检。播放页保留元数据、评论、原生菜单和播放器变化观察，离开播放页断开；原生推荐区变化不触发数据或导航刷新。手柄确认视频时立即用独立电视加载画面覆盖页面，导航完成前不使用旧播放器判断新视频已就绪。初始加载最多等待 5 秒；等待期间原生播放器保留在加载画面下方，能力就绪后直接显示电视播放界面。导航取消、关闭手柄操作或适配失败时清除加载画面；已接管后能力失效立即降级。降级状态在当前路由保持稳定，用户点击“重试适配”或进入新路由时重新检查。

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

`shared/browse-data.ts` 定义 InnerTube、通信桥与界面共用的列表类型；原生列表适配器及其快照、点击导航回退已删除。首页、搜索、订阅、历史、频道、播放列表和探索页直接使用 InnerTube 数据，不扫描原生卡片；`app/browse-store.ts` 在页面级 Pinia 保存列表和稳定的 `activeItemId`。`BrowseGrid.vue` / `VideoCard.vue` 只管理扩展自己创建的 `#ytg-browse-grid`，不接管原生列表的子节点。该区域使用独立根节点和限定 CSS，以便现有 document 导航算法直接发现可聚焦卡片。

浏览模式接管启动时立即隐藏原生卡片，数据未到时 Vue 显示加载态。API 路由的首次加载、分类和分页由 MAIN 的 InnerTube browse/search 服务提供，不读取页面 `ytInitialData`，首屏直接请求 API；会话配置迟到时仅在可见且尚未初始化时重试。界面自己管理侧栏、分类、列表和焦点，导航直接使用已校验的 API 目标。未接入 InnerTube 的路由显示空列表，不读取原生卡片、原生分类或页面组件数据。关闭扩展或离开浏览模式时恢复原生呈现。选中分类、加载及错误保存在 Pinia；切换会取消旧请求，通过版本校验忽略过期结果。会话上下文、认证及 continuation 留在 MAIN，跨 world 只返回规范化数据和不透明分页句柄。数据按条目身份去重，Vue 更新后通过 nextTick 恢复焦点与局部滚动。

已删除原生分类点击后的列表签名扫描、临时分类观察器和相关定时器。API 浏览页只观察页面模式属性，分类偏好只观察扩展的分类节点；原生列表的子节点、文字和缩略图变化不再触发浏览布局同步。标题布局由 ResizeObserver 更新，分页、分类及焦点由控制器与 Vue 更新链驱动。原生悬停预览通过输入切换和 play 事件抑制，已移除全页预览插入观察器。`ui/ExplorePage.vue` 是独立且可复用的探索频道页，音乐、电影、直播、游戏、新闻和体育由 `shared/explore-pages.ts` 配置标题、简介、目标路由与 browseId。`BrowsePage.vue` 按当前路由选择探索页或普通列表；探索页复用 `BrowseGrid.vue` 的卡片、分页、加载、错误重试与焦点逻辑，标题作为同一滚动容器的首个吸附位置。侧栏通过 guide API 读取地区入口，接口不可用时使用内置频道目的地。请求、缓存和 continuation 按路由隔离；返回时恢复原频道已加载的列表。

`tests/browse-model.test.mjs` 验证稳定身份、列表更新、分页与原生来源复用；`tests/browse-vue.test.mjs` 加载生产 bundle，验证真实 Vue 卡片、手柄方向输入、追加后的焦点恢复、接管时立即隐藏、迟到会话配置、接口分页锁、失败原页重试、空结果保护及退出后恢复。`tsconfig.browse.json` 提供这条链路的 Vue 类型检查。

### 首页和搜索的 InnerTube 数据链路

首页 `/` 与搜索 `/results` 的首屏、分类和分页不读取原生卡片、分类节点或 `ytd-page-manager.data`。会话配置就绪后通过固定的 `browse` / `search` endpoint 启动；搜索保留 URL 中的查询和 `sp` 参数。首屏、刷新和分类均通过 API 响应提供，不读取页面 `ytInitialData`。分类 endpoint 来自 JSON 响应，按路由缓存；搜索响应也可以更新分类栏。分页继续使用固定接口与不透明 continuation 句柄。

会话配置未就绪时，自定义列表保持加载态，不回退扫描隐藏的原生卡片。打开 API 视频使用导航桥接，不查找原生卡片链接。列表观察器只监听页面模式属性，不订阅原生列表子树变化；原生分类点击也不触发卡片签名扫描。返回列表沿用分类、已加载分页、焦点与滚动位置恢复机制。`tests/youtube-feed.test.mjs` 使用禁止原生 DOM 访问的适配环境验证首屏、分类与分页；`tests/browse-vue.test.mjs` 验证迟到会话、原生卡片不回退、接口分类、分页重试和返回恢复。

## Popup 与 Options 页面

长列表由 `shared/virtual-feed.ts` 按当前列数分行，普通卡片超过 120 条或 Shorts 超过 60 条后启用窗口渲染。`BrowseGrid.vue` 只挂载可视区前后各一屏的行及选中行，以占位空间保持列表高度；Shorts 横向列表单独窗口化。行高度由有限的已挂载行测量，宽度由 ResizeObserver 更新，不在每次焦点移动时读取布局。原生 scroll snap 在窗口模式关闭，避免滚动被不存在的卡片吸附位置限制。方向输入先按完整数据定位逻辑邻居，保留来源和目标直到 Vue 挂载完成，再交回导航核心设置焦点和滚动；旧路由、分类及失去输入所有权时不交接焦点。返回恢复先更新布局和挂载窗口，再恢复滚动与卡片焦点，完整已加载数据和 continuation 仍由浏览控制器缓存。图片保留 `loading="lazy"` 并使用异步解码，底部 400px 预取、单请求分页锁、请求取消和过期响应隔离继续由原控制链负责。

侧栏由 `sites/youtube-sidebar.ts` 在 MAIN 中通过 YouTube.js `getGuide()` 读取 `/youtubei/v1/guide`。服务解析普通及折叠目录节点，跳过订阅频道区域，按安全目标和图标识别个人入口与探索分类，不依赖标题语言。会话 context、Cookie、账号索引及品牌频道选择留在 MAIN；桥接仅返回有界文本、固定图标和校验后的 YouTube／Studio 地址。请求去重并缓存一分钟，身份变化清除缓存、取消旧请求，销毁释放资源。Vue 在挂载、页面事件及窗口恢复焦点时读取，忽略陈旧响应；接口失败保留内置入口，后续读取可恢复。侧栏导航通过既有路由桥接或普通链接，不读取、监听或点击原生 guide。账号资料由独立的 account API 服务提供。顶部首页入口使用已有固定路由桥接，已移除 `sites/native-shell.ts`。Shorts 标题和作者仅由当前路由的 API 详情快照提供，缺失时显示通用占位，不回退页面文字或 document.title。

订阅、历史记录、频道（包括 handle、channel、c、user 地址及栏目路径）和有效的 `/playlist?list=...` 统一接入浏览控制器的 InnerTube 列表生命周期。订阅请求 `FEsubscriptions`，播放列表请求 `VL` 加列表 ID；频道通过 `navigation/resolve_url` 获取 browse endpoint 和不透明栏目参数，再请求 `browse`。这些页面的首屏、分类和分页均通过 API 获取，不读取页面启动数据、原生卡片或分类 DOM；频道首屏只解析选中栏目的内容。首屏、continuation、请求取消、过期响应隔离、返回缓存和焦点恢复沿用现有控制器，界面仅监听自己的列表和根节点模式变化。未支持或无效地址不启动列表请求，不回退原生适配器。

`src/entries/popup.ts` 和 `src/entries/options.ts` 各自创建 Vue 应用与 Pinia 容器。HTML 只保留挂载点、现有样式和本地 bundle 引用，页面关闭时卸载应用。`Popup.vue` 保留连接轮询和打开 YouTube 内嵌设置；`Options.vue` 保留分类 hash、旧深链接与键盘导航，组合 `BindingsPanel.vue`、`BindingRow.vue` 和 `DiagnosticsPanel.vue`。

两页共用 `src/shared/settings.ts` 的默认值、校验和旧版自动全屏迁移，以及 `src/settings/store.ts` 的加载、保存、错误反馈和跨页 storage 同步。按键仍使用已有 schema 与 storage 键，播放页和浏览页独立保存；诊断导出仍经过本地记录的边界限制与隐私过滤，清除操作经过后台消息鉴权。`usePageAppearance` 管理主题、手柄提示及其监听器和定时器生命周期。

构建继续通过 `scripts/build-extension.mjs` 生成独立 IIFE，发布目录保持 `src/popup/popup.html`、`src/settings/options.html` 和 `bundles/*.js`，无需远程脚本或运行时模板编译。`npm run check` 使用 TypeScript 7 检查现有端口，并通过兼容的 TypeScript 5.9 别名运行 vue-tsc 检查 SFC 和页面入口；Vue 类型检查工具暂不支持 TypeScript 7 的 tsc 目录布局。

## 播放快照、时间轴与音量

`playback/playback-model.ts` 接收现有播放接口的数据快照，提供只读展示状态、拖动预览和播放意图。`ui/vue-watch-view.ts` 在既有播放外壳内分别挂载 `Timeline.vue`、`PlaybackMetadata.vue`、`PlaybackControls.vue`、`PlaybackRecommendations.vue` 和 `PlaybackHints.vue`。时间更新只刷新进度；暂停、字幕、直播及可跳转状态变化才刷新工具栏；标题与频道信息和推荐列表分别比较内容后更新。焦点移动通过缓存节点切换前后两个目标的样式，不渲染推荐列表；进度选中和操作提示有独立更新。推荐身份及节点列表只在推荐内容变化时重建，重复队列视频保留独立 ID。组件不查找 YouTube 播放器或原生视频节点，音量仍通过手柄快捷键和快捷菜单调整。

`WatchModule.refreshPage` 和 `refreshPlayback` 分别处理页面数据与媒体状态，原 `refresh` 保留为完整刷新入口。协调器在同一帧分别合并两类刷新：API 通知走页面入口，媒体就绪和结束事件走播放入口；两类同时到来时各执行一次。方向导航不读取或重绘播放进度。浏览器测试在组件更新钩子中计数，验证连续 30 次时间更新不会更新元数据、工具栏或推荐组件，并验证焦点、标题及推荐列表更新互不触发其他区域。

播放时间继续由业务层每 500ms 更新，以及操作后主动刷新。拖动期间模型显示预览位置，播放器快照更新不会拉回滑块；松开后仅提交一次 seek。直播时间轴使用现有 start、end 和 ranges，空档位置选择最近可跳转边界，移动窗口、不可跳转状态、路由切换、关闭控件和销毁均处理预览清理。异步 seek 的旧结果不能覆盖新路由预览。

自动隐藏、临时面板和手柄返回继续由既有状态机和业务层管理，组件不创建自动隐藏定时器。`tests/playback-model.test.mjs` 覆盖快照、拖动、直播范围和失败处理；`tests/playback-vue.test.mjs` 在真实浏览器验证展示、拖动、单次 seek、音量意图、Trusted Types 和原生视频节点身份保留。

浏览导航仅收集自定义浏览界面的卡片、侧栏、分类和顶部控件，以及播放器控件。原生视频卡片、原生分类和原生侧栏不再进入通用导航候选列表；不再执行原生卡片去重、缩略图焦点映射或选中卡片时关闭原生侧栏。导航观察器不再监听 body 的完整子树，仅浅层观察 body，并在播放器和 popup 容器内观察控件变化；Vue 浏览界面继续通过自身更新与 ShadowRoot 观察刷新导航。
