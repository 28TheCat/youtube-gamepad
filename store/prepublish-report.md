# YouTube Gamepad 发布前检查报告

## 当前工作区专项复核（2026-10-27）

以下结果来自本次工作区构建的 `dist/`，不是下方 2026-10-05 候选 ZIP 的重签收。历史失败只描述当时快照；本次仅复核四项关联场景，没有重跑完整自动化或实体手柄验收。

构建命令：`npm run build:extension`，通过。浏览器：Playwright Chromium 151.0.7922.34，加载实际扩展并使用模拟手柄；联网项访问真实 YouTube。

| 原报告场景 | 本次结果 | 证据与边界 |
| --- | --- | --- |
| 自定义快捷键跨扩展环境同步 | 通过 | `custom controller shortcuts cross extension worlds and survive reload`；包含修改绑定、提示同步及刷新持久化 |
| 切换标签后的隐藏状态 | 未通过，失败位置已变化 | `virtual controller traverses both worlds: fullscreen, hidden tab, disconnect and reconnect`；已通过隐藏状态等待和选择未移动检查，在 `tests/extension-e2e.test.mjs:265` 检查输入模式时实际为 `gamepad`、预期 `mouse`。单独复测仍失败；其后的断连重连检查未执行，尚需排查产品行为与测试预期 |
| Escape 退出浏览器全屏 | 通过 | `trusted Escape exits browser fullscreen without navigating or disconnecting the controller`；本项通过不等同于全部全屏生命周期均通过 |
| 联网设置同步 | 未通过 | `live YouTube retains storage bridge after refresh and stays inactive without a controller`；仍在 `tests/youtube-live.test.mjs:28` 等待 `liveSettings.enabled === false` 超时，尚未进入刷新断言。不能仅凭此断定存储写入失败，需区分设置传播与测试观测通道 |

复现命令：

```powershell
node --test --test-concurrency=1 --test-name-pattern="custom controller shortcuts|virtual controller traverses|trusted Escape" tests/extension-e2e.test.mjs
node --test --test-name-pattern="virtual controller traverses" tests/extension-e2e.test.mjs
node --test --test-name-pattern="live YouTube retains" tests/youtube-live.test.mjs
```

本地日志：`output/playwright/docs-recheck-extension-2026-10-27.txt`、`output/playwright/docs-recheck-visibility-2026-10-27.txt`、`output/playwright/docs-recheck-live-2026-10-27.txt`。前三项合计 2 通过、1 失败；联网项 1 失败；隐藏状态单独复测为同一失败，不计作新增场景。

本次没有核验公开隐私政策、支持入口、商店素材或发布包完整性；这些项目继续保留下方历史状态，不作为当前事实或通过证据。

## 播放参数与短视频入口复核（2026-10-27）

本节对应随后新增的播放参数设置及短视频字幕、清晰度、订阅入口，验证对象是当前工作区构建的 `dist/`。

- 播放参数相关的桥接、安全校验、设置模型、播放模型、单次及长按快进、音量：76 项通过。日志：`output/playwright/playback-parameters-targeted-2026-10-27.txt`。
- 实际扩展及 Vue 界面专项：5 项通过，覆盖完整设置保存／范围校验／刷新、页面内设置与完整设置同步及手柄焦点、动态快进秒数标签、短视频参数实时更新与边界限制，以及短视频字幕／清晰度／订阅／通知／逐层返回。浏览器为 Chromium 151.0.7922.34，媒体及接口使用测试夹具，未代替真实网站或实体手柄签收。
- 全量 `npm test`：591 项，584 通过、7 失败。失败分布在 `tests/browse.test.mjs`（2 项）、`tests/card-visibility.test.mjs`（1 项）、`tests/client-home.test.mjs`（1 项）和 `tests/fallback.test.mjs`（3 项）。本次未判定其原因或是否为既有问题；不能将专项通过视为全量通过。完整日志：`output/playwright/playback-parameters-unit-2026-10-27.txt`。

界面专项复现命令：

```powershell
node --test --test-concurrency=1 --test-name-pattern="playback parameter|Shorts More|shared action buttons" tests/inline-settings-vue.test.mjs tests/settings-pages.test.mjs tests/shorts-extension.test.mjs tests/playback-vue.test.mjs
```

## 历史候选包检查（2026-10-05）

检查日期：2026-10-05（Asia/Shanghai）  
开发者：28TheCat  
候选版本：0.2.1  
结论：**商店素材已准备；候选扩展包静态检查和完整性通过，功能检查尚未全部通过，暂不建议提交审核。**

## 固定版本与证据

工作区在检查期间发生其他代码改动，因此本次最终检查使用独立的固定源码快照：

`output/prepublish-snapshot-8e1Upi/`

候选包由该快照构建，商店截图也使用该包加载实际扩展。构建后核对 97 个运行文件，快照与候选包内容相符。工作区之后发生的变化不包含在此候选包中，也不属于本报告的通过范围。

候选 ZIP：`output/store/youtube-gamepad-0.2.1-candidate.zip`  
SHA-256：`98AD69C4F3D82097C13974B5ABEE56A9CF23405C308E088C7776753764D3768E`

