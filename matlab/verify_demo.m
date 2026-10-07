function verify_demo()
% Independent MATLAB numerical checks of the classroom JavaScript simulator.
% Inputs are exported by export-fixtures.cjs; all formulae below are recomputed.
root = fileparts(fileparts(mfilename('fullpath')));
fixtures = fullfile(root, 'matlab', 'fixtures');
edges = readtable(fullfile(fixtures, 'graph_edges.csv'));
routes = readtable(fullfile(fixtures, 'route_expected.csv'));
segments = readtable(fullfile(fixtures, 'route_segments.csv'));
mission = readtable(fullfile(fixtures, 'mission_expected.csv'));
safety = readtable(fullfile(fixtures, 'safety_cases.csv'));
assert(height(edges) > 0 && height(routes) == 9 && height(segments) > 0);

nx = 61; ny = 41; gridKm = 0.2; alpha = 200; beta = 1.5;
startNode = 20 * nx + 4 + 1; endNode = 20 * nx + 34 + 1;
speed = 12; payload = 1; basePower = 650;
logPath = fullfile(root, 'matlab', 'verification_report.txt');
fid = fopen(logPath, 'w', 'n', 'UTF-8');
assert(fid > 0, 'Cannot create verification report.');
cleanup = onCleanup(@() fclose(fid));
writeLine(fid, 'MATLAB R2024b independent numeric validation');
writeLine(fid, 'Same synthetic inputs as the web demo; this is software verification, not field validation.');

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
    assert(abs(shortestKm - expectedShort.distance_km) < 2e-4, ...
        sprintf('Shortest path mismatch for seed %d', seed));

    paperGraph = digraph(graphRows.u, graphRows.v, paperWeights, nx * ny);
    [~, matlabCost] = shortestpath(paperGraph, startNode, endNode, 'Method', 'positive');
    expectedPaper = routes(routes.seed == seed & routes.method_code == 1, :);
    assert(height(expectedPaper) == 1);
    assert(abs(matlabCost - expectedPaper.paper_cost) < 2e-4, ...
        sprintf('Paper-cost A* mismatch for seed %d', seed));
    writeLine(fid, sprintf('PASS seed %d: shortest %.4f km; MATLAB Dijkstra paper cost %.4f; JS A* %.4f', ...
        seed, shortestKm, matlabCost, expectedPaper.paper_cost));
end

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
    assert(abs(sum(distance) - expected.distance_km) < 2e-4, sprintf('Distance mismatch on route %d', routeId));
    assert(abs(dose - expected.tke_exposure) < 2e-4, sprintf('TKE dose mismatch on route %d', routeId));
    assert(abs(sum(seconds) - expected.flight_s) < 0.02, sprintf('Time mismatch on route %d', routeId));
    assert(abs(energyWh - expected.energy_Wh) < 0.02, sprintf('Energy mismatch on route %d', routeId));
    assert(abs(paperCost - expected.paper_cost) < 2e-4, sprintf('Paper cost mismatch on route %d', routeId));
end
writeLine(fid, sprintf('PASS %d route metric checks: distance, TKE dose, flight time, energy, paper cost', height(routes)));

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
writeLine(fid, sprintf('PASS %d local wind-safety cases: calm, tailwind, excessive headwind/crosswind/wind limit', height(safety)));

% Sensitivity checks of the illustrative power model, not aircraft calibration.
speeds = [6 12 18];
ratio = speeds / 12;
factor = 0.2 + 0.3 ./ ratio + 0.5 * ratio.^3;
whPerKm = basePower * ((5.5 + payload) / 5.5)^1.5 .* factor ./ speeds / 3.6;
assert(whPerKm(1) > whPerKm(2) && whPerKm(3) > whPerKm(2));
assert(((5.5 + 3) / 5.5)^1.5 > ((5.5 + 1) / 5.5)^1.5);
writeLine(fid, 'PASS model sensitivity: 12 m/s uses less Wh/km than 6 and 18 m/s; larger payload raises power.');
writeLine(fid, 'LIMIT: source fields, wind constraints and numeric coefficients are synthetic; no real-weather or flight-data validation.');
writeLine(fid, 'ALL CHECKS PASSED');
disp('ALL CHECKS PASSED');
disp(logPath);
end

function writeLine(fid, line)
fprintf(fid, '%s\n', line);
fprintf('%s\n', line);
end
