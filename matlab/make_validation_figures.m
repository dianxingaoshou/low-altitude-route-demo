function outputDir = make_validation_figures(r)
% Figures describe synthetic-model software verification, not aircraft testing.
if nargin == 0, r = verify_demo(); end
root = fileparts(fileparts(mfilename('fullpath')));
fixtures = fullfile(root, 'matlab', 'fixtures');
outputDir = fullfile(root, 'matlab', 'figures');
if ~exist(outputDir, 'dir'), mkdir(outputDir); end
combined = fullfile(outputDir, 'MATLAB_validation_all.pdf');
if exist(combined, 'file'), delete(combined); end
fields = readtable(fullfile(fixtures, 'field_snapshots.csv'));
points = readtable(fullfile(fixtures, 'route_points.csv'));
colors = [0.16 0.43 0.75; 0.61 0.35 0.70; 0.02 0.53 0.46];
methodNames = {'最短距离', 'D 题代价二维适配', '演示综合代价'};
boundary = '合成气象与概念机型；验证程序一致性，未验证实飞性能。';

% 1: Give the search comparison a geometric view and an independent optimum.
[f, t] = canvas('01 航路搜索与独立最优代价核对', boundary, 1, 2);
ax = nexttile(t);
seed = r.search.seed(1);
s = fields(fields.seed == seed, :);
z = nan(41, 61);
z(sub2ind(size(z), s.y_grid + 1, s.x_grid + 1)) = s.tke;
imagesc(ax, (0:60) * .2, (0:40) * .2, z);
set(ax, 'YDir', 'normal'); hold(ax, 'on'); axis(ax, 'equal');
xlim(ax, [0 12]); ylim(ax, [0 8]); clim(ax, [0 3]);
colormap(ax, interp1([0 .35 .7 1], [0.98 .99 .99; .83 .91 .86; .99 .80 .45; .86 .28 .20], linspace(0, 1, 128)));
cb = colorbar(ax); cb.Label.String = 'TKE (m²/s²)';
h = gobjects(1, 4);
rr = r.routes(r.routes.seed == seed, :);
for j = 1:3
    p = points(points.route_id == rr.route_id(j), :);
    h(j) = plot(ax, p.x_grid * .2, p.y_grid * .2, '-', 'Color', colors(j, :), 'LineWidth', 2.3);
end
p = r.paths(1).xy;
h(4) = plot(ax, p(:, 1) * .2, p(:, 2) * .2, '--', 'Color', [.1 .1 .1], 'LineWidth', 1.4);
plot(ax, .8, 4, 'o', 'MarkerFaceColor', 'white', 'MarkerEdgeColor', [.1 .1 .1], 'MarkerSize', 8);
plot(ax, 6.8, 4, 's', 'MarkerFaceColor', 'white', 'MarkerEdgeColor', [.1 .1 .1], 'MarkerSize', 8);
text(ax, .8, 3.6, 'A', 'FontWeight', 'bold'); text(ax, 6.8, 3.6, 'B', 'FontWeight', 'bold');
xlabel(ax, '东西方向距离 (km)'); ylabel(ax, '南北方向距离 (km)');
title(ax, sprintf('同一合成快照 · 种子 %d', seed));
legend(ax, h, [methodNames, {'MATLAB Dijkstra（D 题代价）'}], 'Location', 'southoutside', 'NumColumns', 2, 'FontSize', 10);
ax = nexttile(t);
b = bar(ax, [r.search.JS_cost, r.search.MATLAB_cost], 'grouped');
b(1).FaceColor = colors(1, :); b(2).FaceColor = colors(3, :);
set(ax, 'XTick', 1:3, 'XTickLabel', string(r.search.seed));
xlabel(ax, '固定天气种子'); ylabel(ax, '距离＋TKE 代价（模型单位）');
title(ax, '同一边集、同一代价：A* 与 Dijkstra');
legend(ax, {'网页 A*', 'MATLAB 独立 Dijkstra'}, 'Location', 'northoutside');
grid(ax, 'on'); ylim(ax, [0 max(r.search.JS_cost) * 1.2]);
for j = 1:3
    text(ax, j, r.search.JS_cost(j) + 8, sprintf('差值 %.2g', r.search.cost_error(j)), ...
        'HorizontalAlignment', 'center', 'FontSize', 10);