ZIP 根目录有 manifest.json；逐项解压读取并计算哈希，与构建清单中的 97 个文件全部一致。开发依赖、测试、浏览器配置、截图和诊断文件没有混入扩展 ZIP。

## 检查结果

| 项目 | 结果 | 证据与范围 |
| --- | --- | --- |
| 清单、加载顺序、脚本语法及样式同步 | 通过 | 33 个 JavaScript 文件；Manifest V3 与样式检查通过 |
| 类型与接口契约 | 通过 | TypeScript 检查通过 |
| 完整自动化验证 | 未全部通过 | 276 项：273 通过、3 失败，0 跳过；包括单元、构造页面浏览器和实际 MV3 扩展回归 |
| 构建及发布包完整性 | 通过 | 97 个运行文件，ZIP 内容与 SHA-256 清单一致 |
| 联网 YouTube 回归 | 未通过 | 1 项失败：等待页面设置同步消息超时，不能签收刷新后的设置桥接 |
| 截图中的真实扩展界面 | 已检查 | Chromium 151.0.7922.34，实际安装候选包；真实 YouTube 搜索、视频页面及扩展设置页，模拟标准 Xbox 手柄输入 |
| 图片规格及视觉检查 | 通过 | 图标 128×128；宣传图 440×280；3 张截图各 1280×800，已逐张查看 |
| 开发者与文案 | 已准备 | 署名 28TheCat，邮箱留空；中文、英文商店介绍及中英文隐私政策 |
| Chrome / Edge 与实体手柄 | 未执行 | 自动化 Chromium 与模拟输入不能替代品牌浏览器及实体手柄验收 |
| 公开隐私政策 URL | 待补 | 已生成静态网页，尚未公开发布 |
| 公开支持入口 | 待补 | 候选仓库地址对未登录访问返回 404；API 查询也受到速率限制，不能当作已验证的公共支持入口 |

## 未通过项

以下为实际失败证据，不把测试失败直接等同于已确认的真实浏览器产品缺陷。提交前需要查明原因、修复产品或测试环境，并对同一候选包重新验证。

1. **自定义快捷键跨扩展环境同步**：更改搜索快捷键后，等待页面提示从 Y 更新为 Select 超时。对应 `tests/extension-e2e.test.mjs:78`。独立复查该项仍超时。
2. **切换标签后的隐藏状态**：模拟手柄场景中，新标签激活后等待原页 `document.hidden` 超时。对应 `tests/extension-e2e.test.mjs:111`。需要核对 headless 标签可见性行为及实际页面的失焦保护。
3. **Escape 退出浏览器全屏**：浏览器窗口未在 15 秒内恢复 normal 状态。对应 `tests/extension-e2e.test.mjs:145`。需要检查可信键盘事件在两个执行环境之间的传递与全屏恢复。
4. **联网设置同步**：真实 YouTube 上关闭功能后，等待观测到的 `liveSettings.enabled === false` 超时。对应 `tests/youtube-live.test.mjs:28`。该联网测试未完成后续刷新断言。

## 数据处理核对

- 只声明 storage 权限；内容脚本只匹配 https://www.youtube.com/*，没有申请全站访问或浏览历史 API 权限。
- 设置和诊断使用扩展本地存储，全屏恢复信息使用 session 存储。
- 最近搜索、键盘语言和拼音学习使用 YouTube 网站 localStorage，网站同源脚本能够访问；卸载扩展不会自动删除这些数据。
- 未发现开发者数据上传端点、广告分析 SDK 或远程执行的扩展程序代码。
- 搜索输入会同步给 YouTube，缩略图等可能访问 YouTube 图片服务器。文案没有宣称“完全无网络”。
- 隐私政策写明诊断容量、导出和删除方式，也提醒错误文本可能包含运行环境提供的信息。
- Chrome 官方要求仅本地处理的数据也如实披露，见 [用户数据 FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)。

## 素材清单

- `assets/icons/gamepad-128.png`：透明 PNG 图标，已接入清单及发布文件清单。
- `output/store/promo-440x280.png`：小宣传图；使用生成图标的高分辨率原图排版。
- `output/store/screenshots/01-search-keyboard.png`：屏幕键盘。
- `output/store/screenshots/02-video-controls.png`：播放控制、推荐卡片。
- `output/store/screenshots/03-controller-settings.png`：按键设置。
- `store/listing-zh-CN.md`、`store/listing-en.md`：可复制到商店后台的介绍。
- `PRIVACY.md`、`output/store/privacy-policy.html`：中英文隐私政策源文件和静态网页。
- `store/reviewer-notes.md`：单一用途、权限用途、数据披露提示和审核操作说明。

图片规格按 [Chrome 商店官方要求](https://developer.chrome.com/docs/webstore/images) 准备。Edge 提交时仍应在 Partner Center 核对当时的字段和素材要求。

## 日志

- `output/store/verification-results.txt`
- `output/store/build-results.txt`
- `output/store/youtube-live-results.txt`
- `output/store/extension-inventory.json`
- `output/store/artifact-validation.json`

当前没有进行商店上传、提交审核或公开部署。

