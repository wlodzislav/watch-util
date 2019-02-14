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
	//console.log(arguments);
	if (_callback) {
		_callback.apply(null, arguments);
	} else {
		callbackArguments.push(arguments);
	}
};

function expectCallback() {
	if (arguments.length == 3) {
		var fileName = arguments[0];
		var event = arguments[1];
		var callback = arguments[2];
		_callback = function (f, e) {
			assert.equal(f, fileName);
			assert.equal(e, event);
			_callback = null;
			callback();
		}
	} else {
		var fileNames = arguments[0];
		var callback = arguments[1];
		_callback = function (f) {
			assert.deepEqual(f, fileNames);
			_callback = null;
			callback();
		}
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

function create(f) {
	fs.writeFileSync(f, "", "utf8");
}

var change = create;

function rm(f) {
	rimraf.sync(f);
}

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
			create("temp/a");
			expectCallback("temp/a", "create", done);
		});
	});

	it("handle change", function (done) {
		w = new Watcher(["temp/a"], callback);

		create("temp/a");
		w.start(function () {
			change("temp/a");
			expectCallback("temp/a", "change", done);
		});
	});

	it("handle delete", function (done) {
		w = new Watcher(["temp/a"], callback);

		create("temp/a");
		w.start(function () {
			rm("temp/a");
			expectCallback("temp/a", "delete", done);
		});
	});

	it("handle delete parent dir", function (done) {
		w = new Watcher(["temp/a"], callback);

		create("temp/a");
		w.start(function () {
			rm("temp");
			expectCallback("temp/a", "delete", done);
		});
	});

	it(".events", function (done) {
		w = new Watcher(["temp/a"], { events: ["create", "change"] }, callback);

		w.start(function () {
			create("temp/a");
			expectCallback("temp/a", "create", function () {
				change("temp/a");
				expectCallback("temp/a", "change", function () {
					rm("temp/a");
					expectNoCallback(500, done);
				});
			});
		});
	});


	it(".combineEvents same file", function (done) {
		w = new Watcher(["temp/a"], { debounce: 1000, combineEvents: true }, callback);

		create("temp/a");
		w.start(function () {
			change("temp/a");
			delete("temp/a");
			expectCallback(["temp/a"], done);
		});
	});

	it(".combineEvents multiple files", function (done) {
		w = new Watcher(["temp/a", "temp/b"], { debounce: 1000, combineEvents: true }, callback);

		create("temp/a");
		create("temp/b");
		w.start(function () {
			change("temp/a");
			change("temp/b");
			expectCallback(["temp/a", "temp/b"], done);
		});
	});

	it(".combineEvents == true + .debounce", function (done) {
		w = new Watcher(["temp/a", "temp/b"], { debounce: 1000, combineEvents: true }, callback);

		create("temp/a");
		create("temp/b");
		w.start(function () {
			change("temp/a");
			change("temp/b");
			setTimeout(function () {
				change("temp/b");
			}, 1100);
			expectCallback(["temp/a", "temp/b"], function () {
				expectCallback(["temp/b"], done);
			});
		});
	});

	it(".combineEvents == false + .debounce", function (done) {
		w = new Watcher(["temp/a", "temp/b"], { debounce: 1000, combineEvents: false }, callback);

		create("temp/a");
		create("temp/b");
		w.start(function () {
			change("temp/a");
			change("temp/b");
			setTimeout(function () {
				change("temp/a");
			}, 500);
			setTimeout(function () {
				change("temp/b");
			}, 1100);
			expectCallback("temp/b", "change", function () {
				expectCallback("temp/a", "change", function () {
					expectCallback("temp/b", "change", done);
				});
			});
		});
	});

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