end
text(ax, .03, .94, '容差约 0.00005（4 位小数舍入）；比较代价。', ...
    'Units', 'normalized', 'FontSize', 10, 'VerticalAlignment', 'top');
saveFigure(f, outputDir, '01_route_search', combined);

% 2: Show rounding-level differences instead of presenting identity plots alone.
[f, t] = canvas('02 九条航路的飞行时间与耗电复核', ...
    '三组种子 × 三种方法；网页基准值保留两位小数，MATLAB 用未舍入航段输入重算。', 2, 2);
ax = nexttile(t); agreement(ax, r.routes.flight_s, r.routes.MATLAB_flight_s, ...
    r.routes.method_code, colors, methodNames, '飞行时间 (s)');
title(ax, sprintf('最大时间差 %.5f s', max(r.routes.time_error_s)));
ax = nexttile(t); agreement(ax, r.routes.energy_Wh, r.routes.MATLAB_energy_Wh, ...
    r.routes.method_code, colors, methodNames, '耗电 (Wh)');
title(ax, sprintf('最大能量差 %.5f Wh', max(r.routes.energy_error_Wh)));
ax = nexttile(t); errorBars(ax, r.routes.time_error_s, colors(1, :), '绝对时间差 (s)');
ax = nexttile(t); errorBars(ax, r.routes.energy_error_Wh, colors(3, :), '绝对耗电差 (Wh)');
saveFigure(f, outputDir, '02_time_energy_agreement', combined);

% 3: Every displayed sensitivity curve is independently recomputed in MATLAB.
[f, t] = canvas('03 空速、载荷与湍流怎样改变能耗', ...
    '96 组参数与网页公式核对通过；无风、平飞、固定 6 km。曲线为教学模型，不能作为厂家性能曲线。', 2, 2);
loads = [0 1 3];
ax = nexttile(t); hold(ax, 'on');
for j = 1:3
    q = r.sweep(r.sweep.payload == loads(j) & r.sweep.tke == .3, :);
    plot(ax, q.speed, q.MATLAB_power_W / 1000, 'Color', colors(j, :), 'LineWidth', 2);
end
xlabel(ax, '巡航空速 (m/s)'); ylabel(ax, '功率 (kW)'); title(ax, '载荷增加时，功率曲线上移'); grid(ax, 'on');
legend(ax, {'载荷 0 kg', '载荷 1 kg', '载荷 3 kg'}, 'Location', 'northwest');
ax = nexttile(t); hold(ax, 'on');
for j = 1:3
    q = r.sweep(r.sweep.payload == loads(j) & r.sweep.tke == .3, :);
    plot(ax, q.speed, q.MATLAB_Wh_per_km, 'Color', colors(j, :), 'LineWidth', 2);
end
xlabel(ax, '巡航空速 (m/s)'); ylabel(ax, '单位里程耗电 (Wh/km)'); title(ax, '慢速延长用时；高速增加所需功率'); grid(ax, 'on');
legend(ax, {'载荷 0 kg', '载荷 1 kg', '载荷 3 kg'}, 'Location', 'northwest');
ax = nexttile(t); hold(ax, 'on');
for j = 1:2
    k = [.3 1.5]; q = r.sweep(r.sweep.payload == 1 & r.sweep.tke == k(j), :);
    plot(ax, q.speed, q.MATLAB_Wh_per_km, 'Color', colors(j, :), 'LineWidth', 2);
