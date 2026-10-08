# 动作目录

`actions.js` 是功能定义的唯一目录，独立于手柄型号、实体按钮和用户绑定。`bindings.js` 只负责默认按钮及绑定校验，从目录读取动作名称。设置页、播放器工具栏和快捷菜单共用目录中的名称；播放器从目录读取默认快进和音量步长。

## 基础功能

| 分类 | 动作 ID | 功能 |
| --- | --- | --- |
| 界面导航 | `up` / `down` / `left` / `right` | 上 / 下 / 左 / 右 |
| 界面导航 | `confirm` / `back` | 确认 / 返回或关闭当前层 |
| 播放 | `playPause` | 播放 / 暂停 |
| 进度 | `seekBack` / `seekForward` | 快退 / 快进，默认 10 秒 |
| 进度 | `adjustProgress` | 进入进度调整 |
| 声音 | `volumeDown` / `volumeUp` | 音量减 / 加，默认 5 个百分点 |
| 声音 | `mute` | 静音 / 取消静音 |
| 字幕 | `captions` | 显示 / 隐藏字幕 |
| 视频信息 | `description` / `comments` / `channel` | 打开简介 / 评论 / 频道 |
| 视频互动 | `like` / `dislike` / `subscribe` | 点赞 / 点踩 / 订阅，再次执行取消 |
| 视频互动 | `save` | 打开 YouTube 收藏列表 |
| 页面操作 | `settings` | 打开播放器设置 |
| 页面操作 | `search` / `help` | 打开搜索 / 打开或关闭快捷菜单 |
| 搜索键盘 | `keyboardSymbols` / `keyboardCandidates` | 切换符号 / 候选词 |

`pause` 是返回流程使用的内部动作，默认不出现在公开目录中。菜单的“完整设置”和“返回”仍是菜单自身的局部命令，不作为新的可绑定基础功能。

## 目录接口

- `YTGamepadActions.get(id)`：查找动作，未知 ID 返回 `undefined`。
- `YTGamepadActions.list({ group, context, includeInternal })`：按分类和场景筛选，默认隐藏内部动作。
- `YTGamepadActions.groups`：分类名称。
- 每个动作包含 `id`、`label`、`group`、`target`、`contexts`、`repeat`；进度和音量动作还包含 `parameter`，界面可使用 `controlLabel` / `menuLabel`。

场景为 `browse`（页面浏览）、`watch`（视频页）、`menu`（快捷菜单）、`search`（搜索键盘）。`contexts` 描述动作本身的适用场景；原有搜索键盘对某些输入的复用仍由输入归属规则处理，不将播放动作定义为搜索动作。

`target` 记录现有执行入口，不直接调用页面。菜单、弹窗、面板优先级及 `handled` / `blocked` / `pass` 规则继续由协调层和状态机处理。目录中包含某项功能不等于它已获得直接手柄快捷入口；例如评论和点赞目前仍可通过工具栏执行。

`repeat` 记录动作的长按策略：切换和打开类为 `once`，方向、进度、音量为 `repeat`。本次只统一目录，尚未扩大播放器长按行为或增加步长设置。自定义键盘快捷键的录入、保存和执行也尚未实现，后续应作为独立的绑定类型接入。
