function results = verify_demo()
% Independent MATLAB numerical checks of the classroom JavaScript simulator.
% Inputs are exported by export-fixtures.cjs; all formulae below are recomputed.
root = fileparts(fileparts(mfilename('fullpath')));
fixtures = fullfile(root, 'matlab', 'fixtures');
edges = readtable(fullfile(fixtures, 'graph_edges.csv'));
routes = readtable(fullfile(fixtures, 'route_expected.csv'));
segments = readtable(fullfile(fixtures, 'route_segments.csv'));
mission = readtable(fullfile(fixtures, 'mission_expected.csv'));
safety = readtable(fullfile(fixtures, 'safety_cases.csv'));
sweep = readtable(fullfile(fixtures, 'parameter_sweep.csv'));
relay = readtable(fullfile(fixtures, 'relay_trace.csv'));
swaps = readtable(fullfile(fixtures, 'swap_records.csv'));
hold = readtable(fullfile(fixtures, 'hold_steps.csv'));
holdSummary = readtable(fullfile(fixtures, 'hold_summary.csv'));
assert(height(edges) > 0 && height(routes) == 9 && height(segments) > 0);

nx = 61; ny = 41; gridKm = 0.2; alpha = 200; beta = 1.5;
startNode = 20 * nx + 4 + 1; endNode = 20 * nx + 34 + 1;
speed = 12; payload = 1; basePower = 650;
% JS rounds route summaries to 4 decimals (distance/cost) and 2 (s/Wh).
costTolerance = 0.00005001;
metricTolerance = 0.005001;
logPath = fullfile(root, 'matlab', 'verification_report.txt');
fid = fopen(logPath, 'w', 'n', 'UTF-8');
assert(fid > 0, 'Cannot create verification report.');
cleanup = onCleanup(@() fclose(fid));
writeLine(fid, sprintf('MATLAB R%s independent numeric validation', version('-release')));
writeLine(fid, 'Same synthetic inputs as the web demo; this is software verification, not field validation.');
results = struct('routes', routes, 'relay', relay, 'swaps', swaps, ...
    'mission', mission, 'holdSummary', holdSummary, 'gridKm', gridKm);
searchRows = [];
results.paths = struct('seed', {}, 'xy', {});

seeds = unique(edges.seed)';
for seed = seeds
    graphRows = edges(edges.seed == seed, :);
    assert(all(isfinite(graphRows.d_km)) && all(graphRows.d_km > 0));
    midpointTke = (graphRows.tke_a + graphRows.tke_b) / 2;
    paperWeights = graphRows.d_km .* (1 + alpha * midpointTke .^ beta);
    assert(all(isfinite(paperWeights)) && all(paperWeights > 0));

    distanceGraph = digraph(graphRows.u, graphRows.v, graphRows.d_km, nx * ny);
    [~, shortestKm] = shortestpath(distanceGraph, startNode, endNode, 'Method', 'positive');
    expectedShort = routes(routes.seed == seed & routes.method_code == 0, :);
    assert(height(expectedShort) == 1);
    assert(abs(shortestKm - expectedShort.distance_km) < costTolerance, ...
        sprintf('Shortest path mismatch for seed %d', seed));

    paperGraph = digraph(graphRows.u, graphRows.v, paperWeights, nx * ny);
    [matlabPath, matlabCost] = shortestpath(paperGraph, startNode, endNode, 'Method', 'positive');
    expectedPaper = routes(routes.seed == seed & routes.method_code == 1, :);
    assert(height(expectedPaper) == 1);
    assert(abs(matlabCost - expectedPaper.paper_cost) < costTolerance, ...
        sprintf('Paper-cost A* mismatch for seed %d', seed));
    searchRows(end + 1, :) = [seed, expectedShort.distance_km, shortestKm, ...
        abs(shortestKm - expectedShort.distance_km), expectedPaper.paper_cost, ...
        matlabCost, abs(matlabCost - expectedPaper.paper_cost)]; %#ok<AGROW>
    p = matlabPath(:) - 1;
    results.paths(end + 1) = struct('seed', seed, 'xy', [mod(p, nx), floor(p / nx)]);
    writeLine(fid, sprintf('PASS seed %d: shortest %.4f km; MATLAB Dijkstra paper cost %.4f; JS A* %.4f', ...
        seed, shortestKm, matlabCost, expectedPaper.paper_cost));
end
results.search = array2table(searchRows, 'VariableNames', {'seed', 'JS_distance_km', ...
    'MATLAB_distance_km', 'distance_error_km', 'JS_cost', 'MATLAB_cost', 'cost_error'});
metricRows = [];

