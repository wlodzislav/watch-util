var program = require('commander');
var Watcher = require("./index");

program
	.option("-e --exec", "")
	.option("-g --glob <patterns>", "")
	.option("-d --debounce <ms>", "")
	.option("-G --reglob <ms>", "")
	.option("--restart-on-error", "") // supports --no-
	.option("--restart-on-success", "")
	.option("--debug", "");

program.parse(process.argv);
program.cmd = "CMD";

var watcher = Watcher(program);

if (program.exec) {
	watcher.addExecRule(program.glob.split(","), program.args.join(" "));
} else {
	watcher.addRestartRule(program.glob.split(","), program.args.join(" "));
}

watcher.startAll();
