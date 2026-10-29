# YouTube.js 接口与项目接入

核对版本：项目锁定的 `youtubei.js@18.1.0`。接口是否可用还取决于当前登录状态及 YouTube 返回的数据。

本项目统一使用 GitHub 项目 LuanRT/YouTube.js（`youtubei.js@18.1.0`）执行数据接口请求和解析，不使用 YouTube Data API v3，也不保留绕过库的业务请求分支。首页、搜索、频道、推荐、账号、侧栏、评论、翻译、视频详情及点赞、订阅、收藏均经过 `youtube-request.ts` 中的 YouTube.js Session / Actions / HTTPClient。高层方法和解析游标复用同一个请求入口。

请求流程为“页面会话 → YouTube.js 执行与解析 → 有界数据快照 → Vue”。YouTube.js 仍访问 YouTube 的 InnerTube 服务器；页面传输适配器只负责同源发送、当前账号认证、取消、超时及响应校验。读取遇到临时网络错误或 502/503/504 最多重试一次；账号写入不自动重试。Cookie、认证头、账号选择和 continuation 留在 MAIN；不把 Cookie 传给库，界面不传任意 API 地址或请求体。

## 已有功能

| 功能 | 库接口 / 解析能力 | 当前接入 |
| --- | --- | --- |
| 首页 | `getHomeFeed()` | 首页“全部”首屏直接调用高层方法；分类及续页复用同源 browse 请求与库解析，保留返回恢复 |
| 订阅动态 | `getSubscriptionsFeed()` | “全部”首屏直接调用高层方法；分类及续页保留同源 browse 请求与库解析，支持返回恢复 |
| 观看历史 | `getHistory()` | “全部”首屏直接调用高层方法；分类及续页保留同源 browse 请求与库解析，支持返回恢复 |
| 搜索 | `search(query)` | 首屏及筛选结果调用高层方法；保留分享地址和接口分类中的原始筛选参数，续页沿用同源 search 请求与库解析及返回恢复 |
| 频道分类、排序、分页 | `resolveURL()`、`getChannel()`、`ChannelListContinuation.getContinuation()`、`call()` | 频道首屏和标签调用高层方法；排序通过公开 endpoint API 处理部分响应，续页恢复库游标；账号认证、取消和返回恢复沿用现有机制 |
| 视频及 Shorts 详情 | `getInfo`、`getBasicInfo`、`getShortsVideoInfo` | 当前详情服务复用 player/next；Shorts 标题、作者只使用接口快照，缺失时显示通用占位 |
| 推荐、队列 | VideoInfo / next 节点 | 已通过 next 接口及库解析处理 |
| 评论、回复分页 | `getComments`、Comments continuation、线程回复 | 已接入现有评论面板 |
| 点赞、点踩、订阅 | `interact.like/dislike/removeRating/subscribe/unsubscribe` | 已接入；确认成功才更新状态，账号写入不自动重试 |
| 保存到已有播放列表 | `PlaylistAddToOption` 的增删 endpoint | 已接入选择面板；界面只得到临时句柄 |
| 账号资料 | `account.getInfo(true)` | 已接入账号视图 |
| 侧栏 | `getGuide()` | 已接入，失败保留内置入口 |
| 搜索建议 | `getSearchSuggestions(query)` | 已接入顶部搜索框及手柄键盘；库构建请求并解析响应，同源传输保留取消、超时及长度限制 |
| 播放列表目录及单个列表 | `getPlaylists()`、`getPlaylist(id)`、`Feed/Playlist.getContinuation()` | 首屏及续页统一调用高层方法；由保存的 token 恢复库分页游标，保留目录卡片、空列表及返回恢复机制 |

搜索栏和手柄键盘不再读写原生搜索框或点击原生提交按钮。输入只保存在扩展自己的界面中；提交生成有界、经过校验的搜索 endpoint，优先交给原站路由，路由不可用时导航至同源搜索地址，结果继续走 API。语音入口仍委托原生语音功能。顶部首页入口同样通过已校验的路由打开。

搜索建议使用 YouTube.js 的 `getSearchSuggestions()` 构建参数及解析响应。它属于 completion 服务，传输适配器将库生成的固定地址映射到同源 `/complete/search`，浏览器负责凭据，不向库传递 Cookie。该只读服务在搜索界面侧使用仅含语言和地区的 Session，不经过 InnerTube 的 POST 请求入口。输入防抖为 250 毫秒，旧请求及关闭后的请求会取消；空输入无返回时显示“暂无搜索建议”。

## 可以进一步新增的功能

这些接口已在库中提供，但下列新增交互尚未在本项目启用。

| 可新增功能 | 接口 | 接入时需要处理 |
| --- | --- | --- |
| 订阅频道目录 | `getChannelsFeed()` | 频道卡片、分页与打开频道 |
| 通知列表及未读数量 | `getNotifications()`、`getUnseenNotificationsCount()` | 登录、分页、通知目标验证 |
| 字幕文本面板 | `VideoInfo.getTranscript()`、`TranscriptInfo.selectLanguage()` | 字幕是否存在、语言选择与按时间跳转；该接口读取字幕文本，不控制原生字幕开关 |
| 新建及管理播放列表 | `playlist.create/setName/setDescription/addVideos/removeVideos` | 对应编辑界面、目标列表验证与写入成功确认；删除不默认开放 |
| 发布评论、回复、评论评价 | `interact.comment`、`CommentView.reply/like/unlike` | 编辑与确认界面、重复提交保护 |
| 评论翻译 | `interact.translate()` | 目标语言、翻译状态与原文保留 |
| 频道通知偏好 | `interact.setNotificationPreferences()` | 已订阅状态以及全部 / 个性化 / 关闭选择 |

播放、暂停、进度、音量、原生字幕开关和画质菜单继续使用当前视频元素或播放器控件；布局、焦点、弹层与播放就绪检查也保留在页面端。没有用流地址接口替换原生播放管线。

参考：[Innertube 接口](https://ytjs.dev/api/classes/Innertube)、[项目源码](https://github.com/LuanRT/YouTube.js)。本地安装包的类型声明用于核对锁定版本的具体方法。