for routeId = routes.route_id'
    s = segments(segments.route_id == routeId, :);
    expected = routes(routes.route_id == routeId, :);
    assert(height(s) > 0 && height(expected) == 1);
    normGrid = hypot(s.dx_grid, s.dy_grid);
    distance = gridKm * normGrid;
    tke = (s.tke_a + s.tke_b) / 2;
    windU = (s.u_a + s.u_b) / 2;
    windV = (s.v_a + s.v_b) / 2;
    gust = (s.gust_a + s.gust_b) / 2;
    along = (windU .* s.dx_grid + windV .* s.dy_grid) ./ normGrid;
    cross = abs(windU .* s.dy_grid - windV .* s.dx_grid) ./ normGrid;
    assert(all(cross < speed), sprintf('Unflyable crosswind on route %d', routeId));
    groundspeed = sqrt(speed^2 - cross.^2) + along;
    assert(all(groundspeed >= 3), sprintf('Unflyable groundspeed on route %d', routeId));
    windSpeed = hypot(windU, windV);
    speedRatio = speed / 12;
    speedFactor = 0.2 + 0.3 / speedRatio + 0.5 * speedRatio^3;
    powerW = basePower * ((5.5 + payload) / 5.5)^1.5 * speedFactor .* ...
        (1 + 0.6 * (tke / 3).^2) + 4 * windSpeed.^2 + 220 * gust.^2 + 40;
    seconds = distance * 1000 ./ groundspeed;
    energyWh = sum(powerW .* seconds / 3600);
    dose = sum(distance .* tke);
    paperCost = sum(distance .* (1 + alpha * tke.^beta));
    assert(abs(sum(distance) - expected.distance_km) < costTolerance, sprintf('Distance mismatch on route %d', routeId));
    assert(abs(dose - expected.tke_exposure) < costTolerance, sprintf('TKE dose mismatch on route %d', routeId));
    assert(abs(sum(seconds) - expected.flight_s) < metricTolerance, sprintf('Time mismatch on route %d', routeId));
    assert(abs(energyWh - expected.energy_Wh) < metricTolerance, sprintf('Energy mismatch on route %d', routeId));
    assert(abs(paperCost - expected.paper_cost) < costTolerance, sprintf('Paper cost mismatch on route %d', routeId));
    metricRows(end + 1, :) = [routeId, sum(distance), dose, sum(seconds), energyWh, paperCost]; %#ok<AGROW>
end
metrics = array2table(metricRows, 'VariableNames', {'route_id', 'MATLAB_distance_km', ...
    'MATLAB_tke_exposure', 'MATLAB_flight_s', 'MATLAB_energy_Wh', 'MATLAB_cost'});
results.routes = join(routes, metrics, 'Keys', 'route_id');
results.routes.time_error_s = abs(results.routes.flight_s - results.routes.MATLAB_flight_s);
results.routes.energy_error_Wh = abs(results.routes.energy_Wh - results.routes.MATLAB_energy_Wh);
writeLine(fid, sprintf('PASS %d route metric checks: distance, TKE dose, flight time, energy, paper cost', height(routes)));
writeLine(fid, sprintf('Maximum route time error %.8f s; energy error %.8f Wh (rounding tolerance %.6f).', ...
    max(results.routes.time_error_s), max(results.routes.energy_error_Wh), metricTolerance));

off = mission(mission.stations_enabled == 0, :);
on = mission(mission.stations_enabled == 1, :);
assert(height(off) == 1 && height(on) == 1 && off.feasible == 0 && on.feasible == 1);
assert(on.swap_count == 1 && abs(on.swap_s - 120) < 1e-8);
assert(abs(on.flight_s + on.swap_s - on.total_s) < 1e-8);
writeLine(fid, sprintf('PASS battery relay: no-station infeasible; one swap; %.2f + %.2f = %.2f s', ...
    on.flight_s, on.swap_s, on.total_s));

% Independent local edge decisions for calm, tailwind, headwind and crosswind.
localWind = hypot(safety.u, safety.v);
cross = abs(safety.v); % All safety cases fly east (dx=1, dy=0).
groundspeed = zeros(height(safety), 1);
validCross = cross < speed;
groundspeed(validCross) = sqrt(speed^2 - cross(validCross).^2) + safety.u(validCross);
flyable = localWind < 14 & groundspeed >= 3;
assert(all(double(flyable) == safety.flyable), 'Wind-safety decision mismatch.');
assert(all(abs(groundspeed - safety.ground_speed) < 1e-8), 'Groundspeed mismatch.');
safety.MATLAB_ground_speed = groundspeed;
safety.MATLAB_flyable = double(flyable);
safePower = basePower * ((5.5 + payload) / 5.5)^1.5 * ...
    (1 + 0.6 * (0.3 / 3)^2) + 4 * localWind.^2 + 40;
assert(all(abs(safePower - safety.power_W) < 1e-8), 'Local wind power mismatch.');
results.safety = safety;
writeLine(fid, sprintf('PASS %d local wind-safety cases: calm, tailwind, excessive headwind/crosswind/wind limit', height(safety)));

% Sensitivity checks of the illustrative power model, not aircraft calibration.
speeds = [6 12 18];
ratio = speeds / 12;
factor = 0.2 + 0.3 ./ ratio + 0.5 * ratio.^3;
whPerKm = (basePower * ((5.5 + payload) / 5.5)^1.5 .* factor * ...
    (1 + 0.6 * (0.3 / 3)^2) + 40) ./ speeds / 3.6;
