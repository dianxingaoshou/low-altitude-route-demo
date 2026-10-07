function results = verify_analytic_cases()
% Closed-form checks make the reference answer independent of random fixtures.
root = fileparts(fileparts(mfilename('fullpath')));
f = fullfile(root,'matlab','fixtures');
w = readtable(fullfile(f,'analytic_wind_cases.csv'),'Delimiter',',','ReadVariableNames',true,'VariableNamingRule','preserve');
s = readtable(fullfile(f,'analytic_scalar_cases.csv'),'Delimiter',',','ReadVariableNames',true,'VariableNamingRule','preserve');
% Manually derived answers: v_a=12, m_load=k=gust=0, d=6000 m.
gs = [12;18;6;sqrt(108);0;0;26];
p = [690;834;834;834;1266;1266;1474];
allowed = [1;1;1;1;0;0;0];
dt = [500;1000/3;1000;6000/sqrt(108);NaN;NaN;NaN];
wh = p.*dt/3600;
assert(height(w)==7 && all(abs(w.ground_speed-gs)<1e-10));
assert(all(abs(w.power_W-p)<1e-10) && all(w.flyable==allowed));
ok = allowed==1;
assert(all(abs(w.seconds(ok)-dt(ok))<1e-9));
assert(all(abs(w.energy_Wh(ok)-wh(ok))<1e-9));
assert(all(isnan(w.seconds(~ok))) && all(isnan(w.energy_Wh(~ok))));
w.closed_form_ground_speed=gs; w.closed_form_power_W=p;
w.closed_form_seconds=dt; w.closed_form_energy_Wh=wh;
w.energy_error_Wh=abs(w.energy_Wh-wh);
expected=[6;6.48;6*(1+200*0.3^1.5);742;sqrt(0.2);1];
assert(height(s)==6 && max(abs(s.JS_value-expected))<1e-9);
s.closed_form_value=expected; s.absolute_error=abs(s.JS_value-expected);
% Analytic derivatives of the teaching model (not a measured optimum).
xME=(0.2)^0.25;
assert(abs(-0.3/xME^2+1.5*xME^2)<1e-12);
A=650*((5.5+1)/5.5)^1.5*(1+0.6*(0.3/3)^2);
xMR=fzero(@(x) x^4-(0.2+40/A)*x-0.6,[0.4 1.4]);
assert(abs(A*xMR^4-(0.2*A+40)*xMR-0.6*A)<1e-8);
% Independently check an exactly specified two-leg battery/time ledger.
B0=220*0.95; reserve=220*0.20;
beforeSwap=B0-50; recharge=220-beforeSwap; final=220-100;
assert(beforeSwap>=reserve && final>=reserve);
assert(abs(B0+recharge-150-final)<1e-12);
assert(500+120+500==1120);
results=struct('wind',w,'scalars',s,'minimum_power_speed_mps',12*xME,...
    'calm_minimum_Wh_per_km_speed_mps',12*xMR,'battery_final_Wh',final);
writetable(w,fullfile(root,'matlab','analytic_wind_verified.csv'));
writetable(s,fullfile(root,'matlab','analytic_scalar_verified.csv'));
fid=fopen(fullfile(root,'matlab','analytic_verification_report.txt'),'w','n','UTF-8');
assert(fid>0); cleanup=onCleanup(@() fclose(fid));
fprintf(fid,'PASS seven closed-form wind cases; six scalar web checks.\n');
fprintf(fid,'Calm 6 km: 500 s, 690 W, %.8f Wh.\n',wh(1));
fprintf(fid,'Hover 120 s: 742 W, %.8f Wh.\n',742*120/3600);
fprintf(fid,'Teaching-model minimum-power speed: %.8f m/s.\n',12*xME);
fprintf(fid,'Teaching-model calm minimum-Wh/km speed (payload 1 kg, TKE 0.3): %.8f m/s.\n',12*xMR);
fprintf(fid,'PASS analytic battery/time arithmetic; this ledger does not replay the JS mission planner.\n');
fprintf(fid,'LIMIT: equations and synthetic coefficients are not calibrated aircraft performance.\n');
fprintf('PASS closed-form verification: seven wind cases and six scalar checks.\n');
fprintf('Model-only optimum speeds: power %.5f m/s; energy/km %.5f m/s.\n',12*xME,12*xMR);
end
