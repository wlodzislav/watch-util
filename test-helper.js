var fs = require("fs");
var path = require("path");
var program = require("commander");

program
	.option("--type <value>", "")
	.option("--exit <value>", "")
	.option("--action-value <value>", "")
	.option("--cwd <value>", "")
	.option("--rel-file <value>", "")
	.option("--file <value>", "")
	.option("--rel-dir <value>", "")
	.option("--dir <value>", "")

program.parse(process.argv);

function sendSync(event, data) {
	fs.appendFileSync(path.join(__dirname, "log"), JSON.stringify({ event, data }) + "\n", "utf8");

}

if (program.type === "reload") {
	function onSig() {
		sendSync("reloaded")
		process.exit(program.exit || 0);
	}

	process.on("SIGTERM", onSig);
	process.on("SIGINT", onSig);
	setInterval(function () {}, 10000);
} else {
	var relFiles;
	var files;

	var data = {
		timestamp: Date.now(),
		action: program.actionValue,
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

	sendSync("exec", data);
	process.exit(program.exit || 0);
}

