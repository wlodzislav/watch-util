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

var callbackArguments = [];
var callback = function () {
	if (_callback) {
		_callback.apply(null, arguments);
	} else {
		callbackArguments.push(arguments);
	}
};

function expectCallback(fileName, event, callback) {
	_callback = function (f, e) {
		assert.equal(fileName, f);
		assert.equal(event, e);
		_callback = null;
		callback();
	}
	if (callbackArguments.length) {
		var args = callbackArguments.shift();
		_callback.apply(null, args);
	}
}

function expectNoCallback(delay, callback) {
	var timeout = setTimeout(callback, delay);

	_callback = function (f, e) {
		clearTimeout(timeout);
		_callback = null;
		callback(new Error("Callback is called with arguments " + [].join.call(arguments, ", ")));
	};
	if (callbackArguments.length) {
		var args = callbackArguments.shift();
		_callback.apply(null, args);
	}
};

describe("Watching", function () {
	beforeEach(function () {
		rimraf.sync("temp");
		fs.mkdirSync("temp");
	});

	afterEach(function (done) {
		rimraf.sync("temp");
		w.stop(done);
	});

	it("negate globs");
	it("globs apply sequentially");

	it("handle create", function (done) {
		w = new Watcher(["temp/a"], callback);

		w.start(function () {
			touch.sync("temp/a");
			expectCallback("temp/a", "create", done);
		});
	});

	it("handle change", function (done) {
		w = new Watcher(["temp/a"], callback);

		touch.sync("temp/a");
		w.start(function () {
			fs.writeFileSync("temp/a", "", "utf8");
			expectCallback("temp/a", "change", done);
		});
	});

	it("handle delete", function (done) {
		w = new Watcher(["temp/a"], callback);

		touch.sync("temp/a");
		w.start(function () {
			rimraf.sync("temp/a");
			expectCallback("temp/a", "delete", done);
		});
	});

	it("handle delete parent dir", function (done) {
		w = new Watcher(["temp/a"], callback);

		touch.sync("temp/a");
		w.start(function () {
			rimraf.sync("temp");
			expectCallback("temp/a", "delete", done);
		});
	});

	it(".events", function (done) {
		w = new Watcher(["temp/a"], { events: ["create", "change"] }, callback);

		w.start(function () {
			touch.sync("temp/a");
			expectCallback("temp/a", "create", function () {
				fs.writeFileSync("temp/a", "", "utf8");
				expectCallback("temp/a", "change", function () {
					rimraf.sync("temp/a");
					expectNoCallback(500, done);
				});
			});
		});
	});


	it(".combineEvents + .debounce > 0");

	it(".combineEvents + .debounce == 0");

	it(".reglob");
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

	it(".stdin");
});

describe("API", function () {
	it(".stop() + .start()");

	it(".on(\"create\")");
	it(".on(\"change\")");
	it(".on(\"delete\")");
	it(".on(\"all\")");
	it(".on(\"exec\")");
	it(".on(\"reload\")");
	it(".on(\"killed\")");
	it(".on(\"crashed\")");
	it(".on(\"exited\")");

	it(".stdout");
	it(".stderr");
	it(".stdin");
});

