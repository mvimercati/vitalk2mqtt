
var mqtt = require('mqtt');
var mqtt_client = mqtt.connect('mqtt://127.0.0.1',{clientId:"vitalk2mqtt",username:"mqtt_user",password:"mqtt"});

var mqtt_connected = false;

mqtt_client.on('connect', function() {
    console.log("MQTT Connected");
    mqtt_client.subscribe('Viessmann/Commands/#', function(err) {
	console.log(err);
    });
    console.log("Done");

    for (var key in cmds) {
        cmds[key][0] = null;
	cmds[key][2] = null;
    }

    mqtt_connected = true;

});

mqtt_client.on('message', function(topic, message) {

    console.log("------- Command topic " + topic + " -> " + message);
    
    if (topic.endsWith("HotWaterEnabled"))
    {
	if (message == "OFF")
	{
	    last_enabled_temp = cmds["HotWaterTempTarget"][2];
	}
	write("HotWaterTempTarget", message == "OFF" ? "20" : last_enabled_temp);
	read("HotWaterTempTarget");
	return;
    }
    
    if (topic.endsWith("HotWaterTempTarget"))
    {
	write("HotWaterTempTarget", message);    
	read("HotWaterTempTarget");
	return;
    }

    if (topic.endsWith("ActiveDEInput"))
    {
	write("ActiveDEInput", cmds["ActiveDEInput"][9][message]);
	read("ActiveDEInput");
	return;
    }	        
});



var sem = require('semaphore')(1);

var cmd_queue = [];
var last_enabled_temp = "42";

var queue = [];
var inhibitDeInputs = false;
var reenableCounter = 0;

var cmds = {
    "OutdoorTemp"            : [ null,  60, null, '5525', -2, 10,   1,  0,  null ],
    "SolarPanelTemp"         : [ null,  10, null, '6564', -2, 10,   1,  0,  null ],
    "HotWaterTemp"           : [ null,  10, null, '0804', 2, 10,   1,  0,  null ],
    "HotWaterTempTarget"     : [ null,  30, null, '6300', 1, 1,    1,  0,  null ],
    "BurnerTemp"             : [ null,   5, null, '0802', 2, 10,   1,  0,  null ],
    "HeatingTempTarget"      : [ null,  60, null, '555A', 2, 10,   1,  0,  null ],
/*  "ExhaustGasTemp"         : [ null,  30, null, '0808', 2, 10,   1,  0,  null ], */
    "BurnerStartsCounter"    : [ null,  60, null, '088A', 2, 1,    1,  0,  null ],
    "RuntimeHoursBurner"     : [ null, 600, null, '08A7', 4, 3600, 1,  0,  null ],
    "BurnerPowerThrottle"    : [ null,   5, null, 'A38F', 1, 2,    1,  0,  null ],
    "BoilerLowerTemp"        : [ null,  10, null, '6566', 2, 10,   1,  0,  null ],
    "BoilerLoading"          : [ null,   5, null, '6513', 1, 1,    1,  0,  { "0" : "Off", "1" : "Attivo" } ],
/*  "SolarPumpActive"        : [ null,  30, null, '6552', 1, 1,    1,  0,  null ], */
    "InternalPumpRPM"        : [ null,  30, null, '0A3C', 1, 1,    1,  0,  null ],
/*  "HeatingRequest"         : [ null,  60, null, '0A80', 1, 1,    1,  0,  null ], */
    "RuntimeHoursSolar"      : [ null, 900, null, '6568', 2, 1,    1,  0,  null ],
    "TotalSolarEnergy"       : [ null, 300, null, '6560', 4, 1,    1,  0,  null ],
    "SwitchingValvePos"      : [ null,  15, null, '0A10', 1, 1,    1,  0,  { "1" : "Riscaldamento", "2" : "Mista", "3" : "Acqua calda" } ],
/*  "FlowTemp"               : [ null,  60, null, '080C', 2, 10,   10, 0,  null ], sempre 20 */
/*  "ReturnTemp"             : [ null,  60, null, '080A', 2, 10,   10, 0,  null ], sempre 20 */
/*  "WaterFlow"              : [ null,  60, null, '0C24', 2, 1,    1,  0,  null ], sempre 0 */
    "HeatingPumpRPM"         : [ null,  30, null, '7663', 1, 1,    1,  1,  null ],
/*  "StartsCounterSolar"     : [ null, 120, null, 'CF50', 4, 1,    1,  0,  null ], */
    "DailySolarEnergy"       : [ null, 300, null, 'CF30', 4, 1000, 10, 0,  null ],
/*  "RoomTemp"               : [ null,  60, null, '2306', 1, 1,    1,  0,  null ], */
    "ActiveDEInput"          : [ null,  15, null, '27D8', 1, 1,    1,  0,  { "0" : "Inibito", "1" : "Termostato", "3" : "Forzato" }, { "Inibito" : "0", "Termostato" : "1", "Forzato": "3" } ],
    "DE1InputFunction"       : [ null,  15, null, '773A', 1, 1,    1,  0,  null ],
/*  "DailySolarEnergyArray0" : [ null,   5, null, 'CF30', 32, 1    1,  0,  null ], */ 
    "SolarPumpRPM"           : [ null,  15, null, 'CFB0', 1, 1,    1,  23, null ],
/*  "ACSTemp"                : [ null,  20, null, '0814', 2, 10,   10, 0,  null ], */
/*  "ComfortTemp"            : [ null,  20, null, '0812', 2, 10,   10, 0,  null  ], */
};


