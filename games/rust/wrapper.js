#!/usr/bin/env node

const winston = require('winston');
const LokiTransport = require('winston-loki');

// Create a Pino Loki transport
const lokiTransport = new LokiTransport({
  host: 'https://logs-prod-026.grafana.net',
  json: true,
  batching: false,
  basicAuth: `857711:${process.env.LOKI_PASSWORD}`,
  labels: { 'application': 'rust', 'server-name': process.env.HOSTNAME }
});

// Create a Winston logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    lokiTransport, // Add Pino Loki transport
    new winston.transports.File({ filename: 'latest-winston.log', format: winston.format.simple() }),
    new winston.transports.Console({ format: winston.format.simple() }), // Add other transports if needed
  ],
});



var startupCmd = "";
const fs = require("fs");
fs.writeFile("latest.log", "", (err) => {
	if (err) console.log("Callback error in appendFile:" + err);
});

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
	console.log("Error: Please specify a startup command.");
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

	// console.log(str);
	logger.info(str);
}

var exec = require("child_process").exec;
// console.log("Starting Rust...");
logger.info('Starting Rust...');

var exited = false;
const gameProcess = exec(startupCmd);
gameProcess.stdout.on('data', filter);
gameProcess.stderr.on('data', filter);
gameProcess.on('exit', function (code, signal) {
	exited = true;

	if (code) {
		// console.log("Main game process exited with code " + code);
		logger.info("Main game process exited with code " + code);

		process.exit(code);
	}
});

function initialListener(data) {
	const command = data.toString().trim();
	if (command === 'quit') {
		gameProcess.kill('SIGTERM');
	} else {
		// console.log('Unable to run "' + command + '" due to RCON not being connected yet.');
		logger.info('Unable to run "' + command + '" due to RCON not being connected yet.');
	}
}
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdin.on('data', initialListener);

process.on('exit', function (code) {
	if (exited) return;

	// console.log("Received request to stop the process, stopping the game...");
	logger.info("Received request to stop the process, stopping the game...");

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

		// console.log("Connected to RCON ("+pollingDuration+"s). Generating the map now. Please wait until the server status switches to \"Running\".");
		logger.info("Connected to RCON ("+pollingDuration+"s). Generating the map now. Please wait until the server status switches to \"Running\".");

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
					// console.log(json.Message);
					logger.info(json.Message);

					const fs = require("fs");
					fs.appendFile("latest.log", "\n" + json.Message, (err) => {
						if (err) console.log("Callback error in appendFile:" + err);
					});
				}
			} else {
				// console.log("Error: Invalid JSON received");
				logger.info("Error: Invalid JSON received");
			}
		} catch (e) {
			if (e) {
				// console.log(e);
				logger.error(e);
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
			// console.log("RCON server took too long (15 minutes) to start. Exiting...");
			logger.info("RCON server took too long (15 minutes) to start. Exiting...");

			gameProcess.kill("SIGKILL");
			process.exit(1);
		}

		// console.log("Waiting for RCON to come up... (" + pollingDuration + "s)");
		logger.info("Waiting for RCON to come up... (" + pollingDuration + "s)");
		setTimeout(poll, 5000);
	});

	ws.on("close", function () {
		if (!waiting) {
			// console.log("Connection to server closed.");
			logger.info("Connection to server closed.");

			exited = true;
			process.exit(0);
		}
	});
}
poll();
