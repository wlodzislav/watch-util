var fs = require("fs");
var path = require("path");
var program = require("commander");

function sendEventSync(event, data) {
	data = data || {};
	data.timestamp = Date.now();
	console.log("send", event, data);
	fs.appendFileSync(program.log, JSON.stringify({ event, data }) + "\n", "utf8");

}
process.on("uncaughtException", function (err) {
	console.error(err);
	sendEventSync("crash");
});

program
	.option("--exit <value>", "")
	.option("--event <value>", "")
	.option("--cwd <value>", "")
	.option("--rel-file <value>", "")
	.option("--file <value>", "")
	.option("--rel-dir <value>", "")
	.option("--dir <value>", "")
	.option("--stay-alive", "Stay alive until killed")
	.option("--delay [n]", "Delay exit by ms")
	.option("--exit [code]", "Exit code")
	.option("--log [path]", "Log file path")

program.parse(process.argv);

sendEventSync("run");

if (program.stayAlive) {
	function onSig() {
		sendEventSync("killed")
		setTimeout(function () {
			console.log("exit");
			process.exit(program.exit || 0);
		}, program.delay || 0);
	}

	process.on("SIGTERM", onSig);
	process.on("SIGINT", onSig);
	setInterval(function () {}, 10000);
} else {
	var relFiles;
	var files;

	var data = {
		event: program.event,
		cwd: program.cwd,
		relFile: program.relFile,
		file: program.file,
		relDir: program.relDir,
		dir: program.dir,
	};

	var firstDelimiterIndex = process.argv.indexOf("--");
	if (firstDelimiterIndex != -1) {
		var secondDelimiterIndex = process.argv.indexOf("--", firstDelimiterIndex + 1);
		if (secondDelimiterIndex != -1) {
			data.relFiles = process.argv.slice(firstDelimiterIndex + 1, secondDelimiterIndex);
			data.files = process.argv.slice(secondDelimiterIndex + 1);
		}
	}

	for (var key in data) {
		if (data[key] && data[key].startsWith && data[key].startsWith("%") || !data[key]) {
			delete data[key];
		}
	}
	setTimeout(function () {
		console.log("exit");
		process.exit(program.exit || 0);
	}, program.delay || 0);
}