end
xlabel(ax, '巡航空速 (m/s)'); ylabel(ax, '单位里程耗电 (Wh/km)'); title(ax, '同一速度与载荷：TKE 增大，耗电增加'); grid(ax, 'on');
legend(ax, {'TKE = 0.3 m²/s²', 'TKE = 1.5 m²/s²'}, 'Location', 'northwest');
ax = nexttile(t); q = r.sweep(r.sweep.payload == 1 & r.sweep.tke == .3, :);
yyaxis(ax, 'left'); plot(ax, q.speed, q.MATLAB_six_km_seconds / 60, 'LineWidth', 2, 'Color', colors(1, :));
ylabel(ax, '6 km 飞行用时 (min)');
yyaxis(ax, 'right'); plot(ax, q.speed, q.MATLAB_Wh_per_km * 6, 'LineWidth', 2, 'Color', colors(3, :));
ylabel(ax, '6 km 耗电 (Wh)'); xlabel(ax, '巡航空速 (m/s)');
ax.YAxis(1).Color = colors(1, :); ax.YAxis(2).Color = colors(3, :);
title(ax, '更快到达与更省电的取舍'); grid(ax, 'on');
saveFigure(f, outputDir, '03_speed_payload_energy', combined);

% 4: Battery replacement has a time cost and must respect reserve everywhere.
[f, t] = canvas('04 换电任务的电量与时间账单', ...
    '默认静态任务逐秒回放；MATLAB 核对时间恒等式、电量账本、保留量和换电后的满电恢复。', 1, 2);
ax = nexttile(t); hold(ax, 'on');
for j = 1:height(r.swaps)
    x = (r.swaps.completed_at_s(j) + [-r.swaps.duration_s(j), 0]) / 60;
    patch(ax, x([1 2 2 1]), [0 0 230 230], [1 .93 .74], 'EdgeColor', 'none', 'FaceAlpha', .7);
    text(ax, mean(x), 219, 'S1 换电 120 s', 'HorizontalAlignment', 'center', 'FontSize', 10);
end
h1 = plot(ax, r.relay.elapsed_s / 60, r.relay.battery_Wh, 'LineWidth', 2, 'Color', colors(3, :));
h2 = yline(ax, 44, '--', '保留量 44 Wh', 'Color', [.65 .25 .2], 'LineWidth', 1.4);
xlabel(ax, '累计任务时间 (min)'); ylabel(ax, '剩余电量 (Wh)');
title(ax, '换电期间停留；完成后电量恢复 220 Wh'); ylim(ax, [0 230]); grid(ax, 'on');
legend(ax, [h1 h2], {'实际软件回放', '20% 保留量'}, 'Location', 'southwest');
ax = nexttile(t); totals = [r.relay.flight_s(end), r.relay.swap_s(end), r.relay.hold_s(end)];
b = barh(ax, 1.3, totals / 60, 'stacked', 'BarWidth', .28);
b(1).FaceColor = colors(1, :); b(2).FaceColor = [.93 .65 .18]; b(3).FaceColor = colors(3, :);
ylim(ax, [0 2]); xlim(ax, [0 sum(totals) / 60 * 1.12]); set(ax, 'YTick', []);
xlabel(ax, '时间账单 (min)'); title(ax, '最终用时 = 飞行 + 换电 + 等待');
legend(ax, {'飞行', '换电', '等待（本例为 0）'}, 'Location', 'northoutside');
text(ax, .03, .13, sprintf('%.2f + %.2f + %.2f = %.2f s\n约 17 分 09 秒；关闭站点时，无满足电量的方案。', ...
    totals(1), totals(2), totals(3), sum(totals)), 'Units', 'normalized', 'FontSize', 12);
saveFigure(f, outputDir, '04_battery_swap_timeline', combined);

% 5: A stopped icon alone is not evidence: independently account for waiting Wh.
[f, t] = canvas('05 大范围阵风下的安全等待验证', ...
    '当前点符合教学等待条件：等待 240 s 后自动恢复飞行。保护停演与等待是两个不同的软件状态。', 2, 2);
