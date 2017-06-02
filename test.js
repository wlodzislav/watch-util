var assert = require("assert");
var shelljs = require("shelljs");
var fs = require("fs");
var assign = require("./utils").assign;

var Watcher = require("./index").Watcher;

describe("", function () {
	this.timeout(5000);
	this.slow(500);

	before(function () {
		shelljs.rm("-rf", "temp");
		shelljs.mkdir("-p", "temp");
	});

	after(function() {
		shelljs.rm("-rf", "temp");
	});

	afterEach(function (done) {
		// wait for watcher to close
		setTimeout(done, 100);
	});

	var defaultOptions = { reglob: 50, debounce: 0, mtimeCheck: false };

	it("on create", function (done) {
		var w = new Watcher(["temp/a"], assign({ type: "exec" }, defaultOptions), function (fileName, action) {
			assert.equal(fileName, "temp/a");
			assert.equal(action, "create");
			w.stop();
			done();
		});
		w.start();

		setTimeout(function () {
			shelljs.touch("temp/a");
		}, 100);
	});

	it("on change", function (done) {
		shelljs.touch("temp/b");
		var w = Watcher(["temp/b"], assign({ type: "exec" }, defaultOptions), function (fileName, action) {
			assert.equal(fileName, "temp/b");
			assert.equal(action, "change");
			w.stop();
			done();
		});
		w.start();

		setTimeout(function () {
			shelljs.touch("temp/b");
		}, 100);
	});

	it("on change multiple", function (done) {
		shelljs.touch("temp/b2");
		var changes = 0;
		var w = Watcher(["temp/b2"], assign({ type: "exec" }, defaultOptions), function (fileName, action) {
			assert.equal(fileName, "temp/b2");
			assert.equal(action, "change");
			changes++;

			if (changes == 1) {
				setTimeout(function () {
					shelljs.touch("temp/b2");
				}, 0);
			}

			if (changes >= 2) {
				w.stop();
				done();
			}
		});
		w.start();

		setTimeout(function () {
			shelljs.touch("temp/b2");
		}, 100);
	});

	it("on remove", function (done) {
		shelljs.touch("temp/c");
		var w = Watcher(["temp/c"], assign({ type: "exec" }, defaultOptions), function (fileName, action) {
			assert.equal(fileName, "temp/c");
			assert.equal(action, "remove");
			w.stop();
			done();
		});
		w.start();

		setTimeout(function () {
			shelljs.rm("temp/c");
		}, 100);
	});

	it("cmd exec", function (done) {
		shelljs.touch("temp/d");
		var w1 = Watcher(["temp/e"], assign({ type: "exec" }, defaultOptions), function (fileName, action) {
			w1.stop();
			w2.stop();
			done();
		});
		var w2 = Watcher(["temp/d"], assign({ type: "exec", shell: "node -e" }, defaultOptions), "require(\"shelljs\").touch(\"temp/e\")");

		w1.start();
		w2.start();
		setTimeout(function () {
			shelljs.touch("temp/d");
		}, 100);
	});

	it("cmd restart", function (done) {
		shelljs.touch("temp/f");
		var changes = 0;
		var w1 = Watcher(["temp/g"], assign({ type: "exec" }, defaultOptions), function (fileName, action) {
			changes++;

			if (changes === 1) {
				setTimeout(function () {
					shelljs.touch("temp/f");
				}, 0);
			}
			if (changes >= 2) {
				var content = fs.readFileSync("temp/g", "utf8");
				assert.ok(content.startsWith("run\nrun\n"));
				w1.stop();
				w2.stop();
				done();
			}
		});
		var w2 = Watcher(["temp/f"], assign({ shell: "node -e", writeToConsole: false }, defaultOptions), "require(\"shelljs\").echo(\"run\\n\").toEnd(\"temp/g\"); setInterval(function () {}, 100);");

		w1.start();
		w2.start();
		setTimeout(function () {
			shelljs.touch("temp/f");
		}, 50);
	});

	it("cmd restart, exiting cmd", function (done) {
		shelljs.touch("temp/b2");
		var changes = 0;
		var w1 = Watcher(["temp/a2"], assign({ type: "exec" }, defaultOptions), function (fileName0, action) {
			changes++;

			if (changes === 1) {
				setTimeout(function () {
					shelljs.touch("temp/b2");
				}, 0);
			}
			if (changes >= 2) {
				var content = fs.readFileSync("temp/a2", "utf8");
				assert.ok(content.startsWith("run\nrun\n"));
				w1.stop();
				w2.stop();
				done();
			}
		});
		var w2 = Watcher(["temp/b2"],  assign({ shell: "node -e", writeToConsole: false }, defaultOptions), "require(\"shelljs\").echo(\"run\\n\").toEnd(\"temp/a2\"); setTimeout(function () {}, 100);");

		w1.start();
		w2.start();
		setTimeout(function () {
			shelljs.touch("temp/b2");
		}, 50);
	});

	it("cmd restart on error", function (done) {
		var changes = 0;
		var w1 = Watcher(["temp/g2"], assign({ type: "exec" }, defaultOptions), function (fileName, action) {
			changes++;

			if (changes >= 5) {
				w1.stop();
				w2.stop();
				done();
			}
		});
		var w2 = Watcher(["temp/f2"], assign({ shell: "node -e", writeToConsole: false, restartOnError: true }, defaultOptions), "require(\"shelljs\").echo(\"run\\n\").toEnd(\"temp/g2\"); process.exit(1);");

		w1.start();
		w2.start();
	});

	it("cmd don't restart on error", function (done) {
		var changes = 0;
		var w1 = Watcher(["temp/g3"], assign({ type: "exec" }, defaultOptions), function (fileName, action) {
			changes++;
		});
		var w2 = Watcher(["temp/f3"], assign({ shell: "node -e", writeToConsole: false, restartOnError: false }, defaultOptions), "require(\"shelljs\").echo(\"run\\n\").toEnd(\"temp/g3\"); process.exit(1);");
		setTimeout(function () {
			assert.equal(changes, 1);
			w1.stop();
			w2.stop();
			done();
		}, 300);
		w1.start();
		w2.start();
	});
	
	it("cmd restart on success", function (done) {
		var changes = 0;
		var w1 = Watcher(["temp/g4"], assign({ type: "exec" }, defaultOptions), function (fileName, action) {
			changes++;

			if (changes >= 5) {
				w1.stop();
				w2.stop();
				done();
			}
		});
		var w2 = Watcher(["temp/f4"], assign({ shell: "node -e", writeToConsole: false, restartOnSuccess: true }, defaultOptions), "require(\"shelljs\").echo(\"run\\n\").toEnd(\"temp/g4\"); process.exit(0);");
		w1.start();
		w2.start();
	});

	it("cmd don't restart on success", function (done) {
		var changes = 0;
		var w1 = Watcher(["temp/g5"], assign({ type: "exec" }, defaultOptions), function (fileName, action) {
			changes++;
		});
		var w2 = Watcher(["temp/f5"], assign({ shell: "node -e", writeToConsole: false, restartOnSuccess: false }, defaultOptions), "require(\"shelljs\").echo(\"run\\n\").toEnd(\"temp/g5\"); process.exit(0);");
		setTimeout(function () {
			assert.equal(changes, 1);
			w1.stop();
			w2.stop();
			done();
		}, 300);
		w1.start();
		w2.start();
	});
});
