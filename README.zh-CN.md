# Codex Pet Desk

[English](README.md) | [中文](README.zh-CN.md)

一个轻量的跨平台桌宠外壳，用于加载兼容 Codex pet 格式的宠物包。

Codex pet 包使用以下结构：

```text
pet-name/
├── pet.json
└── spritesheet.webp
```

精灵图遵循 Codex 图集约定：`1536x1872`，8 列，9 行，每格 `192x208`，未使用格子保持透明。

## 功能

- 透明、置顶的桌面窗口。
- 加载 Codex `pet.json` 清单和 PNG/WebP 精灵图。
- 作为 Tauri 应用运行时，自动检测 `${CODEX_HOME:-$HOME/.codex}/pets/` 下安装的宠物。
- 支持标准 Codex 动画行：idle、方向移动、waving、jumping、failed、waiting、running、review。
- 不依赖图像处理库，直接由 WebView 渲染精灵图。
- 基于 Tauri 设计，可构建 Windows、macOS 和 Linux 版本。

## 运行

安装依赖：

```bash
npm install
```

启动桌面应用：

```bash
npm run tauri:dev
```

构建发布包：

```bash
npm run tauri:build
```

构建可嵌入网页的 widget：

```bash
npm run build:widget
```

widget 构建会生成 `dist-widget/codex-pet-widget.js`，用于普通 script 标签；
以及 `dist-widget/codex-pet-widget.es.js`，用于 ESM 导入。widget release
压缩包只包含这些 JavaScript bundle，宠物文件需要单独托管。

## 加载宠物

使用 `Open pet` 同时选择 `pet.json` 和其引用的精灵图；或者使用 `Open folder`
选择整个宠物包目录。把两个文件一起拖到窗口里也可以。

期望的 manifest 结构如下：

```json
{
  "id": "pet-name",
  "displayName": "Pet Name",
  "description": "One short sentence.",
  "spritesheetPath": "spritesheet.webp"
}
```

## Web Widget

Codex Pet Desk 也可以把 Codex pet 作为网页叠加层渲染。构建 widget 后，把生成文件复制到你的网站，即可在任意页面挂载：

完整浏览器 API 见 [docs/widget-api.zh-CN.md](docs/widget-api.zh-CN.md)。

```html
<script src="/codex-pet-widget.js"></script>
<script>
  const pet = CodexPet.mount({
    pet: "/pets/hachiroku/pet.json",
    position: "bottom-right",
    scale: 0.85
  });

  pet.say("任务已经完成。", { title: "Codex", state: "waving" });
  pet.setState("running");
</script>
```

widget 同时注册了 Web Component：

```html
<codex-pet src="/pets/hachiroku/pet.json" position="bottom-right" scale="1"></codex-pet>
<script type="module" src="/codex-pet-widget.es.js"></script>
```

支持的叠加层行为包括：加载 Codex pet manifest、精灵图动画状态、悬停 jumping、拖动移动、Ctrl+滚轮缩放、触摸双指缩放、移动端自动缩放和气泡提示。可以在
`CodexPet.mount(...)` 中设置 `autoScale: false`，或在 `<codex-pet>` 上设置
`auto-scale="false"`，让不同视口宽度下保持固定渲染尺寸。

### Cloudflare R2 托管

把生成的 widget bundle 和宠物文件上传到 R2。widget release 压缩包只包含
JavaScript 文件，因此宠物资源需要从宠物源目录单独复制：

```text
codex-pet/
├── codex-pet-widget.js
└── pets/
    └── hachiroku/
        ├── pet.json
        └── spritesheet.webp
```

普通 script 标签应使用 `dist-widget/codex-pet-widget.js` 这个 classic bundle：

```html
<script src="https://pet.api.fangbm.com/codex-pet/codex-pet-widget.js"></script>
<script>
  CodexPet.mount({
    pet: "https://pet.api.fangbm.com/codex-pet/pets/hachiroku/pet.json"
  });
</script>
```

如果上传的是 ESM bundle 或源码文件，请以 module 方式加载：

```html
<script type="module">
  import { mount } from "https://pet.api.fangbm.com/codex-pet/codex-pet-widget.js";

  mount({
    pet: "https://pet.api.fangbm.com/codex-pet/pets/hachiroku/pet.json"
  });
</script>
```

当页面和 `pet.api.fangbm.com` 不在同一个源时，需要为 R2 bucket 配置 CORS：

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": [],
    "MaxAgeSeconds": 3600
  }
]
```

### 自动上传 R2

`Full Build` 工作流可以在 `npm run build:widget` 后把最新 widget 文件同步到 R2。需要添加以下 GitHub repository secrets：

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

工作流默认上传到 bucket `codex-pet-desk`，前缀为 `codex-pet`。也可以通过 repository variables `R2_BUCKET` 或 `R2_PREFIX` 覆盖。默认情况下会上传：

```text
codex-pet/codex-pet-widget.js
codex-pet/codex-pet-widget.es.js
codex-pet/pets/<pet-name>/...
```

上传会覆盖同名文件，但不会删除 R2 中已有的额外文件。如果缺少任何必需的 R2 secret，release 构建会继续执行，并打印 notice，而不是失败。

## 许可证

代码使用 MIT License 授权。内置宠物 artwork 和 sprites 由
[ASSET_LICENSE.zh-CN.md](ASSET_LICENSE.zh-CN.md) 单独说明。
