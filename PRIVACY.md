# YouTube Gamepad 隐私政策 / Privacy Policy

更新日期 / Last updated: 2026-10-05  
适用版本 / Version covered: 0.2.0  
开发者 / Developer: 28TheCat

## 简体中文

### 1. 适用范围

本政策说明 YouTube Gamepad 浏览器扩展如何处理数据。扩展用于在桌面版 www.youtube.com 上通过手柄浏览页面、控制视频和输入搜索内容。扩展无需单独注册账号。YouTube、浏览器和扩展商店本身的数据处理受各自政策约束。

### 2. 本机处理的数据

| 数据 | 用途与保存方式 |
| --- | --- |
| 功能开关、画面设置、快捷键、摇杆参数及界面主题 | 保存在扩展的 chrome.storage.local 中，用于恢复偏好；不使用 chrome.storage.sync。 |
| 最近搜索 | 保存最近 5 条通过扩展提交的搜索，每条最多保存 256 个字符；存储于 www.youtube.com 的 localStorage，键名为 ytg-recent-searches。 |
| 键盘语言和拼音学习 | 在同一网站 localStorage 中保存 ytg-keyboard-language 和 ytg-pinyin-ranking；学习记录最多保留 500 项，用于排列离线候选。 |
| 手柄输入和设备信息 | 通过浏览器 Gamepad API 读取连接状态、设备标识、标准映射、按钮和摇杆，用于执行操作及选择按键提示；不将原始输入序列或设备标识作为分析数据上传。 |
| 当前页面内容和状态 | 在内存中读取页面地址、视频标题、频道、说明、评论、推荐、图片地址及播放状态等必要内容，用于当前界面显示、导航和播放控制；不建立开发者端浏览记录。 |
| 窗口及导航状态 | 在内存中处理焦点、滚动和导航状态；扩展拥有的全屏窗口状态使用 chrome.storage.session 保存，以便恢复窗口。 |
| 故障诊断 | 在扩展本地存储中保留时间、扩展版本、模块、操作、错误名称、错误原因、堆栈和有限的界面状态摘要。最多 100 条，序列化记录不超过 32,768 个字符，超限移除最早记录。 |

网站 localStorage 不属于扩展私有存储，YouTube 同源脚本可以读取或修改其中的数据。扩展不对这些本地数据额外加密，因此请勿把搜索历史或诊断文件视为保密保险箱。

诊断模块不主动采集视频标题、评论或完整页面地址作为字段，会截断错误文本并替换其中的 HTTP/HTTPS 网址。但错误消息可能包含运行环境提供的其他内容；分享前请自行检查导出文件。

### 3. 网络、共享与有限使用

扩展没有开发者运营的数据接收服务，不自动向 28TheCat 上传搜索历史、设备信息或诊断记录，不包含第三方广告、分析或跟踪 SDK，也不出售数据或将数据用于广告画像。

这不表示使用扩展时完全没有网络访问：输入会同步到 YouTube 原生搜索框，YouTube 可能按网站自身行为处理输入；提交搜索、播放、打开视频以及你执行的其他网站操作仍由 YouTube 处理。扩展界面显示的缩略图、头像等可能沿用页面资源地址或请求 YouTube 图片服务器，例如 i.ytimg.com。此类请求会由相应服务按其规则接收和处理。

拼音字典和扩展程序代码随安装包提供，不从远程服务器下载并执行程序代码。手柄事件和设置会在扩展脚本与页面脚本之间传递，用于提供当前功能；它们并非与页面隔离的秘密信息。

本扩展仅为上述用户可见功能和故障排查使用数据，不将数据用于信用评估、借贷决策、广告定向或与核心功能无关的用途。本扩展的数据使用遵守 Chrome Web Store 用户数据政策，包括有限使用要求。

### 4. 导出与反馈

在完整设置（All settings）的帮助与诊断（Help & diagnostics）中主动选择导出时，扩展会在本机生成 JSON 文件，不会自动发送给开发者。你可以先检查文件，再决定是否分享。任何公开反馈平台上提交的信息都可能公开，请勿提交密码、令牌或不希望公开的个人信息。

### 5. 保存时间与删除

- 设置保留到你修改、清除扩展数据或卸载扩展；恢复快捷键默认值只恢复快捷键，不会清空所有其他数据。
- 可在 All settings → Help & diagnostics 清空故障记录。已导出的 JSON 文件需要在下载目录另行删除。
- 最近搜索和拼音学习按上述数量上限保留，没有按时间自动到期机制。卸载扩展不会自动清除 YouTube 网站 localStorage。
- 如要清除网站本地数据，可通过浏览器的网站数据管理清除 www.youtube.com 的数据；这也可能清除其他 YouTube 偏好并使你退出登录。高级用户可关闭其他 YouTube 标签页后，在网站存储工具中仅删除 ytg-recent-searches、ytg-keyboard-language、ytg-pinyin-ranking，再刷新页面。
- 全屏会话状态会在扩展恢复窗口等操作时移除，并随浏览器的扩展会话存储生命周期清除。

