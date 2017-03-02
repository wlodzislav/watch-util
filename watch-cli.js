var program = require('commander');
var Watcher = require("./index");

program
	.usage("[options] -- <shell cmd>\n\n    Util for restarting/execution  shell commands on files changes")
	.option("-e --exec", "Execute comand on changes, not reload")
	.option("-g --glob <patterns>", "Patterns to watch, separated by comma, ignore pattern starts with '!', for exact pattern syntax see: https://github.com/isaacs/node-glob")
	.option("-d --debounce <ms>", "Debounce exec/reload by ms, used for editors like vim that mv then rm files for crash safety")
	.option("-G --reglob <ms>", "Reglob interval to track new added files, on ms")
	.option("--no-restart-on-error", "Don't restart cmd if cmd crashes or exited with non 0 status")
	.option("--restart-on-success", "Restart cmd if cmd exited with 0 status")
	.option("--debug", "Print debug info");

program.on('--help', function(){
  console.log('  Examples:\n');
  console.log('    $ cli.js -e -g \'**/*.js,!node_modules\' mocha');
  console.log('    $ cli.js -g \'**/*.js,!node_modules\' node server.js');
});

program.parse(process.argv);

var watcher = Watcher(program);

if (program.exec) {
	watcher.addExecRule(program.glob, program.args.join(" "));
} else {
	watcher.addRestartRule(program.glob, program.args.join(" "));
}

watcher.startAll();
