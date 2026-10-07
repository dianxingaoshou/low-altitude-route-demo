function results = run_validation()
% Run independent checks and generate six PNG/PDF/FIG evidence figures.
% First run "npm run matlab:fixtures" in the repository terminal.
results = verify_demo();
outputDir = make_validation_figures(results);
save(fullfile(outputDir, 'verified_results.mat'), 'results');
fprintf('\nFigures saved to: %s\n', outputDir);
end
