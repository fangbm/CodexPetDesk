# Codex Pet Widget API

[English](widget-api.md) | [中文](widget-api.zh-CN.md)

Codex Pet Widget 可以在任意网页上渲染兼容 Codex pet 格式的宠物。它同时提供 classic 浏览器 bundle 和 ESM bundle。

## 文件

Release 中的 widget 压缩包只包含 JavaScript bundle：

```text
codex-pet-widget/
├── codex-pet-widget.js
└── codex-pet-widget.es.js
```

宠物资源需要单独托管。除非 `spritesheetPath` 是绝对 URL，否则 pet manifest 应指向与 manifest 同目录的精灵图：

```text
codex-pet/
├── codex-pet-widget.js
└── pets/
    └── hachiroku/
        ├── pet.json
        └── spritesheet.webp
```

## Classic Script

通过普通 script 标签加载时，使用 `codex-pet-widget.js`。它会暴露
`window.CodexPet`。

```html
<script src="https://pet.api.fangbm.com/codex-pet/codex-pet-widget.js"></script>
<script>
  const pet = CodexPet.mount({
    pet: "https://pet.api.fangbm.com/codex-pet/pets/hachiroku/pet.json",
    position: "bottom-right",
    scale: 0.85
  });

  pet.say("Task finished.", {
    title: "Codex",
    state: "waving",
    timeout: 8000
  });
</script>
```

## ESM

使用 `codex-pet-widget.es.js` 时，需要通过 `type="module"` 加载。

```html
<script type="module">
  import { mount } from "https://pet.api.fangbm.com/codex-pet/codex-pet-widget.es.js";

  const pet = mount({
    pet: "https://pet.api.fangbm.com/codex-pet/pets/hachiroku/pet.json",
    position: "bottom-right"
  });

  pet.setState("running");
</script>
```

## Web Component

widget 会注册 `<codex-pet>` 自定义元素。

```html
<codex-pet
  id="pet"
  src="https://pet.api.fangbm.com/codex-pet/pets/hachiroku/pet.json"
  position="bottom-right"
  scale="0.85"
></codex-pet>
<script src="https://pet.api.fangbm.com/codex-pet/codex-pet-widget.js"></script>
<script>
  customElements.whenDefined("codex-pet").then(() => {
    document.querySelector("#pet").say("Hello from the page.", {
      title: "Message",
      state: "jumping"
    });
  });
</script>
```

## `CodexPet.mount(options)`

创建一个 `<codex-pet>` 元素，将它追加到 `document.body`，并返回这个元素实例。

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `pet` | `string` | `/pets/hachiroku/pet.json` | pet manifest URL。`src` 的别名。 |
| `src` | `string` | `/pets/hachiroku/pet.json` | pet manifest URL。未设置 `pet` 时使用。 |
| `position` | `string` | `bottom-right` | 初始屏幕角落。 |
| `scale` | `number` | `1` | 基础缩放。限制在 `0.45` 到 `2.5`。 |
| `autoScale` | `boolean` | `true` | 设置为 `false` 可关闭移动端视口自动缩放。 |
| `draggable` | `boolean` | `true` | 设置为 `false` 可禁用指针拖动。 |
| `zIndex` | `number` 或 `string` | `2147483000` | 叠加层的 CSS z-index。 |

支持的 `position` 值：

```text
bottom-right
bottom-left
top-right
top-left
```

## 元素属性

这些属性可以直接用于 `<codex-pet>`。

| Attribute | Example | Description |
| --- | --- | --- |
| `src` | `src="/pets/hachiroku/pet.json"` | pet manifest URL。修改后会加载另一个宠物。 |
| `position` | `position="bottom-right"` | 初始屏幕角落。 |
| `scale` | `scale="0.85"` | 基础缩放。 |
| `auto-scale` | `auto-scale="false"` | 设置为 `false` 时禁用移动端自动缩放。 |
| `draggable` | `draggable="false"` | 设置为 `false` 时禁用拖动。 |

组件使用 Shadow DOM，并暴露 `part="bubble"` 和 `part="pet"`，用于有限样式定制。

## 元素方法

### `pet.say(message, options)`

在宠物上方显示一个气泡。

```js
pet.say("Build completed.", {
  title: "Codex",
  state: "waving",
  timeout: 8000
});
```

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `message` | `string` | required | 气泡正文。HTML 会被转义。 |
| `options.title` | `string` | `""` | 可选的加粗首行。HTML 会被转义。 |
| `options.state` | `string` | unchanged | 显示气泡时切换到的动画状态。 |
| `options.timeout` | `number` | `8500` | 自动隐藏延迟，单位毫秒。 |

### `pet.setState(state)`

切换宠物动画。

```js
pet.setState("running");
```

未知状态会被忽略。

### `pet.setScale(scale)`

更新基础缩放并重新渲染宠物。

```js
pet.setScale(1.2);
```

该值会限制在 `0.45` 到 `2.5`。在小视口中，如果没有禁用 `autoScale` /
`auto-scale`，实际渲染尺寸仍可能被缩小。

### `pet.load(src)`

加载另一个 pet manifest，并返回解析后的 manifest。

```js
await pet.load("https://pet.api.fangbm.com/codex-pet/pets/hachiroku/pet.json");
```

## 动画状态

```text
idle
running-right
running-left
waving
jumping
failed
waiting
running
review
```

向左或向右拖动时，会自动切换到 `running-left` 或 `running-right`。鼠标悬停在宠物上时会切换到 `jumping`。

## 从页面向宠物发送消息

当前 API 是同页面 JavaScript。页面可以保存 `CodexPet.mount(...)` 的返回值，或选择一个 `<codex-pet>` 元素来发送消息：

```js
const pet = document.querySelector("codex-pet");
pet.say("Saved successfully.", { title: "Page", state: "waving" });
```

目前还没有内置 `postMessage`、WebSocket 或 HTTP 桥接接口。对于 iframe 或服务端驱动的消息，需要在宿主页面自行建立桥接，然后从页面 JavaScript 调用
`pet.say(...)`。

## Pet Manifest

```json
{
  "id": "hachiroku",
  "displayName": "Hachiroku",
  "description": "A chibi pixel companion.",
  "spritesheetPath": "spritesheet.webp"
}
```

`spritesheetPath` 会相对于 manifest URL 解析。精灵图使用 Codex 图集布局：
`1536x1872`，8 列，9 行，每格 `192x208`。

## R2 和 CORS

当页面与宠物文件不在同一个源时，需要为 R2 bucket 配置 CORS。widget 会
`fetch` 读取 `pet.json`，因此 CORS 必须允许 `GET`。

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

生产环境中，尽量把 `*` 替换为允许访问的网站 origin。

## 自动上传 R2

`Full Build` GitHub Actions 工作流可以把 widget 文件同步到 R2。需要配置这些 repository secrets：

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

默认上传到 bucket `codex-pet-desk`，前缀为 `codex-pet`。可以使用 repository variables `R2_BUCKET` 和 `R2_PREFIX` 覆盖这些默认值。
