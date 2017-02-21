var assert = require("assert");
var Watcher = require("./index");
var shelljs = require("shelljs");

describe("file watching", function () {
	afterEach(function() {
		shelljs.rm("-rf", "test-temp");
	});

	it("create", function (done) {
		var watcher = new Watcher({ reglob: 100, debounce: 0 });

		shelljs.mkdir("-p", "test-temp");
		watcher.addExecRule(["test-temp/a"], function (fileName, action) {
			assert.equal(fileName, "test-temp/a");
			assert.equal(action, "create");
			watcher.stopAll();
			done();
		});
		watcher.startAll();
		setTimeout(function () {
			shelljs.touch("test-temp/a");
		}, 0);
	});

	it("change", function (done) {
		var watcher = new Watcher({ debounce: 0 });

		shelljs.mkdir("-p", "test-temp");
		shelljs.touch("test-temp/a");
		watcher.addExecRule(["test-temp/a"], function (fileName, action) {
			assert.equal(fileName, "test-temp/a");
			assert.equal(action, "change");
			watcher.stopAll();
			done();
		});
		watcher.startAll();
		setTimeout(function () {
			shelljs.touch("test-temp/a");
		}, 0);
	});

	it("remove", function (done) {
		var watcher = new Watcher({ debounce: 0 });

		shelljs.mkdir("-p", "test-temp");
		shelljs.touch("test-temp/a");
		watcher.addExecRule(["test-temp/a"], function (fileName, action) {
			assert.equal(fileName, "test-temp/a");
			assert.equal(action, "remove");
			watcher.stopAll();
			done();
		});
		watcher.startAll();
		setTimeout(function () {
			shelljs.rm("test-temp/a");
		}, 0);
	});
});
