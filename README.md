# dsh-provider-plus

给 DeepSeek Harness 的「自定义模型提供商」补上内置表单缺的几件事：图片输入、网关额外请求头（如 `x-opencode-session`）、拉取模型列表、连通性测试、用量 / 余额查询模板。

它不写协议、不接管内置页面：改的仍是 `llm-pi-ai.providers`，**设置 → 模型** 照旧可用，只是多了一个 **设置 → 提供商增强** 工作台。细节见[使用说明](./docs/guide.md)。

## 安装

见 [**DSH 插件安装教程**](https://github.com/DPH-1121/dsh-plugins/blob/main/docs/install.md)。

## 其他 DSH 插件

- [dsh-opencode-go-plus](https://github.com/DPH-1121/dsh-opencode-go-plus) —— 用 OpenCode Go 订阅模型，自动适配网关新模型并显示套餐额度。
- [dsh-wallhaven-wallpaper](https://github.com/DPH-1121/dsh-wallhaven-wallpaper) —— 在设置里搜 wallhaven，把图片铺成 Web GUI 背景。
- [dsh-plugins](https://github.com/DPH-1121/dsh-plugins) —— DSH 插件搜集面板：搜仓库、复制安装地址。

## 许可

MIT。