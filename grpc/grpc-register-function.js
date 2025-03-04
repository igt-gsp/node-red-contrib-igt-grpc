module.exports = function(RED) {
	"use strict";
    var utils = require('../utils/utils');
	let getByPath = require('lodash.get');

    function gRpcRegisterFuctionNode(config) {
        var node = this;
		RED.nodes.createNode(node, config);
        node.status({fill:"grey",shape:"ring",text:"connecting"});
        try {
            // Get the gRPC server from the server config Node
            var server = RED.nodes.getNode(config.server)
			var proto =  server.proto;
			if (config.protoPackage) {
				proto = getByPath(server.proto, config.protoPackage);
			} 
			
            if (server && server.protoFunctions) {
                node.status({fill:"green",shape:"dot",text:"connected"});
                var methodName = utils.getMethodName(config.protoPackage, config.service, config.method);
				node.log("Registering to grpc method: " + methodName);
                server.protoFunctions[methodName] = function() {
                    var message = {};
                    var args = null;
					//console.log(JSON.stringify(proto[config.service].service[config.method]));
                    if (arguments && arguments.length == 1) {
                        args = arguments [0];
                    }
                    // Stream (call) or message (call and callback)
                    if (args && args.length == 2) {
						if (proto[config.service].service[config.method].requestStream){
							args[0].on("data", function (data) {
								node.log("Received client stream data");
								var msg = {
									call: args[0],
									callback: args[1],
									payload: data
								}
								
								node.send(msg);
							});
							args[0].on("error",function (error) {
								node.log("Received client stream error");
								var msg = {
									call: args[0],
									callback: args[1],
									payload: error
								}
								
								node.send(msg);
							 });
						} else {
							 message = {
								call : args[0],
								callback: args[1],
								payload: args[0].request
							}
							
							node.send(message);
						}
                    } else {
						if (proto[config.service].service[config.method].responseStream){
							node.log("Response Stream Started");
						}
							
                        message = {
                            call : args[0],
                            payload: args[0].request
                        }
						
						node.send(message);
                    }
                };
            } else {
                node.status({fill:"red",shape:"dot",text:"No local server started"});
            }
        } catch(err) {
            node.error("gRpcRegisterFunctionNode - getGRPCServrt" + err);
            node.status({fill:"red",shape:"dot",text:"error"});
        }
				
        node.on("error", function(error) {
            node.error("gRpcRegisterFuctionNode Error - " + error);
            console.log(error);
        });
    }

    RED.nodes.registerType("grpc-register-function",gRpcRegisterFuctionNode);
};