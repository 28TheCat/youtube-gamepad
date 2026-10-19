# YouTube Gamepad

评论面板的评论、回复和后续分页默认使用 YouTube.js，通过当前页面会话直接请求接口，不依赖原生评论节点或滚动隐藏页面。加载中阻止重复请求；失败保留已有内容并支持重试；切换视频取消旧请求。界面显示加载、失败及没有更多评论的状态。为限制面板及桥接数据量，每个视频最多展示 100 条评论，每条最多 100 条回复，所有展示评论共用 200 条回复上限。

频道页默认使用 YouTube.js 解析频道地址的返回结果、频道标签、排序筛选及列表分页。顶部分类栏显示频道提供的视频、Shorts、直播、播放列表等标签及 `Sort · …` 排序按钮，沿用鼠标、键盘和手柄导航。频道别名和标签参数由 YouTube 接口解析，不硬编码；未支持的响应布局保留原有列表解析回退。切换标签或排序时刷新数据及对应控件，播放后返回仍恢复列表、选中位置和续页状态。请求沿用页面登录状态，无需代理或导出 Cookie。自动验证使用模拟响应；真实频道布局和账号仍需现场验证。

故障诊断：在“完整设置 → 诊断”中主动导出 JSON 或清空记录。诊断只保存在扩展本地存储，包含时间、版本、模块、操作、原始错误消息及堆栈、界面状态摘要；最多保留 100 条且序列化记录不超过 32,768 个字符，超限移除最早记录。错误文本截断并隐藏网址，不采集视频标题、评论或完整页面地址。页面侧诊断属于未经信任的遥测，桥接和后台均校验并限流，不授权设置修改或文件导出。

用手柄浏览 YouTube、控制视频播放，并通过屏幕键盘搜索英文或中文。

当前扩展界面使用英文，覆盖设置、工具栏弹窗、快捷菜单、播放控件和搜索提示；中文拼音输入仍可使用。本文档保留中英文说明。

扩展开关开启后，鼠标、键盘和标准映射手柄均可操作界面，无需先连接手柄。断开手柄后可继续使用键鼠；关闭扩展开关恢复 YouTube 原生界面。

