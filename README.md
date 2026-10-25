# dsh-provider-plus（模型增强）

给 DeepSeek Harness 的「自定义模型提供商」补上内置表单缺的几件事：图片输入、网关额外请求头（如 `x-opencode-session`）、拉取模型列表、连通性测试、用量测试 / 余额查询模板，以及在输入框旁跟随当前模型显示的用量总览。

它不写协议、不接管内置页面：改的仍是 `llm-pi-ai.providers`，**设置 → 模型** 照旧可用，只是多了一个 **设置 → 模型增强** 工作台。细节见[使用说明](./docs/guide.md)。

## 界面示例

下图是“获取模型”成功后的示例状态，模型名称和数据仅用于展示布局。可查看[交互预览](./docs/previews/model-picker-success.html)。

![模型列表获取成功示例](./docs/previews/model-picker-success.png)

## 安装

见 [**DSH 插件安装教程**](https://github.com/DPH-1121/dsh-plugins/blob/main/docs/install.md)。

## 兼容性

基线 **dsh `0.2.1-rc.3`**：清单通过 rc.3 的插件闸门、可装入隔离 profile 并 `--dump-config` 组合成功，`npm run test`（smoke）通过；`engines.dsh` 同时保留 `0.1.6` 起的旧窗口。

## 其他 DSH 插件

- [dsh-opencode-go-plus](https://github.com/DPH-1121/dsh-opencode-go-plus) —— 用 OpenCode Go 订阅模型，自动适配网关新模型并显示套餐额度。
- [dsh-wallhaven-wallpaper](https://github.com/DPH-1121/dsh-wallhaven-wallpaper) —— 在设置里搜 wallhaven，把图片铺成 Web GUI 背景。
- [dsh-plugins](https://github.com/DPH-1121/dsh-plugins) —— DSH 插件搜集面板：搜仓库、复制安装地址。

## 许可

MIT。
