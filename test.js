var assert = require("assert");
var fs = require("fs");
var path = require("path");
var EventEmitter = require('events');

var touch = require("touch");
var rimraf = require("rimraf");

var Watcher = require("./watcher");

function opts(options) {
	return Object.assign({}, defaultOptions, options || {});
}

var w;


describe("Watching", function () {
	beforeEach(function () {
		rimraf.sync("temp");
		fs.mkdirSync("temp");

		//cmdHelper = new CMDHelper();
		//cmdHelper.start();
	});

	afterEach(function (done) {
		rimraf.sync("temp");

		//cmdHelper.clean();
		w.stop(done);
	});
	it("negate globs");
	it("globs apply sequentially");

	it(".events", function (done) {
		var callback;
		function _callback () {
			if (callback) { callback.apply(this, arguments); }
		}

		w = new Watcher(["temp/a"], { events: ["create", "change"] }, _callback);

		w.start(function () {
			callback = function (fileName, event) {
				assert.equal("create", event);
				assert.equal("temp/a", fileName);
				callback = function (fileName, event) {
					assert.equal("change", event);
					assert.equal("temp/a", fileName);
					callback = function (fileName, event) {
						done(new Error("Delete event"));
					};
					rimraf.sync("temp/a");
					setTimeout(done, 500);
				};
				fs.writeFileSync("temp/a", "", "utf8");
			};
			touch.sync("temp/a");
		});
	});

	it("handle create", function (done) {
		var callback;
		function _callback () {
			if (callback) { callback.apply(this, arguments); }
		}

		w = new Watcher(["temp/a"], _callback);

		w.start(function () {
			callback = function (fileName, event) {
				assert.equal("create", event);
				assert.equal("temp/a", fileName);
				done();
			};
			touch.sync("temp/a");
		});
	});

	it("handle change", function (done) {
		var callback;
		function _callback () {
			if (callback) { callback.apply(this, arguments); }
		}

		w = new Watcher(["temp/a"], _callback);

		touch.sync("temp/a");
		w.start(function () {
			callback = function (fileName, event) {
				assert.equal("change", event);
				assert.equal("temp/a", fileName);
				done();
			};
			fs.writeFileSync("temp/a", "", "utf8");
		});
	});

	it("handle delete", function (done) {
		var callback;
		function _callback () {
			if (callback) { callback.apply(this, arguments); }
		}

		w = new Watcher(["temp/a"], _callback);

		touch.sync("temp/a");
		w.start(function () {
			callback = function (fileName, event) {
				assert.equal("delete", event);
				assert.equal("temp/a", fileName);
				done();
			};
			rimraf.sync("temp/a");
		});
	});

	it(".combineEvents + .debounce > 0");
	it(".combineEvents + .debounce == 0");

	it(".reglob");

	it("glob + callback arguments");
	it("glob + options + callback arguments");
	it("glob + options arguments");
	it("options arguments");
	it("options + callback arguments");
});

describe("Running", function () {
	it(".useShell == true");
	it(".useShell == false");

	it(".customShell");

	it(".type == exec");
	it(".type == reload");

	it(".throttle");

	it(".restartOnError == true");
	it(".restartOnError == false");

	it(".restartOnSuccess == true");
	it(".restartOnSuccess == false");

	it(".parallelLimit");

	it(".waitDone == true");
	it(".waitDone == false");

	it(".writeToConsole == true");
	it(".writeToConsole == false");

	it(".checkMtime == true");
	it(".checkMtime == false");

	it(".checkMD5 == true");
	it(".checkMD5 == false");
});

describe("API", function () {
	it(".stop() + .start()");

	it(".on(\"create\")");
	it(".on(\"change\")");
	it(".on(\"delete\")");
	it(".on(\"all\")");
});

