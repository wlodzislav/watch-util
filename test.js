var assert = require("assert");
var Watcher = require("./index");
var shelljs = require("shelljs");
var fs = require("fs");

describe("", function () {
	this.timeout(5000);

	before(function () {
		shelljs.rm("-rf", "temp");
		shelljs.mkdir("-p", "temp");
	});

	after(function() {
		shelljs.rm("-rf", "temp");
	});

	it("on create", function (done) {
		var watcher = new Watcher({ reglob: 10, debounce: 0 });

		watcher.addExecRule(["temp/a"], function (fileName, action) {
			assert.equal(fileName, "temp/a");
			assert.equal(action, "create");
			watcher.stopAll();
			done();
		});
		watcher.startAll();
		setTimeout(function () {
			shelljs.touch("temp/a");
		}, 0);
	});

	it("on change", function (done) {
		var watcher = new Watcher({ debounce: 0 });

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
		}, 0);
	});

	it("on change multiple", function (done) {
		var watcher = new Watcher({ debounce: 0 });

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
		}, 0);
	});

	it("on remove", function (done) {
		var watcher = new Watcher({ debounce: 0 });

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
		}, 0);
	});

	it("cmd exec", function (done) {
		var watcher = new Watcher({ reglob: 10, debounce: 0 });

		shelljs.touch("temp/d");
		watcher.addExecRule(["temp/d"], "touch temp/e");
		watcher.addExecRule(["temp/e"], function (fileName, action) {
			watcher.stopAll();
			done();
		});
		watcher.startAll();
		setTimeout(function () {
			shelljs.touch("temp/d");
		}, 0);
	});

	it("cmd restart", function (done) {
		var watcher = new Watcher({ reglob: 10, debounce: 0 });

		shelljs.touch("temp/f");
		watcher.addRestartRule(["temp/f"], "echo run >> temp/g; while true; do sleep 0.1; done;");
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
		watcher.startAll();
		setTimeout(function () {
			shelljs.touch("temp/f");
		}, 0);
	});
});
