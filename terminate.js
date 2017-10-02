var child = require('child_process');

var psTree = require('ps-tree');
var async = require("async");

function getProcessChildren(pid, callback) {
	psTree(pid, function (err, children) {
		if (err) { return callback(err); }
		children = children.map(function (c) { return +c.PID; });
		callback(null, children);
	});
}

function isDeadProcessKill(pid) {
	/* This stoped working on MacOs, node v7.2.0 */
	try {
		return process.kill(pid, 0);
	} catch (err) {
		return err.code !== "EPERM";
	}
	return true;
}

function isDeadPsAwk(pid) {
	return child.execSync("ps | awk -e '{ print $1 }'").toString().indexOf(pid) == -1
}

// HACK: determine working dead process check
var isDead = isDeadProcessKill(process.pid) ? isDeadPsAwk : isDeadProcessKill;

/*
	Last retry is always SIGKILL
*/
function terminate(pid, options, _callback) {
	options.signal = options.signal || "SIGTERM";
	options.checkInterval = options.checkInterval || 20;
	options.retryInterval = options.retryInterval || 500;
	options.retryCount = options.retryCount || 5;
	options.timeout = options.timeout || 5000;

	var once = false;
	var callback = function () {
		if (!once) {
			once = true;
			_callback.apply(null, arguments);
		}
	};

	function tryKillParent(pid, callback) {

		function retry(signal) {
			tries++;
			try {
				process.kill(pid, signal);
			} catch (err) {}

			checkDead()
		}

		retry(options.signal);

		var tries = 0;
		function checkDead() {
			var startCheckingDead = Date.now();
			var checkDeadIterval = setInterval(function () {
				if (Date.now() - startCheckingDead > options.retryInterval) {
					clearInterval(checkDeadIterval);
					if (tries < options.retryCount - 1) {
						retry(options.signal);
						checkDead();
					} else if (tries < options.retryCount) {
						checkDead();
					} else {
						var err = new Error("Can't kill process with pid = " + pid);
						callback(err);
					}
				}
				if (isDead(pid)) {
					clearInterval(checkDeadIterval);
					callback();
				}
			}, options.checkInterval);
		}
	}

	function tryKillParentWithChildren(pid, callback) {
		getProcessChildren(pid, function (err, children) {
			tryKillParent(pid, function (err) {
				if (err) { return callback(err); }

				var aliveChildren = children.filter(function (pid) { return !isDead(pid); });
				if (aliveChildren.length) {
					async.forEach(aliveChildren, function (pid, callback) {
						if (!isDead(pid)) {
							tryKillParentWithChildren(pid, callback);
						} else {
							callback();
						}
					}, callback)
				} else {
					callback();
				}
			});
		});
	}

	var timeoutTimeout = setTimeout(function () {
		var err = new Error("Timeout. Can't kill process with pid = " + pid);
		callback(err);
	}, options.timeout);

	tryKillParentWithChildren(pid, callback);
}

module.exports = terminate;
