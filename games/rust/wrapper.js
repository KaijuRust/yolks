#!/usr/bin/env node

const { createLogger, format, transports } = require('winston');
const { combine, timestamp, printf } = format;
const LokiTransport = require('winston-loki');

// Create a Pino Loki transport
const lokiTransport = new LokiTransport({
  host: 'https://logs-prod-026.grafana.net',
  json: true,
  batching: false,
  basicAuth: `857711:${process.env.LOKI_PASSWORD}`,
  labels: { 'application': 'rust', 'server-name': process.env.HOSTNAME }
});

const myFormat = printf(({ message, timestamp }) => {
  return `${timestamp} ${message}`;
});

// Create a Winston logger
const logger = createLogger({
  level: 'info',
  format: combine(
      timestamp(),
      myFormat
  ),
  transports: [
    lokiTransport, // Add Pino Loki transport
    new transports.File({ filename: 'latest-winston.log' }),
    new transports.Console(), // Add other transports if needed
  ],
});

function sendLog(message) {
    var processed = message.replace(/(^\s*(?!.+)\n+)|(\n+\s+(?!.+)$)/g, "")
    if (processed.length === 0) return
    logger.info(processed)
}


var startupCmd = "";

const {performance} = require('perf_hooks');

var args = process.argv.splice(process.execArgv.length + 2);
for (var i = 0; i < args.length; i++) {
	if (i === args.length - 1) {
		startupCmd += args[i];
	} else {
		startupCmd += args[i] + " ";
	}
}

if (startupCmd.length < 1) {
	sendLog("Error: Please specify a startup command.");
	process.exit();
}

const seenPercentage = {};

function filter(data) {
	const str = data.toString();

	if (str.startsWith("Loading Prefab Bundle ")) { // Rust seems to spam the same percentage, so filter out any duplicates.
		const percentage = str.substr("Loading Prefab Bundle ".length);
		if (seenPercentage[percentage]) return;

		seenPercentage[percentage] = true;
	}

	sendLog(str);
}

var exec = require("child_process").exec;
sendLog('Starting Rust...');

var exited = false;
const gameProcess = exec(startupCmd);
gameProcess.stdout.on('data', filter);
gameProcess.stderr.on('data', filter);
gameProcess.on('exit', function (code, signal) {
	exited = true;

	if (code) {
		sendLog("Main game process exited with code " + code);

		process.exit(code);
	}
});

function initialListener(data) {
	const command = data.toString().trim();
	if (command === 'quit') {
		gameProcess.kill('SIGTERM');
	} else {
		sendLog('Unable to run "' + command + '" due to RCON not being connected yet.');
	}
}
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdin.on('data', initialListener);

process.on('exit', function (code) {
	if (exited) return;

	sendLog("Received request to stop the process, stopping the game...");

	gameProcess.kill('SIGTERM');
});

var waiting = true;
var pollingStartTime = undefined;

var poll = function () {
	function createPacket(command) {
		var packet = {
			Identifier: -1,
			Message: command,
			Name: "WebRcon"
		};
		return JSON.stringify(packet);
	}

	if (waiting === true && pollingStartTime == undefined) {
		pollingStartTime = performance.now();
	}

	var serverHostname = process.env.RCON_IP ? process.env.RCON_IP : "localhost";
	var serverPort = process.env.RCON_PORT;
	var serverPassword = process.env.RCON_PASS;
	var WebSocket = require("ws");
	var ws = new WebSocket("ws://" + serverHostname + ":" + serverPort + "/" + serverPassword);

	ws.on("open", function open() {
		let endTime = performance.now();
		let timeElapsed = endTime - pollingStartTime;

		var pollingDuration = Math.round(timeElapsed /= 1000);

		sendLog("Connected to RCON ("+pollingDuration+"s). Generating the map now. Please wait until the server status switches to \"Running\".");

		waiting = false;
		pollingStartTime = undefined;

		// Hack to fix broken console output
		ws.send(createPacket('status'));

		process.stdin.removeListener('data', initialListener);
		gameProcess.stdout.removeListener('data', filter);
		gameProcess.stderr.removeListener('data', filter);
		process.stdin.on('data', function (text) {
			ws.send(createPacket(text));
		});
	});

	ws.on("message", function (data, flags) {
		try {
			var json = JSON.parse(data);
			if (json !== undefined) {
				if (json.Message !== undefined && json.Message.length > 0) {
					sendLog(json.Message);
				}
			} else {
				sendLog("Error: Invalid JSON received");
			}
		} catch (e) {
			if (e) {
				sendLog(e);
			}
		}
	});

	ws.on("error", function (err) {
		waiting = true;

		let endTime = performance.now();
		let timeElapsed = endTime - pollingStartTime;

		var pollingDuration = Math.round(timeElapsed /= 1000);

		// If the server is taking too long to start, we should exit.
		if (pollingDuration > 900) {
			sendLog("RCON server took too long (15 minutes) to start. Exiting...");

			gameProcess.kill("SIGKILL");
			process.exit(1);
		}

		sendLog("Waiting for RCON to come up... (" + pollingDuration + "s)");
		setTimeout(poll, 5000);
	});

	ws.on("close", function () {
		if (!waiting) {
			sendLog("Connection to server closed.");

			exited = true;
			process.exit(0);
		}
	});
}
poll();
