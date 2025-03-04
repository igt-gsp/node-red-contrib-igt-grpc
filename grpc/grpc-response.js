module.exports = function(RED) {
	'use strict';
	
	let grpc = require("@grpc/grpc-js");
	
	function gRpcResponseNode(config) {
        var node = this;
		RED.nodes.createNode(node, config);

		var managed_calls = new Map();
		
		node.on("input", function(msg) {
			try {				
				if (!msg.call && msg.grpc_call_id === undefined) {
					node.error('Error, no call in message');
					node.status({fill:"red",shape:"dot",text:"no call in msg"});
				} else {
					if(msg.call !== undefined){
						if (msg.err) {
							if (msg.callback) {
								msg.callback(msg.err);
							} else {							
								msg.call.emmit('error', msg.err);
								msg.end();
							}
						} else {						
							if (msg.callback) {							
								msg.callback(null, msg.payload);
							} else {
								// if there is no call back, then this is for a server response stream
								// If there is a grpc_call_id in the message, use that to manage
								// the calls. This will allow the user to send more message to the same grpc_call_id
								// The call will be put into an array mapped to the grpc_call_id. This will allow
								// for the observer pattern with grpc to work. The user can specify the grpc_call_id
								// as they like. It could be a specific id for that caller, or a group id used for
								// observer pattern.
								
								var this_call = msg.call;
								
								if(msg.grpc_call_id !== undefined && msg.grpc_call_id != ""){
									if(!managed_calls.has(msg.grpc_call_id)){
										managed_calls.set(msg.grpc_call_id, []);
									}
									
									var grp_id = msg.grpc_call_id;									
									
									let this_call_id_grp = managed_calls.get(msg.grpc_call_id);
									// Need to attach some listeners to allow us to clean up the managed_calls when the call end or fails
									let call_completion_handler = function(call_grp_id, call){
										console.log("Handling call completion for: " + call_grp_id);
										if(managed_calls.has(call_grp_id)){
											let this_call_id_grp = managed_calls.get(call_grp_id);
											if(this_call_id_grp !== undefined){
												let this_call_index = this_call_id_grp.indexOf(call);
												if(this_call_index != -1){
													this_call_id_grp.slice(this_call_index, 1);
													if(this_call_id_grp.length == 0){
														managed_calls.delete(call_grp_id);
													}
												}
											}
										}
									};
									msg.call.on("end", ()=>{node.log("end called"); call_completion_handler(grp_id, this_call);});									
									msg.call.on("error", ()=>{node.log("error called");call_completion_handler(grp_id, this_call);});
									msg.call.on("cancelled", ()=>{node.log("cancelled called");call_completion_handler(grp_id, this_call);});
									this_call_id_grp.push(this_call);
								}
								
								writeToResponseStream(this_call, msg.payload);
								
								if(msg.topic !== undefined && msg.topic == "end"){
									this_call.end();
								}
							}
						}
					}
					else if(msg.grpc_call_id !== undefined){
						if(managed_calls.has(msg.grpc_call_id)){
							let this_call_id_grp = managed_calls.get(msg.grpc_call_id);
							this_call_id_grp.forEach((call_item)=>{
								writeToResponseStream(call_item, msg.payload);
								if(msg.topic !== undefined && msg.topic == "end"){
									call_item.end();
								}
							});
						}
					}
				}		 	
			} catch (err) {
                console.log("Error - gRpcResponseNode - onInput", err);
				node.error(err);
			}						
		});
		
		node.on("error", function(error) {
			node.error("gRpcResponseNode Error - " + error);
        });
		
		function writeToResponseStream(call, payload){
			if (Array.isArray(payload)) {								
				for (var i in payload) {
					call.write(payload[i]);
				}
			} else {						
				call.write(payload);
			}
		}
    }

	RED.nodes.registerType("grpc-response",gRpcResponseNode);
};