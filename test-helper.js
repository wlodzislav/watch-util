var request = require("request");
var program = require("commander");

program
	.option("--port <port>", "")
	.option("--type <type>", "")
	.option("--exit <code>", "")

program.parse(process.argv);

if (program.type === "reload") {
	function onSig() {
		console.log("reload")
		request.get({ url: "http://localhost:" + program.port + "/reload" }, function () {
			process.exit(program.exit || 0);
		});
	}

	process.on("SIGTERM", onSig);
	process.on("SIGINT", onSig);
}

request.post({ url: "http://localhost:" + program.port + "/exec", data: { fileNames: program.argv }}, function () {
	if (program.type === "exec") {
		process.exit(program.exit || 0);
	}
});

