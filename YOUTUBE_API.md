# YouTube.js 接口与项目接入

核对版本：项目锁定的 `youtubei.js@18.1.0`。接口是否可用还取决于当前登录状态及 YouTube 返回的数据。

本项目采用“页面会话与同源请求 → YouTube.js 解析 → 有界数据快照 → Vue”的方式。部分数据通过现有请求适配器直接请求 InnerTube，再交给库解析，并不逐项调用下表中的高层方法。Cookie、认证头、账号选择和 continuation 留在 MAIN；界面不传任意 API 地址或请求体。

## 已有功能

| 功能 | 库接口 / 解析能力 | 当前接入 |
| --- | --- | --- |
| 首页、搜索、订阅、历史 | `getHomeFeed`、`search`、`getSubscriptionsFeed`、`getHistory` | 同源 browse/search 请求与库卡片解析；首屏、分类、分页不读取页面启动 JSON |
| 频道分类、排序、分页 | `getChannel`、Channel 标签及排序节点 | 已由现有频道适配器处理 |
| 视频及 Shorts 详情 | `getInfo`、`getBasicInfo`、`getShortsVideoInfo` | 当前详情服务复用 player/next；Shorts 标题、作者只使用接口快照，缺失时显示通用占位 |
| 推荐、队列 | VideoInfo / next 节点 | 已通过 next 接口及库解析处理 |
| 评论、回复分页 | `getComments`、Comments continuation、线程回复 | 已接入现有评论面板 |
| 点赞、点踩、订阅 | `interact.like/dislike/removeRating/subscribe/unsubscribe` | 已接入；确认成功才更新状态，账号写入不自动重试 |
| 保存到已有播放列表 | `PlaylistAddToOption` 的增删 endpoint | 已接入选择面板；界面只得到临时句柄 |
| 账号资料 | `account.getInfo(true)` | 已接入账号视图 |
| 侧栏 | `getGuide()` | 已接入，失败保留内置入口 |

搜索栏和手柄键盘不再读写原生搜索框或点击原生提交按钮。输入只保存在扩展自己的界面中；提交生成有界、经过校验的搜索 endpoint，优先交给原站路由，路由不可用时导航至同源搜索地址，结果继续走 API。语音入口仍委托原生语音功能。顶部首页入口同样通过已校验的路由打开。

## 可以进一步新增的功能

这些接口已在库中提供，但下列新增交互尚未在本项目启用。

| 可新增功能 | 接口 | 接入时需要处理 |
| --- | --- | --- |
| 订阅频道目录 | `getChannelsFeed()` | 频道卡片、分页与打开频道 |
| 我的播放列表目录 | `getPlaylists()`、`getPlaylist(id)` | 聚合目录路由、无首视频的列表卡片、空列表；已有单个播放列表的视频分页不等于完整目录 |
| 搜索联想 | `getSearchSuggestions(query)` | 防抖、取消旧查询、输入法组合态与请求方式适配 |
| 通知列表及未读数量 | `getNotifications()`、`getUnseenNotificationsCount()` | 登录、分页、通知目标验证 |
| 字幕文本面板 | `VideoInfo.getTranscript()`、`TranscriptInfo.selectLanguage()` | 字幕是否存在、语言选择与按时间跳转；该接口读取字幕文本，不控制原生字幕开关 |
| 新建及管理播放列表 | `playlist.create/setName/setDescription/addVideos/removeVideos` | 对应编辑界面、目标列表验证与写入成功确认；删除不默认开放 |
| 发布评论、回复、评论评价 | `interact.comment`、`CommentView.reply/like/unlike` | 编辑与确认界面、重复提交保护 |
| 评论翻译 | `interact.translate()` | 目标语言、翻译状态与原文保留 |
| 频道通知偏好 | `interact.setNotificationPreferences()` | 已订阅状态以及全部 / 个性化 / 关闭选择 |

播放、暂停、进度、音量、原生字幕开关和画质菜单继续使用当前视频元素或播放器控件；布局、焦点、弹层与播放就绪检查也保留在页面端。没有用流地址接口替换原生播放管线。

参考：[Innertube 接口](https://ytjs.dev/api/classes/Innertube)、[项目源码](https://github.com/LuanRT/YouTube.js)。本地安装包的类型声明用于核对锁定版本的具体方法。
