var assert = require("assert");
var Watcher = require("./index").Watcher;
var shelljs = require("shelljs");
var fs = require("fs");

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

	it("on create", function (done) {
		var watcher = new Watcher({ reglob: 10, debounce: 0, mtimeCheck: false });

		watcher.addExecRule(["temp/a"], function (fileName, action) {
			assert.equal(fileName, "temp/a");
			assert.equal(action, "create");
			watcher.stopAll();
			done();
		});
		watcher.startAll();
		setTimeout(function () {
			shelljs.touch("temp/a");
		}, 100);
	});

	it("on change", function (done) {
		var watcher = new Watcher({ debounce: 0, mtimeCheck: false });

		shelljs.touch("temp/b");
		watcher.addExecRule(["temp/b"], function (fileName, action) {
			assert.equal(fileName, "temp/b");
			assert.equal(action, "change");
			watcher.stopAll();
			done();
		});
		watcher.startAll();
		setTimeout(function () {
			shelljs.touch("temp/b");
		}, 100);
	});

	it("on change multiple", function (done) {
		var watcher = new Watcher({ debounce: 0, mtimeCheck: false });

		shelljs.touch("temp/b2");
		var changes = 0;
		watcher.addExecRule(["temp/b2"], function (fileName, action) {
			assert.equal(fileName, "temp/b2");
			assert.equal(action, "change");
			changes++;

			if (changes == 1) {
				setTimeout(function () {
					shelljs.touch("temp/b2");
				}, 0);
			}

			if (changes >= 2) {
				watcher.stopAll();
				done();
			}
		});
		watcher.startAll();
		setTimeout(function () {
			shelljs.touch("temp/b2");
		}, 100);
	});

	it("on remove", function (done) {
		var watcher = new Watcher({ debounce: 0, mtimeCheck: false });

		shelljs.touch("temp/c");
		watcher.addExecRule(["temp/c"], function (fileName, action) {
			assert.equal(fileName, "temp/c");
			assert.equal(action, "remove");
			watcher.stopAll();
			done();
		});
		watcher.startAll();
		setTimeout(function () {
			shelljs.rm("temp/c");
		}, 100);
	});

	it("cmd exec", function (done) {
		var watcher = new Watcher({ reglob: 10, debounce: 0, mtimeCheck: false });

		shelljs.touch("temp/d");
		watcher.addExecRule(["temp/e"], function (fileName, action) {
			watcher.stopAll();
			done();
		});
		watcher.addExecRule(["temp/d"], "touch temp/e");
		watcher.startAll();
		setTimeout(function () {
			shelljs.touch("temp/d");
		}, 100);
	});

	it("cmd restart", function (done) {
		var watcher = new Watcher({ reglob: 10, debounce: 0, restartSignal: "SIGKILL", mtimeCheck: false });

		shelljs.touch("temp/f");
		var changes = 0;
		watcher.addExecRule(["temp/g"], function (fileName, action) {
			changes++;

			if (changes === 1) {
				setTimeout(function () {
					shelljs.touch("temp/f");
				}, 0);
			}
			if (changes >= 3) {
				var content = fs.readFileSync("temp/g", "utf8");
				assert.equal(content, "run\nrun\nrun\n");
				watcher.stopAll();
				done();
			}
		});
		watcher.addRestartRule(["temp/f"], "echo run >> temp/g; while true; do sleep 0.1; done;");
		watcher.startAll();
		setTimeout(function () {
			shelljs.touch("temp/f");
		}, 200);
	});

	it("cmd restart, exiting cmd", function (done) {
		var watcher = new Watcher({ reglob: 10, debounce: 0, restartSignal: "SIGKILL", mtimeCheck: false });

		shelljs.touch("temp/f");
		var changes = 0;
		watcher.addExecRule(["temp/g"], function (fileName, action) {
			changes++;

			if (changes === 1) {
				setTimeout(function () {
					shelljs.touch("temp/f");
				}, 0);
			}
			if (changes >= 3) {
				var content = fs.readFileSync("temp/g", "utf8");
				assert.equal(content, "run\nrun\nrun\nrun\nrun\nrun\n");
				watcher.stopAll();
				done();
			}
		});
		watcher.addRestartRule(["temp/f"], "echo run >> temp/g; sleep 0.1");
		watcher.startAll();
		setTimeout(function () {
			shelljs.touch("temp/f");
		}, 200);
	});

	it("cmd restart on error", function (done) {
		var watcher = new Watcher({ reglob: 10, debounce: 0, stopSignal: "SIGKILL", mtimeCheck: false });

		var changes = 0;
		watcher.addExecRule(["temp/g2"], function (fileName, action) {
			changes++;

			if (changes >= 5) {
				watcher.stopAll();
				done();
			}
		});
		watcher.addRestartRule(["temp/f2"], { restartOnError: true }, "echo run >> temp/g2; exit 1;");
		watcher.startAll();
	});

	it("cmd don't restart on error", function (done) {
		var watcher = new Watcher({ reglob: 10, debounce: 0, mtimeCheck: false });

		var changes = 0;
		watcher.addExecRule(["temp/g3"], function (fileName, action) {
			changes++;
		});
		watcher.addRestartRule(["temp/f3"], { restartOnError: false }, "echo run >> temp/g3; exit 1;");
		setTimeout(function () {
			assert.equal(changes, 1);
			watcher.stopAll();
			done();
		}, 300);
		watcher.startAll();
	});
	
	it("cmd restart on success", function (done) {
		var watcher = new Watcher({ reglob: 10, debounce: 0, mtimeCheck: false });

		var changes = 0;
		watcher.addExecRule(["temp/g4"], function (fileName, action) {
			changes++;

			if (changes >= 5) {
				watcher.stopAll();
				done();
			}
		});
		watcher.addRestartRule(["temp/f4"], { restartOnSuccess: true }, "echo run >> temp/g4; exit 0;");
		watcher.startAll();
	});

	it("cmd don't restart on success", function (done) {
		var watcher = new Watcher({ reglob: 10, debounce: 0, mtimeCheck: false });

		var changes = 0;
		watcher.addExecRule(["temp/g5"], function (fileName, action) {
			changes++;
		});
		watcher.addRestartRule(["temp/f5"], { restartOnSuccess: false }, "echo run >> temp/g5; exit 0;");
		setTimeout(function () {
			assert.equal(changes, 1);
			watcher.stopAll();
			done();
		}, 300);
		watcher.startAll();
	});
});
