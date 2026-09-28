# 萧山低空航路实验室

低空经济技术与实践课程的二维交互演示：设置起终点与途经点，模拟无人机飞行、阵风与湍流、速度及载荷能耗、换电接力和总用时。

网页默认尝试加载 OpenStreetMap 在线地图，可用按钮切换到内置地图；若在线瓦片无法访问，会自动保留并切换到内置地图。内置地图来自萧山周边 OpenStreetMap 数据快照，程序及地图在断网时仍可运行。地图位置是真实坐标；任务点、气象、飞行与能耗均为教学模拟，不用于实际飞行。

在仓库的 **Settings → Pages** 中将发布来源设为 **Deploy from a branch**，分支选 **main**、目录选 **/(root)**，保存后即可通过 `https://dianxingaoshou.github.io/low-altitude-route-demo/` 访问。网页加载可能需要几分钟。

日常修改请在 VS Code 中打开本仓库文件夹 `low-altitude-route-demo-public`，在左侧“源代码管理”中暂存修改、填写提交说明并提交，再点击“同步更改”或“推送”。本地 `main` 已连接 `origin/main`；推送成功后 GitHub Pages 会自动重新发布。在线地图需要访问 OpenStreetMap 瓦片服务，网络不通时可使用内置地图。
