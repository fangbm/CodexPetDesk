# Codex Pet Widget API

Codex Pet Widget renders a Codex-compatible pet on any webpage. It is packaged
as a classic browser bundle and an ESM bundle.

## Files

Release widget archives contain only JavaScript bundles:

```text
codex-pet-widget/
├── codex-pet-widget.js
└── codex-pet-widget.es.js
```

Pet assets are hosted separately. A pet manifest should point to a spritesheet
next to the manifest unless `spritesheetPath` is an absolute URL:

```text
codex-pet/
├── codex-pet-widget.js
└── pets/
    └── hachiroku/
        ├── pet.json
        └── spritesheet.webp
```

## Classic Script

Use `codex-pet-widget.js` when loading through a normal script tag. It exposes
`window.CodexPet`.

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

Use `codex-pet-widget.es.js` with `type="module"`.

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

The widget registers a `<codex-pet>` custom element.

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

Creates a `<codex-pet>` element, appends it to `document.body`, and returns the
element instance.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `pet` | `string` | `/pets/hachiroku/pet.json` | Pet manifest URL. Alias of `src`. |
| `src` | `string` | `/pets/hachiroku/pet.json` | Pet manifest URL. Used when `pet` is not set. |
| `position` | `string` | `bottom-right` | Initial screen corner. |
| `scale` | `number` | `1` | Base pet scale. Clamped from `0.45` to `2.5`. |
| `autoScale` | `boolean` | `true` | Set `false` to disable mobile viewport scaling. |
| `draggable` | `boolean` | `true` | Set `false` to disable pointer dragging. |
| `zIndex` | `number` or `string` | `2147483000` | CSS z-index for the overlay. |

Supported `position` values:

```text
bottom-right
bottom-left
top-right
top-left
```

## Element Attributes

These attributes can be used directly on `<codex-pet>`.

| Attribute | Example | Description |
| --- | --- | --- |
| `src` | `src="/pets/hachiroku/pet.json"` | Pet manifest URL. Changing it loads another pet. |
| `position` | `position="bottom-right"` | Initial screen corner. |
| `scale` | `scale="0.85"` | Base pet scale. |
| `auto-scale` | `auto-scale="false"` | Disables mobile auto-scaling when set to `false`. |
| `draggable` | `draggable="false"` | Disables dragging when set to `false`. |

The component uses Shadow DOM and exposes `part="bubble"` and `part="pet"` for
limited styling.

## Element Methods

### `pet.say(message, options)`

Shows a speech bubble above the pet.

```js
pet.say("Build completed.", {
  title: "Codex",
  state: "waving",
  timeout: 8000
});
```

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `message` | `string` | required | Main bubble text. HTML is escaped. |
| `options.title` | `string` | `""` | Optional bold first line. HTML is escaped. |
| `options.state` | `string` | unchanged | Animation state to switch to while showing the bubble. |
| `options.timeout` | `number` | `8500` | Auto-hide delay in milliseconds. |

### `pet.setState(state)`

Switches the pet animation.

```js
pet.setState("running");
```

Unknown states are ignored.

### `pet.setScale(scale)`

Updates the base scale and rerenders the pet.

```js
pet.setScale(1.2);
```

The value is clamped from `0.45` to `2.5`. On small viewports, rendered size may
still be reduced unless `autoScale` / `auto-scale` is disabled.

### `pet.load(src)`

Loads another pet manifest and returns the parsed manifest.

```js
await pet.load("https://pet.api.fangbm.com/codex-pet/pets/hachiroku/pet.json");
```

## Animation States

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

Dragging left or right automatically switches to `running-left` or
`running-right`. Hovering over the pet switches to `jumping`.

## Page-To-Pet Messages

The current API is same-page JavaScript. A page can send a message by keeping
the return value from `CodexPet.mount(...)` or by selecting a `<codex-pet>`
element:

```js
const pet = document.querySelector("codex-pet");
pet.say("Saved successfully.", { title: "Page", state: "waving" });
```

There is no built-in `postMessage`, WebSocket, or HTTP bridge yet. For iframe or
server-driven messages, create that bridge in the host page and call
`pet.say(...)` from the page JavaScript.

## Pet Manifest

```json
{
  "id": "hachiroku",
  "displayName": "Hachiroku",
  "description": "A chibi pixel companion.",
  "spritesheetPath": "spritesheet.webp"
}
```

`spritesheetPath` is resolved relative to the manifest URL. The spritesheet uses
the Codex atlas layout: `1536x1872`, 8 columns, 9 rows, `192x208` cells.

## R2 And CORS

When the page is hosted on a different origin than the pet files, configure CORS
for the R2 bucket. The widget fetches `pet.json`, so CORS must allow `GET`.

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

For production, replace `*` with the allowed site origin when possible.

## Automatic R2 Upload

The `Full Build` GitHub Actions workflow can sync widget files to R2. Configure
these repository secrets:

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

By default, uploads target bucket `codex-pet-desk` and prefix `codex-pet`.
Repository variables `R2_BUCKET` and `R2_PREFIX` can override those defaults.
