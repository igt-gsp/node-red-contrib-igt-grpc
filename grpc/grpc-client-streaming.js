module.exports = function (RED) {
    "use strict";
    let grpc = require("@grpc/grpc-js");
	let getByPath = require('lodash.get');
	
    function gClientStreamingNode(config) {
        try {
            var node = this;
            RED.nodes.createNode(node, config);

            // Get the gRPC server from the server config Node
            var serverNode = RED.nodes.getNode(config.server)
            node.on("input", function (msg) {                
                try {
                    const REMOTE_SERVER = serverNode.server + ":" + serverNode.port;
                    //Create gRPC client
                    var proto =  serverNode.proto;
                    if (config.protoPackage) {
                        proto = getByPath(serverNode.proto, config.protoPackage);
                    }
                    if (!proto[config.service]) {
                        node.status({fill:"red",shape:"dot",text: "Service " + config.service + " not in proto file"});
                        return;
                    } 
                    if (!proto[config.service].service[config.method]) {
                        node.status({fill:"red",shape:"dot",text: "Method " + config.method + " not in proto file for service " +  config.service });
                        return
                    } 
                    
                    if (!node.client) {
                        // Initialize connection
                        node.client = new proto[config.service](
                            REMOTE_SERVER,
                            grpc.credentials.createInsecure()
                        );
                        if (!node.client[config.method]) {
                            node.status({fill:"red",shape:"dot",text: "Method " + config.method + " not in proto file"});
                            return;
                        }
                    }
                    if (!node.channel) {
                        // Get Client Stream
						node.log(JSON.stringify(proto[config.service].service[config.method]));
						if (proto[config.service].service[config.method].responseStream) {
							node.log("Has streaming response...");
							node.channel = node.client[config.method](msg.payload);
							node.channel.on("data", function (data) {
								msg.payload = data;
								node.send(msg);
								node.log("Channel data received");
							});

							node.channel.on("error",function (error) {
								node.status({fill:"red",shape:"dot",text: "Stream disconnected"});
								node.log("Channel error: " + error);
							});
							
							node.channel.on("end",function () {
								node.status({fill:"red",shape:"dot",text: "Stream ended"});                                    
							});
						}
						else
						{
							node.channel = node.client[config.method](function(error, data) {
								// Wait for disconnect
								if (error) {
									node.status({fill:"red",shape:"dot",text: "Connection to stream " + REMOTE_SERVER + " lost"});
								} else {
									node.status({fill:"green",shape:"dot",text: "Connection to stream " + REMOTE_SERVER + " closed"});
								}
								msg.payload = data;
								msg.error = error;
								node.send(msg);
								node.channel = undefined
							});
						}						
                    }
					
					node.channel.write(msg.payload);
					
                    if (msg.topic == "close") {
                        node.call.end();
                        return;
                    }
                    node.status({fill:"green",shape:"dot",text: "Connected to " +  REMOTE_SERVER });
                    
					
                } catch (err) {
                    node.error("onInput" + err);
                    console.log(err);
                }

            });

            node.on("error", function (error) {
                node.error("gClientStreamingNode Error - " + error);
                console.log(error);
            });

            node.on("close", function (done) {
                if (node.call) {
                    node.call.end();
                    delete node.call;
                }
                if (node.client) {
                    grpc.closeClient(node.client)
                    delete node.client;
                    delete node.channel;
                }
                done();
            });
        } catch (err) {
            node.error("gClientStreamingNode" + err);
            console.log(err);
        }
    }

    RED.nodes.registerType("grpc-client-streaming", gClientStreamingNode);
};