const net = require('net');

const vitalk = net.createConnection({ port: 3083 }, () => {
    //'connect' listener
    console.log('connected to server!');
});

vitalk.on('data', (data) => {

    if (data.toString().startsWith("Welcome")) {
	return;
    }

    sem.leave();
    
    if (data.toString().startsWith("OK")) {
	return;
    }

    if (data.toString().startsWith("Vitodens communication Error")) {
	console.log("!!!!!!!!!!!!! Comm error");
	return;
    }
    
    key = queue.shift();

    if (typeof key === 'undefined')
    {
	console.log("QUEUE EMPTY");
    }

    var b = data.toString().split(";");
    var v = 0;

    if (!(key in cmds))
    {
	console.log("!!!!KEY NOT FOUND : " + key);
	return;
    }
    
    for (i = (cmds[key][7] + Math.abs(cmds[key][4]) - 1); i >= (cmds[key][7]); i--) {
	v = (v * 256) + Number(b[i]);
    }

    if ((cmds[key][4] == -2) && (v > 32767)) {
	v = v - 65536;
    }

    console.log("Update " + key + " = " + v + "\n");
    
    update(key, v);
});

vitalk.on('end', () => {
    console.log('disconnected from server');
});


setInterval(function() {

    for (var key in cmds) {
	cmds[key][0] = null;
	cmds[key][2] = null;
    }
    
}, 1000 * 300); // every 5 min clear the last update time stamp


setInterval(function() {

    var d = new Date();
    var t = d.getTime();
    
    for (var key in cmds) {

	if ((cmds[key][0] == null) || ((t - cmds[key][0]) > cmds[key][1]*1000)) {
		
	    cmds[key][0] = t;
	    read(key);
	}
    }
}, 1000); // every sec check if some variable needs to be polled


function update(key, value)
{
    value = value / cmds[key][5];
    value = Math.round( value * cmds[key][6] ) / cmds[key][6];

    
    if ((inhibitDeInputs == true) && (key == "BoilerLoading") && (value == 0))
    {
	reenableCounter--;
	console.log("Enable inputs in a while");
	if (reenableCounter == 0)
	{
	    console.log("Reenable DE1 input function");
	    inhibitDeInputs = false;
	    write("DE1InputFunction", 1);
	}
    }

    if (cmds[key][2] != value) {

	cmds[key][2] = value;
	
	if (mqtt_connected == false) {
	    return;
	}

	if (cmds[key][8] == null) {
            mqtt_client.publish("Viessmann/" + key, value.toString());
	} else {
	    if (value.toString() in cmds[key][8]) {
		mqtt_client.publish("Viessmann/" + key, cmds[key][8][value].toString());
	    } else {
		mqtt_client.publish("Viessmann/" + key, value.toString());
	    }
	}

	if (key == "HotWaterTempTarget") {
            mqtt_client.publish("Viessmann/HotWaterEnabled", value == 20 ?  "OFF" : "ON");
	}


	if ((inhibitDeInputs == false) && (key == "BoilerLoading") && (value == 1))
	{
	    console.log("Disable DE1 input function");
	    write("DE1InputFunction", 0);
	    
	    inhibitDeInputs = true;
	    reenableCounter = 20;
	}
	
    }
    
}

function read(key)
{
    sem.take( function() {

	console.log("Request " +key);
	var len = Math.abs(cmds[key][4]) + cmds[key][7];
	
	if (vitalk.write("rg "+cmds[key][3]+" "+len+"\n") == true)
	{
	    queue.push(key);
	}
    });
}

function write(key, value)
{
    sem.take( function() {
	
	value = value * cmds[key][5];
	console.log("Write " + key + " = " + value);
	vitalk.write("rs "+cmds[key][3]+" "+value+"\n");
    });
}


