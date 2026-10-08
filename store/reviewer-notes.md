# 审核资料 / Reviewer notes

## Single purpose / 单一用途

Enable controller-based navigation, video playback control, and search on the desktop YouTube website. The on-screen keyboard, controller mappings, and TV-style interface support this single purpose.

让用户在桌面版 YouTube 网站通过手柄浏览页面、控制视频并搜索内容；屏幕键盘、按键设置和大屏界面服务于同一用途。

## Permissions / 权限说明

**storage**: Saves local preferences (enable state, display options, controller bindings, deadzone and repeat timing), local bounded error diagnostics, and temporary session state used to restore windows after extension-initiated fullscreen. No cloud synchronization.

**https://www.youtube.com/***: Manifest content-script matching only. Required to read the relevant current page elements, manage navigation and focus, synchronize search input, render controller UI, and operate the existing player. The extension does not request access to all websites, browser history, cookies, or authentication credentials. The match pattern is not a separate host_permissions entry in this manifest.

**Remote code**: No. JavaScript and the Pinyin dictionary ship inside the extension. Website thumbnails and avatars are content resources, not executable extension code.

## Data disclosure / 数据披露准备

不要因为“没有开发者服务器”就勾选完全不处理数据。当前代码会处理网页内容、当前 YouTube 路由、搜索输入、手柄操作和本地诊断。提交时按商店后台当时的类别定义核对 Website content、Web history、User activity 等相应类别，并明确说明本机处理范围；不代表读取整个浏览器历史。

声明应与根目录 PRIVACY.md 一致。仅有本地文件不够，隐私政策必须先发布成访客无需登录即可访问的 URL。支持链接也必须可用。开发者名称为 28TheCat，邮箱按要求留空。

## Test instructions / 测试说明

1. Use a desktop Chromium-based browser with this extension enabled. No separate extension account, payment, or test credentials are required. YouTube's own content/access restrictions still apply.
2. Open https://www.youtube.com/ and connect a physical controller that the browser reports with Gamepad API mapping "standard". Click the page and press a controller button.
3. The extension deliberately stays inactive without a compatible connected controller. This is expected behavior, not an installation failure. Nonstandard mappings are ignored.
4. Use the D-pad or left stick to move focus and the confirm button to open a video. Default Xbox-style hints use A to confirm and B to go back; other devices show corresponding physical positions.
5. Open the quick menu with Start. Test play/pause, seeking, volume, and captions on a video that supports them. Use the search keyboard, switch to Chinese Pinyin, and choose a candidate.
6. Open all settings from the toolbar popup. Change a controller shortcut or deadzone, refresh YouTube, and verify the setting persists. Settings, menus, playback controls, and extension prompts are in English. Chinese Pinyin input remains available.
7. Disable controller operation or disconnect the controller. The native YouTube interface should return. Automatic fullscreen can be disabled in display settings.
8. Diagnostics can be exported or cleared in full settings under “Help & diagnostics”. Export saves a local JSON file and does not send it to the developer.

## 官方参考（核对日期：2026-10-04）

- [Chrome 商店发布流程](https://developer.chrome.com/docs/webstore/publish)
- [Chrome 商店图片规格](https://developer.chrome.com/docs/webstore/images)：128×128 PNG 图标、440×280 小宣传图、至少一张 1280×800 或 640×400 截图。
- [Chrome 隐私字段](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [Chrome 用户数据 FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)：仅在本地处理的数据也需要披露。
- [Edge 发布流程](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)：提交前按 Partner Center 当时的字段和素材要求复核。