h = r.hold; tt = h.end_s - r.holdSummary.start_s;
ax = nexttile(t);
plot(ax, tt, hypot(h.u, h.v), 'Color', colors(1, :), 'LineWidth', 2); hold(ax, 'on');
yline(ax, 14, '--', '教学风速限 14 m/s', 'Color', [.65 .25 .2]);
xlabel(ax, '进入等待后的时间 (s)'); ylabel(ax, '当前位置水平风速 (m/s)');
title(ax, '前方航路被阻断；当前位置仍允许等待'); ylim(ax, [0 16]); grid(ax, 'on');
ax = nexttile(t);
plot(ax, [0; tt], [r.holdSummary.initial_battery_Wh; h.battery_Wh], 'Color', colors(3, :), 'LineWidth', 2); hold(ax, 'on');
yline(ax, 44, '--', '保留量', 'Color', [.65 .25 .2]);
xlabel(ax, '进入等待后的时间 (s)'); ylabel(ax, '剩余电量 (Wh)');
title(ax, sprintf('原地等待消耗 %.2f Wh', h.MATLAB_cumulative_Wh(end))); ylim(ax, [0 220]); grid(ax, 'on');
ax = nexttile(t); plot(ax, [0; tt], [0; h.displacement_m], 'Color', colors(1, :), 'LineWidth', 2);
xlabel(ax, '进入等待后的时间 (s)'); ylabel(ax, '相对等待起点的位移 (m)');
title(ax, '240 个步骤：位移为 0，计时继续'); ylim(ax, [-.05 .05]); grid(ax, 'on');
ax = nexttile(t); hold(ax, 'on');
plot(ax, [0; tt], [0; h.hold_energy_Wh], 'Color', colors(3, :), 'LineWidth', 2.4);
plot(ax, [0; tt], [0; h.MATLAB_cumulative_Wh], '--', 'Color', [.1 .1 .1], 'LineWidth', 1.3);
xlabel(ax, '进入等待后的时间 (s)'); ylabel(ax, '累计等待耗电 (Wh)');
title(ax, sprintf('MATLAB 独立积分：最大差 %.2g Wh', max(abs(h.hold_energy_Wh - h.MATLAB_cumulative_Wh))));
legend(ax, {'网页回放', 'MATLAB：Σ PΔt / 3600'}, 'Location', 'northwest'); grid(ax, 'on');
saveFigure(f, outputDir, '05_gust_wait_energy', combined);

% 6: Different reasons may forbid a segment even when its groundspeed is high.
[f, t] = canvas('06 迎风、侧风与风速限的可飞行判定', ...
    '空速固定 12 m/s、航向朝东；6 个局部算例与网页结果一致。阈值均为教学设定。', 2, 2);
caseNames = {'静风', '顺风 4', '逆风 10', '侧风 13', '顺风 15', '逆风 2＋侧风 8'};
q = r.safety; c = repmat([.82 .31 .27], height(q), 1); c(q.MATLAB_flyable == 1, :) = repmat(colors(3, :), sum(q.MATLAB_flyable == 1), 1);
ax = nexttile(t); b = bar(ax, hypot(q.u, q.v), 'FaceColor', 'flat'); b.CData = c;
yline(ax, 14, '--', '14 m/s 风速限'); set(ax, 'XTickLabel', caseNames, 'XTickLabelRotation', 18);
ylabel(ax, '水平风速 (m/s)'); title(ax, '风速达到上限，即使顺风也拒绝'); ylim(ax, [0 18]); grid(ax, 'on');
ax = nexttile(t); b = bar(ax, q.MATLAB_ground_speed, 'FaceColor', 'flat'); b.CData = c;
yline(ax, 3, '--', '最低地速 3 m/s'); set(ax, 'XTickLabel', caseNames, 'XTickLabelRotation', 18);
ylabel(ax, '沿航路地速 (m/s)'); title(ax, '过强逆风或无法补偿的侧风会阻断'); ylim(ax, [0 30]); grid(ax, 'on');
ax = nexttile(t, [1 2]); decisions = [q.flyable'; q.MATLAB_flyable'];
imagesc(ax, decisions); clim(ax, [0 1]); colormap(ax, [.96 .82 .79; .80 .93 .87]);
set(ax, 'XTick', 1:6, 'XTickLabel', caseNames, 'YTick', 1:2, 'YTickLabel', {'网页判定', 'MATLAB 判定'});
for row = 1:2
    for j = 1:6
        words = {'拒绝', '允许'};
        text(ax, j, row, words{decisions(row, j) + 1}, 'HorizontalAlignment', 'center', 'FontWeight', 'bold');
    end
