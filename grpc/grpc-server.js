module.exports = function (RED) {
    'use strict'
    let fs = require("fs");
    let grpc = require("@grpc/grpc-js");
    let utils = require('../utils/utils');
	let protoLoader = require("@grpc/proto-loader");
    let getByPath = require('lodash.get');

    let grpc_services = new Map();
    
	const NR_DEFAULT_LOGGER = {
		error: (message, ...optionalParams) => {
			console.log('E ' + message, ...optionalParams);
		},
		info: (message, ...optionalParams) => {
			console.log('I ' + message, ...optionalParams);
		},
		debug: (message, ...optionalParams) => {
			console.log('D ' + message, ...optionalParams);
		},
	};

	//grpc.setLogVerbosity(grpc.logVerbosity.DEBUG);
	//grpc.setLogger(NR_DEFAULT_LOGGER);
	
    function gRpcServerNode(config) {
        var node = this;
        RED.nodes.createNode(node, config);
        node.server =  config.server || "0.0.0.0";
        node.port = config.port || 5001;
        node.name = config.name;
        node.protoFile = config.protoFile;
        node.ca = config.ca;
        node.chain = config.chain;
        node.key = config.key;
        node.localServer = config.localServer;
        node.mutualTls = config.mutualTls;
		node.protoPackages = config.protoPackages;        
		node.includeProtoDirs = config.includeProtoDirs;

        node.log("Creating grpc server config context...");

        createGRPCServer(node);
        
        node.on("error", function(error) {
            node.error("gRPC Server Error - " + error);
            console.log(error);
        });
		
        node.on("close", function(done) {
            if (this.localServer) {
                stopServer(this);
                console.log("### gRPC server stopped ###");
            }
            done();
        });
    }	

    function createGRPCServer(node) {        
        try {
            var protoFunctions = {};
            console.log(`Includes: ${JSON.stringify(node.includeProtoDirs)}\nProtoFile:\n${node.protoFile}`);
            let proto = LoadProtoFile(node.includeProtoDirs, node.protoFile);
            let credentials;
            if (node.ca){
                var ca =  utils.tempFile('ca.txt', node.ca)
                var chain =  utils.tempFile('chain.txt', node.chain)
                var key =  utils.tempFile('key.txt', node.key)

                node.caPath = ca;
    
                credentials = grpc.ServerCredentials.createSsl(
                    fs.readFileSync(ca), [{
                    cert_chain: fs.readFileSync(chain),
                    private_key: fs.readFileSync(key)
                }], node.mutualTls);
            }
           
            CacheServerDefinition(proto, node.protoPackages, node.name);
            
            // If we start a local server
            if (node.localServer) {
                var server = new grpc.Server();
                // Parse the proto file
                var services = proto;
				
                if (node.protoPackages.length > 0) {
                    node.protoPackages.forEach((packageName) => {
                        loadServicesFrom(node, packageName, node.grpcServer, getByPath(proto, packageName), protoFunctions);
                    });
                }
                else{
                    loadServicesFrom(node, "", node.grpcServer, services, protoFunctions)
                }

                server.bindAsync(
                  node.server + ":" + node.port, 
                  credentials || grpc.ServerCredentials.createInsecure(),
                  (err, port) => {
                    if (!err){
                      server.start();
                      console.log(`### GRPC Server started in port ${port} ### `);
                    }
                  }
                );
                
                node.grpcServer = server;		
            }            

            

            node.protoFunctions = protoFunctions;
            node.proto = proto;
                
        } catch (err) {
            node.error("createGRPCServer - " + err);
            console.log(err);
        }
    }

	function loadServicesFrom(node, pkg_name, server, services, protoFunctions){
		// For each service
		for (var serviceName in services) {
		    if ('service' in services[serviceName]) {			  
			    var methods = Object.keys(services[serviceName].service);
              
			    for(var methodId in methods) {               
				    protoFunctions[methods[methodId]] = generateFunction(pkg_name, node, serviceName, methods[methodId]);
			    }
			    // Add stub methods for each methods and services declared in the proto file
                if(server)
			        server.addService(services[serviceName].service, protoFunctions);
		    }
		}
	}

    function generateFunction(packageName, node, service, method) {
        try {
            var methodName = utils.getMethodName(packageName, service, method);
			node.log("\tGenerated Func Name: " + methodName);
            var body = 
            'if (this["'+ methodName +'"]) { \
                this["'+ methodName +'"](arguments)\
            } else { \
                console.log("Calling unimplemented method '+ method + ' for service ' + service + '"); \
            }';
            var func = new Function(body);
            return func;
        } catch (err) {
            node.error("generateFunction - " + err);
            console.log(err);
        }
        return null;
	}
   
    function stopServer(node) {
        console.log("#### Stoping server ")
        try {
            if (node.grpcServer) {
                node.grpcServer.forceShutdown();
                delete node.grpcServer;
            }
        } catch (err) {
            node.error("stopServer - " + err);
            console.log(err);
        }
	}

    RED.nodes.registerType("grpc-server", gRpcServerNode, {});	

    RED.httpAdmin.get("/node-red-contrib-grpc/*",function(req,res) {
      var options = {
          root: __dirname + '/scripts/',
          dotfiles: 'deny'
      };
      res.sendFile(req.params[0], options);
    });

    RED.httpAdmin.post("/grpc-services", function (req, res) {
        let proto = LoadProtoFile(req.body.include_paths, req.body.proto_file);

        CacheServerDefinition(proto, req.body.packages, req.body.server);

        res.status(200).send();
    });

    RED.httpAdmin.get("/grpc-services",function(req,res) {       
        if(grpc_services.has(req.query.svr)){
            let svr_pkgs = grpc_services.get(req.query.svr);
            if(svr_pkgs.has(req.query.pkg)){
                res.status(200).send([...svr_pkgs.get(req.query.pkg).keys()]);
            }
            else
                res.status(400).send();
        }
        else
            res.status(400).send();
    });

    RED.httpAdmin.get("/grpc-services/methods", function(req,res) {       
        if(grpc_services.has(req.query.svr)){
            let svr_pkgs = grpc_services.get(req.query.svr);
            if(svr_pkgs.has(req.query.pkg)){
                var pkg_svcs = svr_pkgs.get(req.query.pkg);
                if(pkg_svcs.has(req.query.svc)){                    
                    res.status(200).send(pkg_svcs.get(req.query.svc));
                }else{
                    res.status(400).send();    
                }
            }
            else
                res.status(400).send();
        }
        else
            res.status(400).send();
    });

    function CacheServerDefinition(proto, packages, server_name) {
        let svr_pkgs = new Map();
        
        packages.forEach((pkg_name) => {
            let pkg_svcs = new Map();
            console.log("### Caching server definition for package: " + pkg_name);
            let services = getByPath(proto, pkg_name);
            for (var service_name in services) {                
                if ('service' in services[service_name]) {
                    console.log("\tCaching service: " + service_name);
                    pkg_svcs.set(service_name, Object.keys(services[service_name].service));
                }                
            }
            svr_pkgs.set(pkg_name, pkg_svcs);
        });
    
        grpc_services.set(server_name, svr_pkgs);
    }
    
    function LoadProtoFile(includeProtoDirs, protoFile) {
        var fileName = utils.tempFile('proto.txt', protoFile);
    
        var full_include_dir_paths = [];
    
        if (includeProtoDirs) {
            includeProtoDirs.forEach((path_entry) => {
                if (!path_entry.absolute) {
                    full_include_dir_paths.push(__dirname + "/" + path_entry.path);
                }
                else {
                    full_include_dir_paths.push(path_entry.path);
                }
            });
        }
    
        let proto = grpc.loadPackageDefinition(
            protoLoader.loadSync(fileName, {
                keepCase: true,
                longs: String,
                enums: String,
                defaults: true,
                oneofs: true,
                includeDirs: full_include_dir_paths
            })
        );

        return proto;
    }
}