开发者没有一份可供查询或删除的自动上传数据副本。对于你主动发送到外部反馈平台的内容，应使用该平台的编辑或删除机制。

### 6. 联系与变更

开发者为 28TheCat。隐私问题请通过本扩展商店详情页列出的支持入口联系；目前不提供联系邮箱。政策发生变化时，本文件将更新日期和内容；后续版本若改变数据处理方式，将同步更新商店披露。

## English

### 1. Scope

This policy describes data handling by the YouTube Gamepad browser extension, developed by 28TheCat. The extension provides controller navigation, video controls, and search input on the desktop website at www.youtube.com. It does not require a separate extension account. YouTube, your browser, and the extension store have their own data practices and policies.

### 2. Data processed on your device

| Data | Purpose and storage |
| --- | --- |
| Feature toggles, display preferences, shortcuts, stick parameters, and theme | Stored in chrome.storage.local to retain settings. The extension does not use chrome.storage.sync. |
| Recent searches | The last five searches submitted through the extension, up to 256 stored characters each, in www.youtube.com localStorage under ytg-recent-searches. |
| Keyboard language and Pinyin learning | Stored in the same website's localStorage under ytg-keyboard-language and ytg-pinyin-ranking. Up to 500 learned ranking entries help order offline candidates. |
| Controller input and device information | Connection state, device identifier, standard mapping, buttons, and axes are read through the browser Gamepad API to operate the interface and choose button hints. Raw input streams and identifiers are not uploaded as analytics. |
| Current page content and state | Relevant URLs, video titles, channel information, descriptions, comments, recommendations, image URLs, and playback state are processed in memory for display, navigation, and playback controls. No developer-side browsing history is created. |
| Window and navigation state | Focus, scrolling, and navigation state are handled in memory. Extension-owned fullscreen state uses chrome.storage.session so that windows can be restored. |
| Error diagnostics | Timestamps, extension version, module, operation, error name, error message, stack, and a limited UI state summary are stored locally by the extension. Records are capped at 100 entries and 32,768 serialized characters; the oldest records are removed when necessary. |

Website localStorage is not private extension storage. Scripts on the YouTube origin can read or modify it. The extension does not add its own encryption to local data; search history and diagnostic exports should not be treated as confidential storage.

The diagnostic module does not deliberately collect video titles, comments, or full page URLs as fields. It truncates error text and replaces HTTP/HTTPS URLs. Error messages may nevertheless contain other information supplied by the runtime. Review exported files before sharing them.

### 3. Network activity, sharing, and limited use

The extension has no developer-operated data collection service. It does not automatically upload searches, device information, or diagnostics to 28TheCat, contains no third-party advertising, analytics, or tracking SDK, and does not sell data or use it for advertising profiles.

Using the extension still involves network activity. Input is synchronized with YouTube's native search field, and YouTube may process it through its normal website behavior. Submitted searches, playback, navigation, and other website actions you initiate are handled by YouTube. Thumbnails and avatars may use page-provided resource URLs or YouTube image servers such as i.ytimg.com. These requests are handled by the respective services under their own policies.

The Pinyin dictionary and extension code are included in the installation package. The extension does not download and execute remote program code. Controller events and settings pass between extension scripts and page scripts to provide the current features; they are not secrets isolated from the page.

Data is used only for the user-facing features described above and troubleshooting, not for creditworthiness, lending, ad targeting, or unrelated purposes. The extension's use of data adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

### 4. Exports and feedback

Selecting the diagnostic export action in full settings creates a JSON file on your device. The extension does not send it to the developer. Review the file and decide whether to share it. Information you submit to a public feedback platform may be public; do not include passwords, tokens, or personal information you do not want disclosed.

### 5. Retention and deletion

- Settings remain until changed, extension data is cleared, or the extension is uninstalled. Resetting shortcuts only resets shortcuts.
- Clear error records in full settings under Help and diagnostics. Delete previously exported JSON files separately from your downloads folder.
- Recent searches and Pinyin learning follow the limits above and have no automatic time-based expiry. Uninstalling the extension does not automatically remove YouTube localStorage.
- To delete website-local data, clear data for www.youtube.com using your browser's site-data controls. This may also clear other YouTube preferences and sign you out. Advanced users can close other YouTube tabs, remove only ytg-recent-searches, ytg-keyboard-language, and ytg-pinyin-ranking in the site's storage tools, and reload the page.
- Fullscreen session records are removed during operations such as restoring windows and cleared according to the browser's extension session-storage lifecycle.

The developer has no automatically uploaded copy of these records to retrieve or delete. Use the relevant platform's editing or deletion controls for feedback you voluntarily submit outside the extension.

### 6. Contact and changes

The developer is 28TheCat. For privacy questions, use the support entry listed on this extension's store page. No contact email is currently provided. Changes to this policy will be reflected in the date and text of this file. Store disclosures will be updated if future versions change data handling.