end
title(ax, '两套实现对同一输入得到相同的允许 / 拒绝结果');
saveFigure(f, outputDir, '06_wind_safety_cases', combined);
fprintf('Generated six figures (PNG, PDF, FIG) and a six-page PDF.\n');
end

function [f, t] = canvas(mainTitle, note, rows, columns)
height = 820; if rows == 1, height = 650; end
f = figure('Visible', 'off', 'Color', 'white', 'Position', [60 60 1360 height]);
t = tiledlayout(f, rows, columns, 'TileSpacing', 'compact', 'Padding', 'compact');
title(t, mainTitle, 'FontSize', 20, 'FontWeight', 'bold', 'Interpreter', 'none');
subtitle(t, note, 'FontSize', 11, 'Interpreter', 'none');
end

function agreement(ax, x, y, methodCodes, colors, names, quantity)
hold(ax, 'on'); maxValue = max([x; y]) * 1.1;
plot(ax, [0 maxValue], [0 maxValue], '--', 'Color', [.4 .4 .4], 'HandleVisibility', 'off');
h = gobjects(1, 3);
for j = 1:3
    mask = methodCodes == j - 1;
    h(j) = scatter(ax, x(mask), y(mask), 60, colors(j, :), 'filled');
end
xlim(ax, [0 maxValue]); ylim(ax, [0 maxValue]);
xlabel(ax, ['网页基准：', quantity]); ylabel(ax, ['MATLAB 重算：', quantity]); grid(ax, 'on');
legend(ax, h, names, 'Location', 'northwest', 'FontSize', 10);
end

function errorBars(ax, values, color, quantity)
bar(ax, values, 'FaceColor', color); hold(ax, 'on');
yline(ax, .005001, '--', '舍入容差 0.005001', 'Color', [.65 .25 .2]);
ylim(ax, [0 .0065]); xlim(ax, [.5 9.5]);
set(ax, 'XTick', 1:9, 'XTickLabel', compose('R%d', 1:9));
xlabel(ax, '航路编号（每三条对应一个种子）'); ylabel(ax, quantity);
title(ax, '实际数值差值均在容差内'); grid(ax, 'on');
end

function saveFigure(f, outputDir, stem, combined)
allText = findall(f, '-property', 'FontName');
set(allText, 'FontName', 'Microsoft YaHei');
axesList = findall(f, 'Type', 'axes');
set(axesList, 'FontSize', 11, 'Box', 'off', 'LineWidth', .8);
drawnow;
exportgraphics(f, fullfile(outputDir, [stem '.png']), 'Resolution', 220, 'BackgroundColor', 'white');
exportgraphics(f, fullfile(outputDir, [stem '.pdf']), 'ContentType', 'vector', 'BackgroundColor', 'white');
savefig(f, fullfile(outputDir, [stem '.fig']));
exportgraphics(f, combined, 'ContentType', 'vector', 'Append', exist(combined, 'file') == 2, 'BackgroundColor', 'white');
close(f);
end