assert(whPerKm(1) > whPerKm(2) && whPerKm(3) > whPerKm(2));
assert(((5.5 + 3) / 5.5)^1.5 > ((5.5 + 1) / 5.5)^1.5);
writeLine(fid, 'PASS model sensitivity: 12 m/s uses less Wh/km than 6 and 18 m/s; larger payload raises power.');

% Compare the whole speed/load/TKE sweep, including the +40 W term.
ratio = sweep.speed / 12;
factor = 0.2 + 0.3 ./ ratio + 0.5 * ratio.^3;
sweep.MATLAB_power_W = basePower * ((5.5 + sweep.payload) / 5.5).^1.5 .* ...
    factor .* (1 + 0.6 * (sweep.tke / 3).^2) + 40;
sweep.MATLAB_Wh_per_km = sweep.MATLAB_power_W ./ sweep.speed / 3.6;
sweep.MATLAB_six_km_seconds = 6000 ./ sweep.speed;
assert(max(abs(sweep.MATLAB_power_W - sweep.power_W)) < 1e-8);
assert(max(abs(sweep.MATLAB_Wh_per_km - sweep.Wh_per_km)) < 1e-8);
assert(max(abs(sweep.MATLAB_six_km_seconds - sweep.six_km_seconds)) < 1e-8);
results.sweep = sweep;
writeLine(fid, sprintf('PASS %d speed/payload/TKE sweep cases independently recalculated.', height(sweep)));

% Replay invariant checks. MATLAB audits exported states, not the whole planner.
assert(all(abs(relay.elapsed_s - relay.flight_s - relay.hold_s - relay.swap_s) < 1e-7));
assert(all(relay.battery_Wh >= 220 * 0.20 - 1e-7));
assert(relay.status_code(end) == 4 && relay.completed_swaps(end) == 1);
assert(abs(relay.elapsed_s(end) - on.total_s) < 1e-6);
assert(all(abs(swaps.duration_s - 120) < 1e-8));
swapEndRows = find(diff(relay.completed_swaps) > 0) + 1;
assert(numel(swapEndRows) == height(swaps));
recharge = zeros(height(relay) - 1, 1);
for j = 1:numel(swapEndRows)
    recharge(swapEndRows(j) - 1) = 220 - swaps.before_Wh(j);
end
ledger = diff(relay.battery_Wh) + diff(relay.used_Wh) - recharge;
assert(max(abs(ledger)) < 1e-7, 'Battery ledger mismatch in mission replay.');
writeLine(fid, sprintf('PASS %d mission replay points: time ledger, reserve battery, swap reset and final ETA.', height(relay)));

% Independently integrate the recorded waiting inputs using hover power.
assert(all(hold.end_s > hold.start_s));
hold.MATLAB_power_W = basePower * ((5.5 + payload) / 5.5)^1.5 * 1.08 .* ...
    (1 + 0.6 * (hold.tke / 3).^2) + 4 * (hold.u.^2 + hold.v.^2) + 220 * hold.gust.^2 + 40;
hold.MATLAB_step_Wh = hold.MATLAB_power_W .* (hold.end_s - hold.start_s) / 3600;
hold.MATLAB_cumulative_Wh = cumsum(hold.MATLAB_step_Wh);
hold.displacement_m = hypot(hold.x_after - hold.x_before(1), ...
    hold.y_after - hold.y_before(1)) * gridKm * 1000;
assert(max(abs(hold.MATLAB_step_Wh - hold.energy_increment_Wh)) < 1e-8);
assert(max(abs(hold.MATLAB_cumulative_Wh - hold.hold_energy_Wh)) < 1e-7);
assert(all(hold.displacement_m < 1e-8));
assert(abs(sum(hold.end_s - hold.start_s) - 240) < 1e-8);
assert(abs(holdSummary.initial_battery_Wh - holdSummary.final_battery_Wh - ...
    hold.MATLAB_cumulative_Wh(end)) < 1e-7);
assert(holdSummary.final_status_code == 1 && hold.status_code(end) == 1);
assert(all(holdSummary{1, {'blocked_time_delta', 'blocked_energy_delta', 'blocked_motion_m'}} == 0));
results.hold = hold;
writeLine(fid, sprintf('PASS %d gust-wait steps: zero displacement, %.6f Wh independently integrated, automatic recovery.', ...
    height(hold), hold.MATLAB_cumulative_Wh(end)));

writetable(results.search, fullfile(root, 'matlab', 'search_verified.csv'));
writetable(results.routes, fullfile(root, 'matlab', 'metrics_verified.csv'));
writetable(sweep, fullfile(root, 'matlab', 'sweep_verified.csv'));
writetable(hold, fullfile(root, 'matlab', 'hold_verified.csv'));
writeLine(fid, 'LIMIT: source fields, wind constraints and numeric coefficients are synthetic; no real-weather or flight-data validation.');
writeLine(fid, 'ALL CHECKS PASSED');
disp('ALL CHECKS PASSED');
disp(logPath);
end

function writeLine(fid, line)
fprintf(fid, '%s\n', line);
fprintf('%s\n', line);
end
