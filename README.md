# 萧山低空航路实验室

低空经济技术与实践课程的二维交互演示：设置起终点与途经点，模拟无人机飞行、阵风与湍流、速度及载荷能耗、换电接力和总用时。

网页默认尝试加载 OpenStreetMap 在线地图，可用按钮切换到内置地图；若在线瓦片无法访问，会自动保留并切换到内置地图。内置地图来自萧山周边 OpenStreetMap 数据快照，程序及地图在断网时仍可运行。地图位置是真实坐标；任务点、气象、飞行与能耗均为教学模拟，不用于实际飞行。

在仓库的 **Settings → Pages** 中将发布来源设为 **Deploy from a branch**，分支选 **main**、目录选 **/(root)**，保存后即可通过 `https://dianxingaoshou.github.io/low-altitude-route-demo/` 访问。网页加载可能需要几分钟。

日常修改请在 VS Code 中打开本仓库文件夹 `low-altitude-route-demo-public`，在左侧“源代码管理”中暂存修改、填写提交说明并提交，再点击“同步更改”或“推送”。本地 `main` 已连接 `origin/main`；推送成功后 GitHub Pages 会自动重新发布。在线地图需要访问 OpenStreetMap 瓦片服务，网络不通时可使用内置地图。

## 课程作业定位与复现

本项目按 **Demo 实现**提交：浏览器运行二维定高网格仿真，展示模拟多源观测、风场与湍流、A* 航路、动态阵风避险、载荷与能耗、换电接力。两篇 D 题论文是方法依据，不声称完整复现其三维数据同化、预测模型或原始数值结果。天气、站点、机型功率与安全阈值均为教学设定；地图位置是真实坐标，但不包含建筑物、空域和起降限制，不能用于真实飞行。

无需安装网页依赖；打开 `index.html` 即可演示。推荐使用本地静态服务器以获得稳定的浏览器行为。项目内的 Leaflet 和内置地图可离线工作，在线地图需要网络。

实验与程序检查需要 Node.js 18 或更新版本，不需要执行 `npm install`：

```powershell
npm test
npm run experiment
```

实验脚本 `experiments/compare.cjs` 固定三组种子，在相同二维天气和安全约束下比较最短距离、第一篇论文距离＋TKE 代价的二维适配 A*，以及网页的综合代价路线；还比较模拟观测来源和长距离任务能否换电。结果写入 `experiments/results/`。这些结果来自合成场，仅能说明本仿真中的权衡与程序一致性，不能当作论文原实验或萧山实测结论。测试脚本位于 `tests/`，检查路线、天气耦合、阵风、换电、能耗与计时。

如安装 MATLAB R2024b，可运行 `npm run matlab:fixtures`，再在仓库根目录执行 `matlab -batch "addpath('matlab'); verify_demo"`。MATLAB 用 Dijkstra 和独立航段公式核对三组种子、九条航路及换电计时；运行记录见 `matlab/verification_report.txt`，方法与可引用的论文、真实案例和规范的适用边界见 [`matlab/README.md`](matlab/README.md)。