操作逻辑参考 [wiliwili](https://github.com/xfangfang/wiliwili) 与其 Borealis 导航框架，按本项目的浏览器架构独立实现：各设备共用方向、确认、返回等动作与弹窗焦点恢复规则，实际操作时自动切换输入提示。键盘使用方向键移动、Enter 确认、Esc 返回、空格播放/暂停、`/` 搜索、F1 快捷菜单、PageUp/PageDown 切换分类或快退/快进。输入框、下拉框和滑块保留原生键盘操作，搜索时保留实体键盘与输入法输入。鼠标左键点击、滚轮滚动，自定义界面内右键返回；原生内容保留浏览器右键菜单。

输入提示在同一标签页的跳转、刷新、失焦和隐藏后保留，长按状态仍会清除，手柄需回中后才能继续操作。鼠标点击和滚轮立即接管；移动需在 250 毫秒的一段手势内达到 24 像素净位移。手柄动作后 200 毫秒内的同功能键盘事件按重复输入忽略；编辑框中的输入及实体打字立即接管。最近 32 条输入来源与切换决定仅保留在内存，不记录输入文字。

Browse YouTube, control video playback, and search in English or Chinese with a gamepad.

[简体中文](#简体中文) · [English](#english)

## 简体中文

独立的 Chrome / Edge Manifest V3 扩展，使用 TypeScript 模块、Vue 3 和 Pinia，无服务器。运行 `npm ci` 和 `npm run build:extension` 后加载 `dist/`；开发与发布使用可重复的检查和打包流程。

### 本地界面接口

界面控制统一使用 ISOLATED 模块内的 `src/ui/ui-api.ts`。YouTube.js 负责数据；本地接口委托已有设置通道、Vue 界面和导航控制器执行主题、布局、焦点及弹层操作，不向页面脚本公开。

```ts
import { ui } from './src/ui/ui-api';

await ui.setTheme('dark');       // light / dark，保存到扩展设置
await ui.setLayout('wide');      // normal / wide / page，沿用现有布局流程
ui.focus('search');              // account / search / content / categories / sidebar
ui.openPanel('account');         // account / settings / search / description / comments / playlists
ui.closePanel();                 // 关闭当前最上层面板，也可指定名称
const snapshot = ui.state;       // 当前主题、布局和已打开面板的展示快照
```

命令返回是否执行成功；保存类命令返回 Promise<boolean>。目标不可用、被弹层遮挡或已经卸载时返回 false。入口由所属界面注册并在销毁时注销；接口不保存另一份界面状态。简介、评论和收藏只在播放界面可用，设置和搜索仍使用原有状态机及焦点恢复。

### YouTube.js 列表解析

账号头像、昵称和账号列表通过 API 获取，自定义账号页不再读取或打开原生账号菜单。登录、账号管理和切换入口跳转官方页面；账号列表展示当前选中状态，不直接提交身份切换请求。

首页、订阅、历史记录和稍后观看默认使用 YouTube.js 解析首屏及后续分页，共用搜索的卡片转换。请求仍由现有页面适配层发送，保留当前账号和分类参数；首屏、分类与分页均通过 API 获取，不读取页面的 `ytInitialData`。稍后观看保留播放列表及视频位置。未支持的条目或解析失败复用原响应回退，不额外发请求。频道、探索及普通播放列表暂时沿用原有解析。

搜索结果及后续分页默认使用 YouTube.js 18.1.0 解析，无需添加地址参数。请求仍由 YouTube 页面中的现有适配层发送，沿用当前账号、筛选参数和登录状态，无需代理服务器或导出 Cookie；Vue 继续接收原有卡片数据和不透明分页 ID。解析失败或遇到未支持的卡片时复用同一响应回退。网络错误保留原页重试，切换页面或取消请求会丢弃旧响应。

该接入只影响搜索页，其他页面沿用原有数据流程。自动检查覆盖模拟响应、认证信息、取消、分页恢复和解析回退；真实 YouTube 的匿名及登录账号仍需现场验证。

### 功能亮点

- 在“画面与布局 → 默认播放布局”选择普通、宽屏或网页全屏（电视控件）。普通和宽屏使用 YouTube 原生播放控件；网页全屏保留现有电视式播放界面。保存后同步应用到已打开的播放页，并在进入下一个视频时自动应用；同一视频内的手动布局切换不会被持续覆盖。浏览器全屏仍由独立开关控制。

- 用方向键或左摇杆浏览视频卡片、侧边栏、播放器按钮和弹窗。
- Shorts 提供独立的竖屏手柄播放界面，显示标题、作者、进度及列表位置。从扩展列表打开时，通过普通 YouTube 视频页承载原生媒体，再由专用 Shorts 界面操作；不提取或重建视频流。↑/↓ 切换当前已加载列表中的短视频，A 或 X 播放/暂停，←/→（或 LB/RB）快退/快进 5 秒，LT/RT 调整音量，B 返回来源列表。切换短视频不累积额外的返回步骤。保留播放页按键映射和原生弹窗优先级；可点击 Use YouTube controls 恢复原生界面。视频节点超过 10 秒未出现时自动恢复原生界面。直接访问原生 /shorts/ 地址仍保留其列表导航；独立页的上下切换仅覆盖打开时已加载的短视频，不表示无限推荐流。
- 短视频画面居中，右侧独立显示点赞、评论、收藏和更多操作。Start 打开短视频操作菜单；评论和收藏面板打开时，方向键只操作面板，B 先关闭面板。评论展开后视频向左让位，小屏改为上下布局。快速上下切换保留最新目标，显示目标封面并沿用 YouTube 页内播放；不再使用 450 毫秒的固定输入拦截。
- 扩展列表距底部 400px 时直接使用接口 continuation 加载下一页，不滚动隐藏的原生页面。分页失败保留已有视频并支持原页重试；连续两页没有新增视频时暂停自动加载，可手动继续。
- 探索入口使用独立的频道页，音乐、电影、直播等复用同一页面组件；各频道使用对应数据源，保留接口分页和返回恢复。
- 首页、订阅、历史记录和稍后观看共用卡片界面及手柄导航，支持分页加载和播放后返回恢复选中位置；稍后观看保留播放列表及视频位置。页面组织参考 [BewlyCat](https://github.com/keleus/BewlyCat) 的共用框架与内容列表设计，数据仍来自 YouTube；创作管理入口打开原版 YouTube Studio。
- 在“Display & layout → 分类栏内容调整”中设置顶部分类的显示、隐藏及顺序，支持拖动、上下移位和重置；完整设置和页面内设置自动同步。分类读取 YouTube 提供的筛选项与请求参数，由 Vue 管理选中状态并请求、渲染分类视频及后续分页；遇到新分类后自动加入设置列表；“全部”保留，正在使用的分类切换后隐藏。LB/RB 按自定义顺序切换，退出电视布局恢复原生分类栏。
- 电视式视频页：视频背景、标题、独立进度条、大按钮和横向推荐卡片。

- 推荐视频和播放列表队列默认复用 YouTube.js 解析卡片展示信息，支持按尺寸选择缩略图和读取时长覆盖层；保留现有播放列表序号、Mix 参数、选中状态、重复视频的不同位置、分页及返回缓存。单张卡片解析失败时自动回退，不新增接口请求。
- 播放 / 暂停、快进 / 快退、调整音量与快捷菜单字幕切换。
- 检测到标准映射手柄后自动进入浏览器窗口全屏。
- 电视式搜索键盘，支持英文大小写、数字、符号和光标编辑。
- 离线中文拼音输入，支持候选翻页与本地学习。
- 返回列表时尝试恢复原卡片焦点与滚动位置。
- 可调整摇杆死区、长按首次重复延迟与连续移动间隔。
- 页面内“手柄与按键”支持点击手柄示意图上的按键，选择功能或录入网页快捷键，并在图旁查看当前绑定。播放页与主页分别保存；占用的功能自动交换绑定。支持 Enter、Esc、Space、/、F1、PageUp/PageDown、方向键、−、=、J/K/L/M/C；不支持浏览器或 Windows 系统组合键。
- 手柄检测与校准：显示浏览器识别到的标准和非标准设备、实时按钮/扳机读数、摇杆轴及死区预览；静止采样后可主动应用建议死区。

### 手柄检测与校准

点击扩展工具栏弹窗的“手柄检测与校准”，或进入独立完整设置页的“手柄检测”。此入口无需先打开 YouTube，也不要求启用手柄操作。连接手柄后点击检测页并按一下手柄按键；浏览器可能需要这次操作才暴露设备。多个设备可通过下拉框切换。

按键测试显示浏览器原始输入编号、按下/触碰状态和扳机数值；摇杆图显示所有轴、实时位置及方形死区，与导航使用的逐轴阈值一致。测量摇杆漂移时，松开当前导航摇杆并保持检测页活动 3 秒；普通模式采样左摇杆，右手模式采样右摇杆。建议值按最大静止偏移加 0.05 余量，向上取 0.05 的倍数并限制在 0.15–0.75；需主动应用才保存。手动预览同样需点击“应用预览值”，设置对所有支持的手柄生效。设备切换、断连或页面失去焦点会中断正在进行的测量。

非标准映射设备目前仅支持检测，尚未接入 YouTube 导航或按设备自定义映射。实时读数不保存或上传；实体手柄的识别、轴顺序和漂移仍需在目标设备实测。

### 安装

先下载本仓库 ZIP 并解压，或克隆仓库到本地。安装和使用无需 Node.js；下文的开发检查需要 Node.js。

1. Chrome 打开 `chrome://extensions`，Edge 打开 `edge://extensions`。
2. 运行 `npm ci` 和 `npm run build:extension`。打开开发者模式，选择“加载已解压的扩展”，选择生成的 `dist/` 文件夹。
3. 打开或刷新 https://www.youtube.com/，连接手柄，点击页面并按一次手柄按键。
4. 用方向键或左摇杆选择，A 打开视频，Start 打开快捷菜单。工具栏弹窗保留启用开关、连接状态和“更多设置”。快捷菜单中的“完整设置”也可进入设置页。

### 架构

参考 [Couch Browser 的分层设计](https://github.com/SeeSharpSoft/couch-browser/blob/main/DEVELOPMENT.md)，本项目代码独立编写。

- `gamepad.ts`：ISOLATED world 输入轮询、标准按键映射、死区、方向长按重复；只发送动作，不点击页面。
- `core.ts`：ISOLATED world 导航核心；维护选中项、按几何位置选择目标、处理弹窗范围和 Shadow DOM 提示层。输入归属和选中框显示由注入策略决定，不读取具体菜单或播放模块的状态。
- `navigation.ts`：独立的方向规则，参考 [js-spatial-navigation](https://github.com/luke-chang/js-spatial-navigation) 的 section 思路，代码独立编写；先在分区内寻找同一行列的目标，再按显式出口跨区。无需 React 或第三方运行依赖。
- `sites/youtube.ts`：集中管理 YouTube 选择器、视频/推荐/评论/播放状态读取、搜索同步和原生设置操作；界面接收数据快照，原生节点保留在适配层。通过 `createNavigationConfig(policy)` 接收协调层接口。
- `coordinator.ts`：管理模式、适配能力、设置和动作归属，连接站点与界面。`app/route-state.ts` 保存纯导航返回规则，`app/route-controller.ts` 负责路由监听和历史操作。
- `keyboard.ts`：按官方电视版已核对的布局定义字母页、数字页和键盘动作；不依赖官方混淆脚本。
- `menu.ts`：快捷菜单宿主、焦点与搜索入口；`search.ts` 负责文本编辑、拼音候选、键盘和搜索历史，原生操作通过端口请求。
- `watch.ts`：观看交互与数据刷新；`ui/watch-view.ts` 创建界面，`ui/watch-panels.ts` 管理说明和评论面板。Shadow 样式源文件为 `ui/menu.css` 和 `ui/watch.css`，由开发脚本生成 `ui/styles.ts`。
- `runtime.ts`：按模块登记监听器、定时器、动画帧、观察器和清理函数；销毁后清理浮层和历史包装，支持重新注入。
- `browse.js` / `browse.css`：主页外围导航；顶栏、侧栏和分类栏布局保留在 `browse.css`。公共配色、字体、圆角、间距和焦点反馈统一在 `ui/theme.css`，主页、快捷菜单、搜索和设置弹窗共同引用；搜索实时跟随 YouTube 明暗主题，视频控制层保留深色半透明背景。完整设置页与扩展工具栏弹窗使用最近一次 YouTube 明暗主题，尚未读取到网站主题时采用系统明暗偏好。
- `content.ts`：ISOLATED world 设置桥接，读取扩展存储；独立检测标准手柄并向后台报告连接状态。`inline-settings.ts` 在同一隔离环境中渲染快捷菜单内的设置，界面事件处理器直接保存固定设置项；页面消息不能提供任意存储键或设置值。
- `background.ts`：使用 `chrome.windows.update` 管理 F11 式窗口全屏；原窗口状态保存在 `chrome.storage.session`，页面跳转和后台休眠不会清除。只恢复扩展自己开启的全屏。
- `popup.html` / `popup.js` / `popup.css`：工具栏弹窗，提供启用开关、连接状态和更多设置入口。`options.html` / `options.js` / `options.css`：完整设置页，左侧分类、右侧内容，分为“常用”“画面与布局”“手柄与按键”“帮助与诊断”；窄屏分类显示在内容上方，修改后自动保存。
- `manifest.json`：声明两个执行环境中的脚本，只匹配 www.youtube.com。

设置面板 → chrome.storage → content.ts → 设置消息 → coordinator.ts → 输入层、导航核心与播放界面。
手柄 → gamepad.ts → 动作事件 → core.ts → 协调层 → 播放界面 / YouTube 适配。

模块职责、数据端口和输入优先级见 [ARCHITECTURE.md](ARCHITECTURE.md)。播放界面通过 `connect(port)` 读取数据快照并请求操作，通过 `sync()` 接收协调层的模式更新。菜单、原生弹窗、说明/评论面板按层消费动作，只有明确返回 `pass` 才允许继续分发。

`core.ts` 通过站点配置中的 `shouldShowSelection({ scope })` 回调决定是否显示选择框，不读取站点或播放界面状态。`watch.ts` 通过 `connect({ state, request, ... })` 接收只读状态快照与统一命令入口，模式、启用状态和导航锁由 `coordinator.ts` 管理，`sync()` 仅按当前状态渲染，不能回写模式。推荐切换、播放操作、设置、频道、评论及返回控制栏都经过 `request(type, value)`，共享禁用和导航锁检查。原生设置关闭后的焦点只由 `focus.ts` 的层级栈恢复，播放页不再保存第二份恢复目标。站点层不调用播放界面；协调层最后加载并完成接口注入。

MAIN world 脚本通过 Manifest V3 静态声明加载，避免手动插入脚本标签。窗口全屏由后台 service worker 控制，不读取标签敏感信息，无需 tabs 权限。

### 开发验证与发布

需要 Node.js 22 或更高版本。运行 `npm ci` 安装锁定的开发依赖；默认浏览器验证使用本机 Chrome，CI 使用 Playwright Chromium。

- `npm run styles`：修改 Shadow 样式后重新生成同步样式资源。
- `npm run check:modules`：检查清单中的构建入口、模块导入、语法、资产和样式一致性。
- `npm run check`：完成上述检查，再执行 TypeScript 和 Vue 的完整类型检查。
- `npm test`：运行纯状态规则及模拟 DOM / 扩展 API 回归。
- `npm run test:browser`：运行全部 MAIN 模块的真实浏览器集成测试，缺少依赖会报错。
- `npm run test:extension`：用 Playwright Chromium 实际加载未修改的扩展清单，覆盖 MAIN / ISOLATED、设置存储、后台消息、刷新、标签切换、模拟手柄断连重连与真实 MV3 worker 停止 / 唤醒。首次需运行 `npx playwright install chromium`。
- `npm run test:youtube`：实际加载扩展并访问联网 YouTube，验证首页注入、设置桥接与刷新；网络失败会报错，不跳过。不能替代品牌浏览器与实体手柄验收。
- `npm run verify`：完成静态检查、单元和浏览器回归。
- `npm run build:extension`：由 Vite 构建 MAIN、ISOLATED、后台、Popup 和 Options 五个独立入口，生成可加载的 `dist/`。
- `npm run build`：检查源码、构建扩展，再将运行所需文件和许可证打包到 `output/releases/`；生成 SHA-256 完整性清单。
- `npm run check:release`：验证最新发布包的文件和完整性。

模块构建的入口映射见 `scripts/extension-entries.mjs`：`src/entries/main.ts` 组装页面内模块，`content.ts` 组装 ISOLATED 桥接，`background.ts` 组装后台，`popup.ts` 和 `options.ts` 挂载扩展页面。源码通过 `import/export` 声明依赖，Vite 为每个入口生成独立的 IIFE；清单只加载两个页面脚本包，保留原有 MAIN / ISOLATED 分工和 `document_idle` 时机。修改源码后重新执行 `npm run build:extension`，并在扩展管理页重新加载 `dist/`。

`check:modules` 只验证模块构建，不执行完整类型检查和全部回归。`npm run build` 的发布门槛仍是完整 `check`；类型错误会阻止发布打包。

以 `YTG_EXTENSION_ROOT=latest-release` 运行浏览器测试可直接验证发布包。完整模块接口和销毁约定见 [ARCHITECTURE.md](ARCHITECTURE.md)。`.github/workflows/verify.yml` 自动运行检查、构建和发布包浏览器回归。

功能定义统一在 `actions.js`，与实体按钮绑定分开；分类、场景及执行入口见 [动作目录](ACTIONS.md)。

### 默认按键（Xbox 命名）

快捷键设置提供“播放页”和“主页”两套独立布局。手柄示意图上的按键可点击修改；主页布局也用于搜索结果、频道等浏览页面，播放页使用自己的布局。切换页面时自动切换输入映射和按键提示，先前的共用配置会作为两套布局的初始值。交换按键与恢复默认仅影响正在编辑的布局。按键图标仍使用 Kenney 素材，整只手柄轮廓为项目绘制的 SVG。

快捷菜单的 All settings 在当前 YouTube 页面内打开设置分类，可调整启用、画面、自动全屏、按键绑定与输入灵敏度，并导出或清理诊断记录。扩展工具栏的设置入口也打开这个菜单，不另开标签页。B / Escape 逐级返回到分类、快捷菜单，再关闭菜单。独立 `options.html` 保留为浏览器扩展管理页的兼容入口。

「手柄快捷键」可为确认、返回、播放、搜索、快进快退、音量、快捷菜单及搜索键盘功能分配标准手柄按键。选择已占用的按键会自动交换两项功能，支持恢复默认按键；方向键和左摇杆保留导航用途。修改自动保存在本机，已打开的 YouTube 页面和按键提示同步更新。按键菜单使用项目现有的 Kenney CC0 图标和 Xbox / PlayStation 物理位置对照；菜单内的图标跟随当前手柄类型，Switch 以相同物理位置为准。

界面会根据当前使用的标准映射手柄自动切换按键图标和提示：Xbox 显示 A / B / X / Y，PlayStation 显示 × / ○ / □ / △ 和 L1 / R1 / L2 / R2，Switch 显示对应位置的 B / A / Y / X 和 L / R / ZL / ZR。Xbox、PlayStation、Switch 和通用手柄按键统一使用 [Kenney Input Prompts](https://kenney.nl/assets/input-prompts) 的原版 SVG（CC0），面键保留原始配色。来源和授权见 [第三方说明](THIRD_PARTY_NOTICES.md)。素材随扩展本地打包，使用时无需联网加载。整体界面配色仍跟随 YouTube 主题。搜索、菜单和播放提示在手柄切换时实时更新；多个手柄连接时跟随正在操作的手柄。无法识别的型号使用通用 Xbox 命名，识别依赖浏览器报告的设备名称；按键动作仍采用 Gamepad API 标准位置。

浏览模式：方向键 / 左摇杆移动选择，A 打开，B 关闭弹窗或返回。LB / RB 直接切换到上一个 / 下一个分类，无需先选中分类栏；到达两端时停止。

播放模式：视频页默认进入，左右唤出控制栏并移动焦点，A 播放暂停，上键显示电视式播放面板，下键进入推荐卡片，B 暂停并返回列表。暂停后仍保留播放模式。控制栏模式保留铺满窗口布局，左右选择按钮，上键进入进度条，下键从进度条回到按钮；进度条按 A 开始调整，左右调整 10 秒，A 结束调整并保留焦点，B 从进度条或推荐回到原控制按钮，再按 B 收起面板。

通用：X 播放暂停；Y 进入搜索模式；LB / RB 浏览时切换分类、播放时后退 / 前进 10 秒；LT / RT 音量减 / 加；Start 打开或关闭快捷菜单。

输入归属：关闭功能时阻断所有动作；导航进行中阻断重复 A 确认和 B 返回；临时层优先占有输入，无可执行目标也不穿透到播放器。无临时层时，先由推荐区、进度条或控制栏处理，再交给基础播放或页面浏览。处理结果为 `handled`（已处理）、`blocked`（占有但无动作）、`pass`（允许交给下一层）。

Y / Start 只允许从页面或播放区域打开搜索 / 快捷菜单；菜单覆盖当前区域。快捷菜单中 Y 进入搜索，搜索中 Y 输入空格；Start 在菜单或搜索中直接关闭整个菜单。搜索中 B 先取消语言选择或拼音组合，再返回打开搜索的菜单或页面。原生弹窗、说明或评论面板打开时，Y / Start 被阻断，先用 B 关闭当前层。

快捷菜单：方向键选择，A 执行，B 返回。包含搜索、字幕和音量。搜索内置字母网格键盘，支持大小写、数字、符号和光标编辑；中文可通过语言键选择“中文（拼音）”，用手柄选候选字上屏，也支持实体键盘。搜索时 X 删除、Y 空格、LB / RB 移动光标、LT 切换大小写、RT 搜索。选中文字后输入会替换选区。扩展工具栏面板集中管理自动全屏、摇杆死区和更多设置（首次重复延迟、连续移动间隔），修改后自动保存。

### 验证与范围

运行 `node scripts/check.mjs` 校验清单和脚本语法，运行 `node --test tests/*.test.mjs` 检查输入和方向规则。

性能压力检查：运行 `node scripts/performance.mjs`，覆盖 100 / 1,000 / 5,000 张卡片的连续导航、200 次 SPA 路由切换、模拟一小时播放器样式变化，以及词库启动和候选查询。布局与样式读取按单次同步动作复用，动作结束即释放；滚动和显式刷新清除测量缓存。页面监听合并同一帧的更新，跳过扩展界面及播放器视频、字幕、进度动画；原生设置菜单和进度条自身的可见性变化仍参与恢复。预览视频仅检查新增子树，后台标签暂停界面更新。

2026-10-03 同机 Node 压力场景的优化前后计数（DOM 替身，不代表真实浏览器耗时）：

| 场景 | 优化前 | 优化后 |
| --- | ---: | ---: |
| 1,000 张卡片，200 次移动：布局读取 | 1,000,400 | 200,200 |
| 同场景：样式读取 | 600,200 | 200,200 |
| 同场景：页面查询 | 1,600 | 400 |
| 216,000 次播放器动画：恢复回调 | 216,000 | 0 |
| 词库启动中位数，7 次，约 ms | 111 | 21 |
| 首次 nihao 候选，约 ms | 0.45（整库已加载） | 2（只解析 n 分片） |

词库按首字母延迟解析和建索引，候选结果缓存最多 32 组、排序缓存最多 64 组；学习新词会使相关缓存失效。词库脚本仍随扩展静态加载，优化的是对象创建和索引开销；编码为字符串使文件从约 2.51 MB 增至 2.93 MB。完整词条和授权保持一致，`node scripts/pack-pinyin.mjs` 可重复打包。

#### 性能验收标准

以每次同步方向键操作的 P95 为准，测量前先预热；目标设备上 100 / 1,000 / 5,000 张卡片分别不超过 8 / 16.7 / 50 ms。低性能设备档用 Chromium DevTools 的 4× CPU slowdown，在 1,000 张卡片时 P95 不超过 50 ms。连续一小时播放负载后，强制 GC（若浏览器支持）后的已用 JS 堆相对测试前增长不超过 16 MB；没有可用 GC 或堆 API 时记录为未测，不以缺失数据判定通过。任何基准需同时记录浏览器版本、设备 CPU 核心数和 slowdown 档位。

这些是本地扩展开销的验收线，不包含 YouTube 网络、视频解码或页面实验造成的延迟。不同设备的结果不得混作同一基线。当前 headless Chromium 151（16 核 / 16 GB）实测 100 / 1,000 / 5,000 张卡片 P95 为 2.2 / 10.6 / 40.6 ms；4× CPU slowdown 下 1,000 张为 41.4 ms，均满足对应阈值。加速一小时事件频率模拟的堆读数变化为 0 MB，但没有强制 GC，也不代表真实一小时结果；长时堆增长仍未验收。

真实浏览器的本地压力页由 `node scripts/build-performance-browser.mjs` 生成，运行 `node scripts/preview-watch.mjs` 后访问 `http://127.0.0.1:8765/output/performance/fixture.html`，在浏览器控制台执行 `await runPerformance()`。结果包含运行环境信息、分规模导航延迟、滚动焦点框检查，以及 216,000 次播放器样式变化后的堆采样和强制 GC 是否可用（Chromium 支持时）。这是一小时事件频率的加速模拟，不等于一小时实际播放；要验收长时标准，应在目标设备上实际运行一小时并记录采样。低性能档需在 DevTools 手动启用 4× CPU slowdown 后运行。

真实 YouTube 页面与实体手柄的兼容性仍需实测。只接受 Gamepad API 标准映射；不支持非标准手柄自定义映射、Shorts 专用操作、浏览器标签切换。首页使用大屏样式增强，视频页由独立界面接管；底层仍加载原 YouTube 页面以保留播放、登录和数据能力。尚未覆盖 YouTube 的所有布局实验。YouTube DOM 改版可能需要更新选择器。网站可能拒绝合成点击或键盘事件；浏览器也可能限制脚本触发的视频播放。

### 手动验收

上线前必须完成 [完整扩展与真实 YouTube 验收](ACCEPTANCE.md)。自动化全绿只证明对应测试范围，不代表 Chrome / Edge 与真实手柄兼容性已通过。

- 搜索框按 A 自动打开手柄键盘，带入原搜索词；B 关闭后回到搜索框。搜索采用 YouTube 电视式整页视图：顶部搜索栏、左侧最近 5 次搜索、右侧 A–Z 字母网格和底部空格 / 清除 / 搜索。默认选中 A，数字符号通过 &123 切换；输入保存在扩展自己的搜索框中，提交通过经过校验的搜索路由进入 API 结果页，不依赖网站原搜索按钮；B 返回原页面。配色跟随网站浅色 / 深色主题，左右可在历史与键盘之间切换。清除按钮清空输入，RT 或搜索按钮提交。历史记录保存在当前浏览器的 YouTube 网站存储中。

- 首页与搜索结果：方向移动、A 打开；滚动后选中边框跟随。
- 视频页：X 暂停播放，肩键快进快退，扳机音量，Y 进入搜索模式。
- 视频页左右唤出控制栏并移动焦点，A 暂停，上键显示电视式播放面板；左右选择播放、字幕或设置等按钮，上键选中进度条，A 开始调整后左右改变进度，A 结束调整，下键回到按钮。B 先收起控制栏，再次 B 暂停并返回列表。
- 原生设置内测试清晰度、字幕等子菜单：B 先回设置上一级，再关闭设置；关闭后恢复原控制按钮。
- Start 打开菜单，用手柄搜索输入英文，B 返回；在扩展工具栏面板修改设置，刷新后检查设置保存。
- 菜单字幕按钮切换字幕；没有字幕或播放器的页面应显示不可用提示。
- 打开菜单：选择范围限制在菜单，B 尝试关闭。
- 工具栏关闭扩展：手柄不再操作页面，选中边框消失。
- 切换标签或断开手柄：不继续执行长按动作；重新进入后可操作。

### 导航分区与焦点

B / Escape 的逐层返回表、搜索入口记录与焦点恢复约定见 [返回规则](BACK_BEHAVIOR.md)。窗口全屏时 Escape 优先退出全屏；非全屏时两者共用 `back` 动作及导航锁。长按 Escape 不连续退层，使用 Escape 会切换到键盘提示。手动退出全屏后，刷新与切换焦点不会重新进入；断开并重新连接手柄后可再次自动全屏。拔掉当前手柄会切回鼠标输入，界面仍支持键鼠；松开手柄按键和摇杆后，再操作可重新进入手柄输入。

快捷菜单或搜索覆盖原生弹窗时，统一焦点模块暂时给下层弹窗添加 `inert`，避免原生焦点限制把选择拉回后台。下层弹窗仍保留在返回栈中；关闭上层界面时先解除限制，再恢复原选项。页面原有的 `inert` 属性不改动。

- 内容区：视频卡片去重；左右优先同一行且不跳到下一行，上下先进入紧邻的一行，再选择最接近原列的卡片。区内存在目标时不跨区。
- 侧边栏：上下移动，右键进入内容区；顶部可向上进入标题栏。
- 标题栏：左右移动，下键进入内容区或播放器。
- 播放器：浏览模式下左右选择控制按钮，上到标题栏，下到视频内容区；播放模式使用上文的专用按键。
- 弹窗：打开后自动选中内部首项；方向导航和确认仅在弹窗内生效。关闭后恢复外部选中项。B 的实际关闭效果仍需在真实 YouTube 菜单验证。
- 返回页面：当前标签内保存最近 30 个路由的选中目标与滚动位置；等待目标重新加载后恢复。完整刷新后不会保存；不自动加载尚未回到 DOM 中的远端卡片。
- 选中框加入短过渡，并尊重系统减少动画设置。

后续建议：进行真实 YouTube 页面与实体手柄验收，持续检查电视式播放面板、进度条和设置菜单在不同布局实验下的选择器兼容性。

### 电视式视频页

视频页接管前检查播放器和属于该播放器的视频播放能力。正常加载期间以电视加载画面覆盖原生界面，最多等待 5 秒；超时、已接管后关键能力丢失或适配异常时，自动恢复原生布局和控制栏，关闭扩展菜单及说明/评论面板，并显示原因。降级不会暂停视频或退出浏览器窗口全屏。提示中的“重试适配”可重新检查；打开其他视频或刷新页面也会重新检查。字幕、推荐、评论、标题缺失及直播时长不触发整页降级。推荐、评论、频道、字幕、设置与订阅/点赞/点踩/保存分别检查能力；读取或执行异常只降级对应功能，后续页面检查继续尝试恢复。原生播放/设置按钮缺失不会退出播放界面，播放仍通过视频能力控制。

普通 YouTube 的播放器、字幕和登录状态继续保留，扩展接管视频页展示。标题和频道显示在顶部，独立进度条、大按钮与推荐卡片显示在底部。播放时按钮区无操作 5 秒后自动收起；暂停、选择进度、浏览推荐或打开功能面板时保持显示。说明使用独立面板；清晰度、字幕语言等设置沿用原播放器菜单。关闭设置后恢复原按钮焦点。首页与搜索保留原站视频列表，大屏模式仅精简外围导航。关闭手柄操作后恢复普通视频页。

相关推荐和播放列表队列由 YouTube 内部 `next` 接口获取并分页，各最多保留 120 条；队列条目显示在推荐之前，并保留播放列表和序号参数。切换视频沿用原站导航，播放控制与连续播放继续由原生播放器处理。沿手柄打开的推荐链退出时返回最初的列表。底部左侧按频道头像、说明、订阅排列；中央为快退 10 秒、播放/暂停、快进 10 秒；右侧的点赞、点踩、评论、保存共用圆角底座，字幕和设置共用另一底座。视频详情、订阅及评价状态由 YouTube.js 解析 API 响应；点赞、点踩、订阅和取消订阅复用当前页面登录会话发送 API 请求。保存打开扩展内的播放列表选择面板，可添加到已有列表或从列表移除。操作确认成功后更新状态，写入失败不会自动重试；未登录或无法确认状态时禁用对应按钮。

### 手柄播放流程

播放页短按 LB / RB 预览后退 / 快进 10 秒，按住后连续预览并按累计距离逐步增大步长；屏幕显示目标时间和累计变化量，松开后只执行一次跳转，保留原播放或暂停状态。LT / RT 长按连续调整音量，每步 5%，范围 0–100%。首次重复延迟和连续间隔沿用手柄设置，用户改键后跟随实际绑定。返回、确认和播放 / 暂停每次按下只执行一次。打开菜单、搜索或弹窗，其他动作、切换输入方式、失焦、断连、禁用、改键或切换页面时取消未提交的快进预览；列表页 LB / RB 切换分类仍只触发一次。直播回放按最新有效范围跳转，无回放范围或未知时长时不执行跳转。

纯播放状态下，按住右摇杆按钮（R3）350 毫秒可临时以 2× 播放，并显示倍速提示；松开后恢复按住前的倍速（例如 1.5×）。打开菜单、搜索、控制栏或弹窗，暂停、切换视频、切换输入方式、失焦、断开手柄或关闭扩展时结束加速；松开后重新按住才能再次触发。搜索中的 R3 继续切换候选词。R3 已绑定其他普通操作时优先执行用户绑定；直播、暂停和原倍速不低于 2× 时不启动临时加速。通过 YouTube 修改倍速时尊重新选择的倍速。

主页或搜索结果中按 A 打开视频后，立即显示电视加载画面，播放器就绪后直接进入铺满窗口的播放布局，不展示电脑端详情页。手柄打开推荐视频沿用同一过渡；导航取消或关闭手柄操作时清除加载画面。窗口全屏由后台独立管理，播放模式不调用网页 Fullscreen API。扩展菜单可覆盖在视频上。

播放模式：A 暂停或继续，左右唤出控制栏并移动焦点，Start 打开快捷菜单，上键显示电视式播放面板，下键进入推荐卡片。控制栏内左右移动焦点，上键进入进度条，下键回到按钮；选中进度条时按 A 开始调整，左右快退或快进 10 秒，A 结束调整并保留进度条焦点，保持原播放或暂停状态。B 按层级返回：设置子菜单 → 设置主菜单 → 播放面板 → 纯播放 → 原列表；退出视频时暂停，由导航核心恢复原卡片和滚动位置。直接打开视频链接时退出视频返回首页。快捷菜单仍优先接收输入。

当前 YouTube 标签检测到标准手柄后自动进入 F11 式窗口全屏；搜索、视频跳转、刷新和 B 返回不退出窗口全屏。断开手柄、关闭自动全屏或关闭手柄操作时，恢复扩展开启全屏前的普通或最大化状态；用户原本自行开启的全屏不退出。自动全屏与大屏布局在完整设置页的“显示”分组独立控制。大屏布局在列表页只替换顶栏，在播放页提供电视式控件，不改变浏览器窗口状态；视频铺满页面也与浏览器全屏分开处理。旧版合并开关的偏好会保留为两个开关的初始值。整页跳转后，浏览器可能需要一次手柄按键才能重新暴露 Gamepad API；初始空快照不会被当成断开。

### 客户端首页布局

首页搜索栏在手柄模式下是整条可选中的入口，显示搜索文字和当前搜索快捷键提示。确认或搜索快捷键打开现有电视键盘，关闭后恢复入口焦点；按下进入视频区，按左进入分类栏，最右分类按右进入搜索入口。按键提示跟随手柄型号及用户绑定更新。鼠标模式使用可直接输入的搜索框。

开启扩展和大屏布局后，列表页面使用完整客户端布局：顶部为 YouTube Gamepad 标识、搜索和账号入口；左侧为首页、订阅、个人内容与探索导航；右侧为分类栏和独立滚动的视频网格。视频标题、频道信息、卡片间距和焦点反馈采用统一主题变量，支持明暗主题。窄屏侧栏收为图标导航，保留可访问名称；默认列数随内容区宽度调整为 1 / 2 / 3 / 4 / 4 / 5 列，用户自定义列数继续生效。侧栏的地区探索分类和“我的视频”地址由 YouTube guide API 提供，接口暂不可用时显示内置入口，不再扫描原生侧栏。搜索、账号入口和侧栏导航连接原站能力，分类由 Vue 管理并请求 YouTube 接口；关闭大屏布局或扩展后恢复原站界面，断开手柄仍可用键鼠操作。

视频区左边界按左进入侧边栏，按右或 B 回到原卡片；顶部边界按上进入分类或搜索，按下返回视频区时恢复原卡片，B 直接返回视频区。切换分类后等待新列表加载，再选择第一张卡片。页面跳转保留既有的返回列表与滚动恢复机制。搜索继续使用原有电视式键盘。

### 视频列表滚动

视频排优先使用原站提供的行容器，未提供时按卡片顶部位置分组。左右按排内顺序切换，不跨排；上下进入相邻排，优先恢复该排最后选中的视频。首次进入一排时沿用原列，卡片较少时落在最后一张，但保留原列意图，继续进入新排时恢复。焦点按视频链接记录，原站替换卡片节点后仍可恢复；目标消失时按列回退。切换分类或页面会清空排内记忆，返回列表仍沿用既有的页面焦点恢复。

上下方向每次进入紧邻的一行，尽量保持原列；左右只在当前行移动。选中行完整可见时页面不移动；选中行越过可视区域时，将整行顶部对齐到固定搜索栏、分类栏下方，并留出 16 像素间距。采用即时对齐，避免长按方向键时平滑滚动造成测量偏差。不再按半屏距离滚动，没有下一张候选卡片时保留当前焦点。卡片行比可视区域高时优先对齐顶部。返回列表仍恢复原卡片及滚动位置。

### 电视版键盘参考

2026-10-03 核对了 youtube.com/tv 下发的 kabuki main 脚本：英文布局、共用数字符号布局、LETTER_LAYOUT / NUMBER_LAYOUT 和 TEXT / BACKSPACE / SPACE / CLEAR / SEARCH / SWITCH_LANGUAGE 动作。扩展独立实现这些布局与动作，通过已校验的搜索路由提交并由 API 加载结果；不加载或执行下载的参考脚本。语言按钮选择 English、中文拼音或实体键盘。官方 zh-CN 模块仅含中文标签和字母布局，未包含拼音引擎；扩展另行实现离线候选，不依赖官方电视服务。LT 大小写、肩键光标移动是扩展保留的快捷操作。

### 中文拼音输入

选择地球键 → 中文（拼音），用字母键输入不带声调的拼音（ü 用 V），如 nihao、zhongguo、dianying。拼音保持为未确认状态，不会写进搜索框。候选显示在左侧历史记录区域；从键盘最左列按左进入候选区，上下选词、A 确认，按右回到键盘；下一页 / 上一页可翻页。Y / 空格确认首选。长拼音可逐词确认，剩余拼音继续选字。X 先删除拼音，拼音为空时删除已上屏文字；B 先取消拼音，再返回。RT 只在拼音已确认时提交搜索。无匹配时可以修改拼音或选择“原文”。

词库由 CC-CEDICT 生成，约 12 万条字词，随扩展附带，离线运行；不向外部输入法服务发送拼音。选择习惯在本地记忆；词库没有完整词频和上下文模型，不保证候选顺序或整句转换达到系统输入法水平。来源、版本和 CC BY-SA 4.0 授权见 THIRD_PARTY_NOTICES.md。

### 数据与授权

扩展仅声明 `storage` 权限，内容脚本仅匹配 `https://www.youtube.com/*`，无需 `tabs` 权限。扩展设置保存在浏览器扩展存储中；最近搜索、键盘语言和拼音学习记录保存在当前浏览器的 YouTube 网站本地存储中。搜索提交给 YouTube，拼音候选在本地生成。

网站脚本可以读取、篡改这些本地记录，也可以监听、伪造 MAIN world 消息；这些数据和消息不构成可信授权。记录读取有类型、长度、数量和词库校验；页面通信不允许写扩展存储或请求后台操作。详见 [数据与消息的信任边界](SECURITY.md)。

词库衍生数据采用 **CC BY-SA 4.0**，重新分发时须保留署名与授权信息，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。独立编写的扩展代码采用 **MIT** 许可证，见 [LICENSE](LICENSE)；词库和第三方素材继续遵循各自的许可证。发布包包含代码许可证与第三方授权说明。

## English

The extension interface is in English, including settings, the toolbar popup, quick menu, playback controls, and search prompts. Chinese Pinyin input remains available. This README includes both Chinese and English documentation.

YouTube Gamepad is an independent Manifest V3 extension for Chrome and Edge. It adds gamepad navigation and a large-screen viewing experience to the regular YouTube website. TypeScript modules are bundled with Vite; Vue 3 and Pinia render extension pages and selected overlays. Run `npm ci` and `npm run build:extension`, then load `dist/`. No server is required.

### Features

- Navigate video cards, the sidebar, player buttons, and dialogs with the D-pad or left stick.
- Home, subscriptions, history and Watch Later share the card interface and gamepad navigation, with pagination and selection restoration after playback. Watch Later preserves playlist context and position. Page organization follows BewlyCat's shared shell and content lists; data comes from YouTube and creator tools open YouTube Studio.
- Play/pause, seek backward/forward, adjust volume, and toggle captions through the quick menu.
- Automatically enter browser window fullscreen when a standard-mapped controller is detected.
- Search with a TV-style keyboard supporting letters, case switching, numbers, symbols, and cursor editing.
- Enter Chinese using an offline Pinyin dictionary, candidate paging, and locally learned preferences.
- Attempt to restore the selected card and scroll position when returning to a list.
- Adjust stick deadzone, initial repeat delay, and repeat interval on the full settings page (Common, Gamepad, Display), opened from the quick menu or toolbar popup.

### Installation

1. Download and extract this repository's ZIP, or clone the repository locally.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Run `npm ci` and `npm run build:extension`. Enable **Developer mode**, click **Load unpacked**, and select the generated `dist/` folder.
4. Open or refresh [YouTube](https://www.youtube.com/) and connect your gamepad.
5. Click the YouTube page, then press a controller button so the browser can detect it.
6. Navigate with the D-pad or left stick, press **A** to open a video, and press **Start** for the quick menu.

Use the extension's toolbar icon to enable or disable gamepad controls, toggle automatic fullscreen, and adjust input settings. Changes are saved automatically. Node.js is needed only for development checks.

### Controls

Button names follow the Xbox layout. The browser must recognize the controller using the Gamepad API's `standard` mapping.

| Button | Browsing / general action | Playback mode |
| --- | --- | --- |
| D-pad / left stick | Move selection | Left/right: show controls and move focus; up: show controls; down: browse recommendations |
| A | Open or confirm | Show controls when hidden; activate the focused control when visible |
| B | Close a dialog or go back | Go back through UI layers; pause and return to the list when leaving the video |
| X | Play/pause | Play/pause |
| Y | Open search mode | Open search mode |
| LB / RB | Switch to the previous/next category; stop at either end | Seek backward/forward 10 seconds |
| LT / RT | Decrease/increase volume by 5% | Decrease/increase volume by 5% |
| Start | Open/close the quick menu | Open/close the quick menu |

**Native controls:** Move between buttons with left/right, press up to select the progress bar, and down to return to the buttons. On the progress bar, A starts adjustment; left/right then seek 10 seconds, and A ends adjustment while keeping progress focused. B exits adjustment first, then returns to the controls. B goes back through settings submenu → settings menu → player controls → playback mode → original list. Leaving a video opened directly returns to the home page. Pausing a video keeps playback mode active.

**Playback controls:** When the controls are hidden, A shows them. Use the D-pad to move through controls and the timeline, then press A to activate a control or adjust progress. B hides the controls first; another B follows the usual fullscreen or video-return behavior.

**Quick menu:** Navigate with the D-pad, confirm with A, and go back with B. The menu provides search, playback, captions, and volume controls. When open, it takes priority over the underlying page.

**Search shortcuts:** X deletes, Y inserts a space, LB/RB move the cursor, LT changes case, and RT submits. The language key offers English, Chinese Pinyin, or a physical keyboard. Use `&123` / `ABC` to switch between letters and numbers/symbols. Typing replaces selected text. B closes search and returns to the original page.

### Search Keyboard and Chinese Pinyin

Search opens a full-page TV-style interface with a search field, the five most recent searches, an A–Z keyboard, and space, clear, and search buttons. The initial selection is A. Input is synchronized with YouTube's search field, and submission uses the website's original search button. The interface follows YouTube's light or dark theme; left/right navigation lets you move between search history and the keyboard.

To enter Chinese:

1. Open search and choose **Chinese (Pinyin)** from the input language key.
2. Enter Pinyin without tones, such as `nihao`, `zhongguo`, or `dianying`. Use `v` for `ü`.
3. From the top keyboard row, press up to enter the candidate area. Choose with left/right and confirm with A; use previous/next page controls to browse candidates.
4. Y or the space key confirms the first candidate. Longer input can be converted one word at a time, leaving the remaining Pinyin available for further selection.
5. After confirming the Pinyin, press RT or select the search button to submit.

Unconfirmed Pinyin stays separate from the website's search field. X deletes Pinyin first, then committed text when no Pinyin remains. B cancels pending Pinyin before going back. RT submits only after the Pinyin has been confirmed. If no candidate matches, edit the Pinyin or choose the raw-text option.

The bundled CC-CEDICT-derived dictionary contains approximately 120,000 entries. Candidate generation runs offline without sending Pinyin to an external input service. Selection preferences are remembered locally. The dictionary lacks a complete frequency and context model, so candidate ranking and full-sentence conversion are limited.

The keyboard independently implements layouts and actions inspected in YouTube's TV scripts on October 3, 2026. Downloaded official reference scripts are not loaded or executed. The inspected Chinese module supplied labels and a letter layout, not a Pinyin engine; Pinyin conversion is implemented separately in this extension.

### TV Watch Surface

The extension replaces the desktop watch UI with a title overlay, independent progress bar, large controls and horizontal recommendations while retaining the original YouTube player, captions and account session. Settings delegate to the native player menu. Closing settings restores the selected control. Controls hide after five idle seconds during playback; progress navigation, recommendations, paused video and open panels stay visible. Disabling the extension restores the regular watch page. Up to twelve recommendations are read from already loaded page cards.

### Fullscreen and Playback

Opening a video enters a window-filling playback layout. Browser window fullscreen is managed separately by the background service worker; playback mode does not use the webpage Fullscreen API. The quick menu can appear over the video.

Automatic F11-style window fullscreen is enabled when the current YouTube tab detects a standard controller. It persists through searches, video navigation, refreshes, and B-button navigation. Disconnecting the controller, disabling automatic fullscreen, or disabling gamepad controls restores the previous normal or maximized window state. Fullscreen originally entered by the user is preserved.

Previous window states are stored in `chrome.storage.session`, allowing restoration across page navigation and background suspension. After full-page navigation, another controller button press may be needed for the browser to expose the Gamepad API; an initially empty snapshot is not treated as a disconnection.

### Navigation and Focus

- **Content:** Video cards are deduplicated. Native row containers identify video rows where available, with top-edge grouping as a fallback. Left/right follow the row's order. Up/down enter the adjacent row and restore its last selected video, or keep the preferred column on a first visit. Short rows do not erase the preferred column. Video links preserve row selection across DOM replacement; removed targets fall back by column. Category and route changes clear row memories. Navigation stays within a section while a suitable target exists.
- **Sidebar:** Up/down move between entries, right enters content, and up from the top can enter the header.
- **Header:** Left/right move between items; down enters content or the player.
- **Player:** Browsing mode navigates control buttons; playback mode uses the dedicated controls above.
- **Dialogs:** Opening a dialog selects its first available item and confines navigation and confirmation to it. Closing restores the previous external selection. Real YouTube dialog dismissal still needs hands-on verification.
- **Returning:** The current tab remembers the selected category, card keys and scroll position for the latest 30 routes. Returning from a video restores the cached InnerTube list, selected category, card focus and scroll position. Navigation-time scroll changes cannot overwrite the saved position. Restoration retries for up to five seconds while the custom interface renders; a missing card falls back to a surviving neighbor. API feeds preserve loaded cards and their next-page handles when returning. Continuation tokens stay in the InnerTube service; the extension grid requests the next page within 400px of its bottom without scrolling hidden native lists. Failed pages retain existing cards and retry the same continuation. Two consecutive pages without new videos pause automatic loading; the Load more button remains available.

The page stays still while the selected row is fully visible. When the row leaves the viewport, its top is aligned below the fixed search and category bars with a 16-pixel gap. Alignment is immediate to avoid measurement drift during held input. If no candidate is available, the current selection is retained. Selection transitions respect the system's reduced-motion preference.

Default input settings are a `0.35` stick deadzone, `350 ms` initial repeat delay, and `140 ms` repeat interval. Adjust them on the full settings page (Common, Gamepad, Display), opened from the quick menu or toolbar popup.

### Architecture

| File | Purpose |
| --- | --- |
| `manifest.json` | Manifest V3 configuration, YouTube matching, and script loading order |
| `gamepad.ts` | MAIN-world controller polling, standard mapping, deadzone, and held-input repeats; emits actions rather than clicking the page |
| `core.ts` / `navigation.ts` | Navigation core, directional rules, sections, focus, dialog scope, and visual overlays |
| `sites/youtube.ts` | YouTube data snapshots, selectors, media/search actions and native dialogs; receives policy via `createNavigationConfig(policy)` |
| `coordinator.ts` | Owns modes, route history, settings and action dispatch; connects the core, site adapter and watch surface |
| `watch.ts` | TV watch surface with independent controls, progress, horizontal recommendations and focus |
| `keyboard.ts` / `menu.ts` | On-screen keyboard, search interface, and Shadow DOM quick menu |
| `pinyin.ts` / `pinyin-data.ts` | Offline Pinyin candidates and dictionary data |
| `content.ts` | ISOLATED-world settings bridge and independent controller detection |
| `background.ts` | Browser window fullscreen and previous-state restoration |
| `popup.html` / `popup.js` / `popup.css` | Toolbar popup: enabled switch, connection status and full settings entry |
| `ui/theme.css` | Shared colors, fonts, radii, spacing and focus tokens; follows YouTube light/dark theme |
| `theater.css` | Large-screen layout styles |
| `scripts/` / `tests/` | Static checks and automated tests |

Settings flow from the full settings page and toolbar enabled switch through extension storage and the content-script bridge to the coordinator, which updates input, navigation and watch modules. Gamepad input emits actions to the navigation core, which executes injected ownership and dispatch policies. The core uses `shouldShowSelection({ scope })` to determine ring visibility and does not inspect concrete menu or watch globals. The watch surface receives data snapshots and commands through `connect()` and receives authoritative mode updates through `sync()`. Native video, recommendation and comment nodes stay inside the site adapter. The menu also uses injected ports for native search and media operations. The coordinator loads last and injects these interfaces. See [ARCHITECTURE.md](ARCHITECTURE.md) for port contracts and input priority. MAIN-world scripts are declared statically in the manifest instead of being injected through script tags. The page-side bridge does not accept setting writes; it can only forward a rate-limited request to open the fixed extension options page. Settings are persisted through the full settings page and toolbar enabled switch. Large-screen layout and automatic browser window fullscreen have independent switches in Display; legacy preferences initialize both switches without changing the previous behavior.

The architecture references [Couch Browser](https://github.com/SeeSharpSoft/couch-browser/blob/main/DEVELOPMENT.md), and navigation sections reference [js-spatial-navigation](https://github.com/luke-chang/js-spatial-navigation). The corresponding code is independently written.

### Development and Verification

```sh
node scripts/check.mjs
node --test tests/*.test.mjs
```

The first command validates the manifest, script syntax, and popup file. The second runs automated tests. These checks do not replace testing with real YouTube pages and physical controllers.

`tests/module-combinations.test.mjs` builds the current MAIN composition root with test-only inspection handles for DOM regressions, including focus, native layers, route changes and cleanup. `tests/bundled-runtime.test.mjs` loads production bundles in separate MAIN and ISOLATED worlds, replacing Chrome privileges and physical gamepad sampling, and checks communication, Vue pages and reinjection. Extension E2E tests use actual extension privileges. Run `npm ci`, then `npm run verify`; missing browser dependencies fail verification. Chrome is the default DOM-test browser. CI installs Chromium and sets `PLAYWRIGHT_CHANNEL=chromium`. After `npm run build`, `YTG_EXTENSION_ROOT=latest-release` makes artifact and extension tests load the independent release package. Skipped browser cases do not count as complete release verification.

Recommended manual checks:

- Navigate home and search results, open a video, and verify focus and scroll restoration on return.
- Test play/pause, seeking, volume, native control buttons, and progress-bar navigation.
- Open native settings submenus and check that B returns one layer at a time and restores control focus.
- Test English and Chinese search, history, editing, candidate selection, and submission.
- Toggle captions and verify unavailable actions show feedback when appropriate.
- Verify that menus confine navigation and that disabling the extension removes its selection overlay and stops page control.
- Change settings and refresh to confirm persistence; test automatic fullscreen and window restoration.
- Switch tabs or disconnect the controller and confirm held actions stop; reconnect and check controls resume.

### Data, Permissions, and Limitations

The extension declares the `storage` permission and does not require `tabs`. Content scripts match only `https://www.youtube.com/*`. Settings are saved in extension storage; recent searches, keyboard language, and learned Pinyin preferences are saved in YouTube's local storage in the current browser. Searches are submitted to YouTube, while Pinyin candidates are generated locally. Site scripts can read or alter these records and forge MAIN-world messages. Records are validated and bounded; page messages cannot write extension storage or request background operations. See [Trust boundaries](SECURITY.md) for the limits and production privacy requirements.

Only standard-mapped controllers are supported. Custom nonstandard mappings, dedicated Shorts controls, and browser tab switching are not supported yet. YouTube DOM changes and layout experiments may affect selectors, fullscreen styling, native controls, and settings menus. The website may reject synthetic clicks or keyboard events, and browser policies may restrict script-triggered playback. Compatibility with real YouTube pages and physical controllers still needs hands-on testing.

### Licensing

The Pinyin dictionary is derived from [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cc-cedict) and licensed under **CC BY-SA 4.0**. Preserve attribution and license information when redistributing it; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the source, snapshot, and transformations.

Independently written extension code is licensed under **MIT**; see [LICENSE](LICENSE). The dictionary and third-party assets remain subject to their respective licenses. Release packages include the code license and third-party notices.

### 独立视频播放页

视频作为全屏背景，顶部展示标题、频道和观看次数；下方是独立进度条及频道头像、说明、订阅、快退、播放、快进、点赞、点踩、评论、保存、字幕、设置按钮。播放按钮居中放大，进度条上方左侧显示当前时间、右侧显示总时长。默认只露出部分推荐卡片，下键进入推荐区后展开完整卡片。视频内容、字幕和原播放器设置仍由 YouTube 提供。

- 上键唤出控制栏，默认选中播放按钮。按钮区左右移动，上键进入进度条，下键进入推荐。进度条未处于调整状态时，再按上键收起面板，回到纯播放。各区保留自己的选择，返回按钮区恢复之前的按钮。
- 进度条先按 A 开始调整，左右调整 10 秒；A 结束调整并保留进度条焦点，B 先退出调整，再按 B 回按钮区。直播或未知时长不执行固定进度跳转。
- 推荐区左右选择，A 使用原视频链接播放，B / 上键回按钮区。连续播放推荐后退出视频，返回最初的列表；刷新后不保留这段浏览记录。
- 设置使用原播放器菜单，B 从子菜单回主菜单，再关闭设置并恢复设置按钮。不会因关闭设置而退出视频。
- 评论在右侧面板展示，视频缩小到左侧。进入视频后在后台预加载约 5 条评论（原站可能一次返回更多），达到数量或尝试 10 次后停止；切换页面、关闭功能或打开临时面板时停止后台加载。上下逐条阅读，长评论先滚动完整正文，A 展开已加载评论的回复，加载更多按钮触发原评论区继续加载。B 关闭并恢复评论按钮。当前不支持发表评论和评论排序；加载速度、回复数量与网站提供的数据有关。
- 控制栏在视频播放、无操作 5 秒后隐藏。暂停、推荐浏览、进度调整、功能面板和设置菜单打开期间保持显示。
- 关闭扩展或离开视频页后恢复原网站布局。

验证时需检查：默认推荐裁切及展开、进度区与按钮区焦点恢复、设置子菜单逐层返回、评论及回复读取、连续推荐播放后的列表返回。布局和动作可用浏览器模拟检查，实体手柄还需实测。

Focus restoration for temporary layers is centralized in `focus.ts`. Owners provide stable item keys, candidate descriptions and DOM focus operations. Closing a layer restores the original key, then a surviving neighbor in its original region, then an index fallback; an empty watch region returns to the play control. Route changes discard the old target and use the active page default. Nested layers restore their parent, and closing a lower layer cannot take focus from a higher menu.


自动隐藏与导航状态：控制栏按钮区域只有在视频播放中、空闲超过 5 秒、没有临时层且没有导航进行中时才收起。临时层包含说明、评论、快捷菜单、帮助和原生弹窗（含淡入阶段）；操作这些层时重置空闲计时。推荐刷新保留目标，目标消失时回到控制栏，弹窗期间不抢焦点。关闭功能清理临时界面，重新开启从播放模式开始。

交互返回逐层关闭面板、回到控制栏与播放模式；页面返回独立处理浏览器历史。播放链仅在手柄准备的目标地址完成导航且确认恰好新增一个历史条目后累计深度。重复通知、同视频激活、取消、地址替换、未知历史新增及前进后退不增加深度；历史关系不确定时直接打开保存的来源列表，不按猜测的深度跳转。页面返回发起后锁定，收到导航完成、取消或错误才解除，popstate 本身不解除锁定。

### 交互状态机

交互规则集中在 `state-machine.ts` 的纯函数 `transition(state, event)` 中，统一管理播放模式、导航返回链、控制栏/进度/推荐区域、说明和评论面板、菜单、搜索入口及拼音和语言子状态。规则返回新状态和操作指令；播放、页面跳转、DOM 更新及焦点恢复由执行层完成。状态提交后冻结，避免多个模块直接修改同一字段。

输入优先级和逐层返回保持现有行为，真实 Escape 与手柄 B 都逐层返回。导航期间重复输入会被阻止；自动隐藏必须同时满足播放、空闲、控制栏区域和没有临时层等条件。`YTGamepadCoordinator.interactionState` 提供完整状态快照，纯转换可脱离网页重放和测试。


焦点与状态：当前页面保留侧栏底色；字幕、订阅、点赞等已开启状态显示勾选标记；手柄焦点使用外框，互不覆盖。滑块调整中使用黄色外框及操作提示，方向键只在调整中改变数值。搜索或设置关闭后恢复入口焦点；目标已移除时沿用同区域邻项与默认项的恢复规则。



### 右手单手操作预设

在完整设置或页面内设置的“手柄与按键”中开启“右手单手操作预设”。右摇杆取代左摇杆移动焦点，十字键仍可使用；按 Xbox 物理位置，A 确认、B 返回、X 播放/暂停、Y 搜索、RB 打开快捷菜单，原 RB 快进移至 Menu/Start。提示图标继续跟随手柄型号。主页、播放、搜索和设置共用此预设，音量、进度及搜索键盘功能可通过右摇杆选择界面控件完成。

预设默认关闭，不覆盖原有主页与播放页自定义绑定。开启时按键编辑暂时禁用，关闭立即恢复原有绑定和左摇杆导航。切换模式、切换页面或失焦后需先松开按键并让当前导航摇杆回中，避免误操作。评论沿用既有方向导航，尚未增加右摇杆独立连续滚动或用户自定义组合键。

YouTube.js 的已接入能力与可扩展接口见 [接口接入清单](YOUTUBE_API.md)。
