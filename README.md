# CityU(DG) OneBill Electricity Monitor

港城莞 OneBill 电量监控 / 用电分析工具。

一个面向 **香港城市大学（东莞）CityU(DG)** OneBill 的轻量本地工具：自动记录宿舍剩余电量，并把原始记录整理成按小时、天、周、月的用电趋势。

> **非官方项目。** 本项目与香港城市大学（东莞）及 OneBill 服务提供方无隶属、授权或背书关系。仅供个人查看自己账户下的电量信息。

## 为什么做这个

OneBill 页面可以查看“剩余电量”，但不方便长期回答这些问题：

- 今天到底用了多少电？
- 哪个时间段耗电最多？
- 晚上睡觉后的基础耗电是多少？
- 这周和上周相比怎么样？
- 一个月大约会用多少电？
- 某一天某个具体时间还剩多少电？

这个项目把 OneBill 的剩余电量定时记录到本地 SQLite，再提供一个本地网页仪表盘做历史分析。

## 功能

- 默认每 **60 秒**采样一次剩余电量
- 正常运行时**不需要浏览器常驻**
- 本地 SQLite 保存原始历史
- 选择日期查看当天的剩余电量曲线
- 按 **小时**统计当天用电
- 最近 **31 天**每日用电
- 最近 **12 周**每周用电
- 最近 **12 个月**每月用电
- 查看当天完整原始采样表
- 导出当天 CSV
- 充值 / 补电单独统计，不计作负用电
- 采样断档超过 3 分钟时标记为估算区间，并按时间跨度分摊到小时 / 天 / 周 / 月
- 登录状态失效时先尝试无界面恢复；需要人工登录时可在仪表盘一键重新登录
- Windows 登录后自动启动
- 默认保留 **400 天**历史数据
- 日志自动轮换

## 截图

项目不附带真实用户截图，避免把宿舍、电表或历史用电数据带进公开仓库。安装后访问：

`http://127.0.0.1:17890/`

即可看到自己的本地仪表盘。

## 工作原理

OneBill 首页“剩余电量”旁边的刷新动作会请求登录后页面自身使用的接口：

```text
POST /api/walletManagement/updateRemainCapacity
```

请求包含当前账户对应的电表标识，返回剩余电量和电表更新时间。

首次安装时，本项目会：

1. 打开一个**独立的 Microsoft Edge profile**
2. 由你本人在 OneBill 页面正常登录
3. 自动识别当前账户对应的电表
4. 将 OneBill 登录 token 用 **Windows DPAPI** 加密后只保存在本机
5. 之后由 Node.js 直接调用登录后页面使用的接口进行采样

正常采样不需要 Edge 常驻。只有首次登录，或登录状态彻底失效时，才需要浏览器。

## 隐私与安全

这个项目默认按“本地优先”设计：

- 不要求你把学号、密码写进配置文件
- 程序不读取、记录或上传你的密码
- 登录发生在学校 OneBill 页面本身
- token 使用 **Windows DPAPI CurrentUser** 加密保存
- 历史电量数据库只保存在本机
- Dashboard 只监听 `127.0.0.1`，默认不会暴露到局域网
- 没有遥测、统计 SDK 或远程数据库
- Git 仓库不会包含本地 token、meterSn、SQLite、日志或 Edge profile

本地数据目录：

```text
%LOCALAPPDATA%\CityUDGElectricityMonitor\data
```

其中 `config.json` 会包含你的本地电表标识，`auth.dpapi` 是加密后的登录 token，`electricity.sqlite` 是历史用电记录。**不要把这个目录上传到 GitHub 或发给别人。**

## 系统要求

目前公开版面向 Windows：

- Windows 10 / 11
- Microsoft Edge
- Node.js **22.5+**
- npm
- 可以正常访问 CityU(DG) OneBill

推荐使用当前 Node.js LTS 或更新版本。

## 安装

### 1. 克隆仓库

```powershell
git clone https://github.com/gekamok/cityu-dg-electricity-monitor.git
cd cityu-dg-electricity-monitor
```

### 2. 运行安装脚本

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

安装脚本会自动：

