# 榴莲日历 · Seasonal Almanac

设计规格及日历效果图由用户提供（2026-11-13）。按独立 App 扩展现有手机，不改其他 App 页面；沿用桌面原生 SVG 图标语言新增 calendar 图标。

- 流程参考：https://github.com/ConardLi/garden-skills/tree/main/skills/web-design-engineer 。本轮读取 SKILL.md、design-calibration.md、redesign-protocol.md、browser-acceptance.md；不复制第三方界面代码或商标。
- 四季植物 `seasons.png`：本轮通过内置图像生成工具制作的透明四象限图集，春樱、夏绣球、秋枫银杏、冬青枝。仅在小面积装饰处通过 CSS 背景定位显示。原始提示摘要：四等分透明植物图集、彩铅线条与淡水彩、韩国独立文具编辑风格、钴蓝/天空蓝/砖橘/鼠尾草绿、无文字无界面、不跨象限。完整用途是新 App 的四季小幅插画，不是用户效果图裁切。
- DM Sans 400/500/700 拉丁字体：https://github.com/fontsource/font-files/tree/main/fonts/google/dm-sans ，使用本地 WOFF2，许可见 LICENSE-DM-Sans.txt（SIL OFL 1.1）。
- 中文 Noto Sans SC 复用已打包的 assets/weather/fonts/，无运行时外部字体请求。

视觉决策：奶油象牙白纸底、钴蓝日期与动作、天空蓝节日点、砖橘纪念日菱形；四至六行七列月历为第一重点，详情与近期事件用细分隔线排版。视觉变化3/10、动效2/10、信息密度6/10、素材依赖4/10、既有手机框架保真10/10。保留 Shadow DOM、桌面与返回手势、设置开关、模型连接、聊天独立存档和剧情回退机制；日历独立颜色字体，不加主题切换和通知中心。

资料来源：节日不是联网抓取的官方数据库，而是沿用插件当前配置的 AI 连接，按天气地点与剧情当年、次年整理的资料。设置页明确展示来源。程序校验年份覆盖、日期有效性、时区、条数与名称，无法证明模型所填节日事实绝对准确。历史/架空地区只允许已知设定，未知时区保留为空。
