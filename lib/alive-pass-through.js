var stream = require("stream");

function AlivePassThrough (options) {
	stream.PassThrough.call(this, options);
}

AlivePassThrough.prototype = Object.create(stream.PassThrough.prototype);
AlivePassThrough.prototype.constructor = AlivePassThrough;
AlivePassThrough.prototype.end = function () {};

module.exports = AlivePassThrough;