1. 检查 Node.js 和 Edge
2. 复制运行文件到 `%LOCALAPPDATA%`
3. 安装 npm 依赖
4. 打开一次 Edge 让你登录 OneBill
5. 自动识别电表并保存加密登录状态
6. 注册 Windows 登录自启任务
7. 创建桌面“港城莞电量监控”快捷入口
8. 打开本地仪表盘

首次登录成功后，平时不需要保持浏览器开启。

## 使用

仪表盘：

```text
http://127.0.0.1:17890/
```

首页会显示：

- 当前剩余电量
- 今日记录用电
- 本周记录用电
- 本月记录用电
- 登录 / 采样状态

“当天详细分析”可以选择日期查看：

- 当天剩余电量曲线
- 每小时用电量
- 起始 / 结束电量
- 采样覆盖率
- 断档估算量
- 当天完整原始采样记录

“长期用电趋势”提供日、周、月三个粒度。

## 用量是怎么算的

核心思路是相邻两次“剩余电量”的差值。

例如：

```text
12:00  30.50
12:01  30.48
```

那么这一段记录到的用量约为：

```text
30.50 - 30.48 = 0.02
```

如果剩余电量上升，则记为“充值 / 补入”，不会当成负用电。

### 断档处理

如果电脑关机或断网数小时，程序无法知道这段时间内每一分钟的真实变化。

因此重新连上后，本项目不会把整段消耗全部算到“开机那一分钟”，而是：

- 把该区间标记为**估算**
- 按时间跨度分摊到跨过的小时 / 天 / 周 / 月

这比直接把差值塞进最后一个采样点更适合长期统计，但它仍然只是估算。

## 数据准确性说明

这里记录的是 OneBill 返回的**剩余电量余额变化**，不是高频智能电表的瞬时功率采样。

因此：

- 连续在线时，时间趋势通常比较细
- 电脑关机期间只能根据前后余额做区间估算
- OneBill 自身如果延迟更新，图表也会继承这个延迟
- 学校或服务提供方改变网页/API 后，项目可能需要更新

请把它当作个人用电分析工具，而不是计费凭证。

## 登录失效

通常不需要处理。

如果登录 token 失效：

1. 程序会先用专用 Edge profile 尝试无界面恢复
2. 如果统一认证本身也过期，Dashboard 会显示“需要重新登录”
3. 点击“重新登录”
4. 在弹出的 Edge 中完成登录
5. 新 token 会重新用 DPAPI 加密保存

## 配置

配置文件位于：

```text
%LOCALAPPDATA%\CityUDGElectricityMonitor\data\config.json
```

默认值：

```json
{
  "origin": "https://onebill.cityu-dg.edu.cn",
  "meterSn": null,
  "from": "mobile",
  "intervalSeconds": 60,
  "dashboardPort": 17890,
  "retentionDays": 400
}
```

`meterSn` 会在首次登录时自动发现，不需要手填。

修改 `intervalSeconds` 后需要重启计划任务才会使用新的采样间隔。不建议设置得过于频繁。

## 开发运行

```powershell
npm ci
npm run check
npm run login
npm start
```

源码直接运行时，数据仍默认写入：

```text
%LOCALAPPDATA%\CityUDGElectricityMonitor
```

如果需要开发隔离，可以设置：

```powershell
$env:CITYU_DG_ELECTRICITY_MONITOR_HOME = "$PWD\.dev-data"
```

`.dev-data` 不应提交到 Git。

## 卸载

只移除后台计划任务，保留历史数据：

```powershell
.\uninstall.ps1
```

连本地历史、登录状态一起删除：

```powershell
.\uninstall.ps1 -PurgeData
```

## 已知限制

- 当前只做 Windows 版本
- 依赖 Microsoft Edge
- 依赖 OneBill 当前网页结构和接口行为
- 不保证学校系统改版后仍可直接使用
- 首次开始运行以前的历史电量无法自动补回

## 贡献

欢迎提交 Issue / Pull Request，尤其是：

- OneBill 改版后的兼容修复
- 更好的用电统计方式
- macOS / Linux 支持
- 更友好的安装与升级方式
- UI / 图表改进

提交问题时请**不要附带**真实 token、学号、房间号、meterSn、SQLite 数据库或完整本地日志。

## License

MIT
