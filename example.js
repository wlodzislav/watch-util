var Watcher = require("./index");

var watcher = Watcher({ });

watcher.addRestartRule("*.js", 'node -e "setInterval(function () { console.log(Date.now()); }, 1000);"').start();

process.on("SIGINT", function () {
	console.log("SIGINT");
	process.exit(0);
});
