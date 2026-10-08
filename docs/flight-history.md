# 完整飞行过程曲线与导出

在网页开始任务后，滚动到“完整任务 · 飞行过程曲线”。曲线会一直保留从起飞前初始状态到当前时刻的记录，到达后可以继续查看和导出。

## 读图与操作

- 空速设定与执行地速：蓝线为巡航空速设定，绿线为执行航段地速。等待、换电时地速为零；空速设定仍保留，不能把它当作等待时的实测空速。
- 执行功率：飞行采用执行航段功率，安全等待采用悬停模型功率；地面换电按现有模型不消耗飞行电池。
- 剩余电量：换电前后在同一时间保留两条记录，显示恢复满电的垂直跳变；累计耗能不会因换电清零。虚线为当前保留电量比例。
- 风速与 TKE：分别使用 m/s 和 m²/s²，采样无人机所在位置的同一模型天气快照。前方阵风尚未覆盖飞机或已被绕开时，本地曲线不一定出现风速峰值。
- 横轴为任务模拟秒数。演示倍速只改变播放快慢。黄色底纹为安全等待，青色底纹为换电。

移动指针可同时查看各图的同一条记录；点击曲线锁定取样点，点“跟随任务”恢复实时跟随。在曲线上按左右方向键逐条查看，按 Esc 恢复跟随。展开完整事件时间线，点击阵风、重规划、等待、换电或到达事件可定位到对应时刻。邻近图上标记会合并显示数量，时间线保留每个事件；筛选事件只改变显示，不会删除数据。

默认显示完整任务，可改成最近 2 分钟或 5 分钟。CSV / JSON 始终导出完整过程；PNG 也始终绘制从零到当前时刻的完整任务，不受当前查看范围影响。

记录保存在当前页面内存中，重置任务、修改任务点触发重置、切换补能策略或关闭 / 刷新页面都会开启新记录。请先导出需要保留的任务结果。

## CSV 字段

| 字段 | 含义与单位 |
|---|---|
| `time_s`、`status` | 任务模拟时间 / s、仿真状态 |
| `cruise_setpoint_mps`、`ground_speed_mps` | 巡航空速设定、执行地速 / m/s |
| `power_W` | 执行功率 / W |
| `battery_pct`、`battery_Wh` | 当前电池剩余百分比、能量 / Wh |
| `energy_used_Wh` | 所有已使用电池的累计能量消耗 / Wh |
| `wind_speed_mps`、`tke_m2ps2`、`sigma_mps` | 当前位置水平风速 / m/s、TKE / m²/s²、模型波动标准差 / m/s |
| `latitude_deg`、`longitude_deg`、`distance_km` | 位置纬度、经度 / °、累计航程 / km |
| `flight_time_s`、`wait_time_s`、`swap_time_s` | 分别累计的飞行、等待、换电时间 / s |
| `reserve_pct` | 当前设定的保留电量百分比 |
| `weather_snapshot_min`、`weather_seed` | 实际用于采样的天气快照分钟和随机种子 |
| `active_gusts` | 当前有效手动阵风数量 |
| `event_types`、`event_labels` | 该时刻事件类型和完整名称 |

每个完整任务秒保留一条采样，使用原积分段的时间、位置和能量线性插值，**不改变仿真的时间步或重规划条件**。功率 / 地速改变、状态切换、事件和最终时刻额外保留记录，所以行数可能多于任务秒数。相同时间的多行是有意保留的瞬时变化，不应先去重，否则会抹掉换电跳变或功率边界。没有观测时的天气值留空，不伪造为零。

暂停 / 保护停演是冻结仿真，记录功率为零、模拟时间不增加；不表示实际无人机可以停止耗电悬停。`waiting` 才是计时、计能量的安全等待状态。

## MATLAB 导入与绘图

将“飞行过程时间序列.csv”放在 MATLAB 当前文件夹，执行以下代码。只使用基础 MATLAB 绘图，不要求 UAV Toolbox。

```matlab
T = readtable('飞行过程时间序列.csv', ...
    'VariableNamingRule', 'preserve', 'TextType', 'string', ...
    'Encoding', 'UTF-8');
figure('Color', 'w', 'Position', [100 80 1200 900]);
tiledlayout(3, 2, 'TileSpacing', 'compact');
nexttile;
plot(T.time_s / 60, [T.cruise_setpoint_mps, T.ground_speed_mps]);
ylabel('速度 / m/s'); legend('巡航空速设定', '执行地速');
nexttile; plot(T.time_s / 60, T.power_W); ylabel('功率 / W');
nexttile; plot(T.time_s / 60, T.battery_pct); ylabel('剩余电量 / %');
nexttile; plot(T.time_s / 60, T.energy_used_Wh); ylabel('累计耗能 / Wh');
nexttile; plot(T.time_s / 60, T.wind_speed_mps); ylabel('水平风速 / m/s');
nexttile; plot(T.time_s / 60, T.tke_m2ps2); ylabel('TKE / m^2 s^{-2}');
for ax = findall(gcf, 'Type', 'axes')'
    xlabel(ax, '任务模拟时间 / min'); grid(ax, 'on');
end
exportgraphics(gcf, '飞行过程MATLAB.png', 'Resolution', 200);

% 检查功率积分与累计能量账本是否一致，保留重复时间点。
E = trapz(T.time_s, T.power_W) / 3600;
fprintf('功率积分 %.6f Wh；累计耗能 %.6f Wh\n', E, T.energy_used_Wh(end));
```

这些图是对同一次网页仿真记录的展示；独立数学模型校验仍使用仓库原有 `matlab/run_validation.m`，不能把同一记录重画一遍说成独立验证。

## 实现检查

`npm test` 包含过程记录专项检查：不同步长的一秒采样覆盖、功率积分、固定换电电量跳变、等待耗电、暂停、飞行中调速、天气取样、CSV / JSON 和重置。原有路径、换电、阵风与气象检查保持通过。
